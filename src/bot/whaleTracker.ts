/**
 * Whale Tracker Module
 * 
 * Tracks profitable wallets on Polymarket and copies their trades with
 * safety delays and Kelly Criterion-based position sizing.
 */

import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { ethers, JsonRpcProvider, Contract } from "ethers";
import { getItem, setItem } from "../utils/jsonStore";

// ── Types ──────────────────────────────────────────────────────────────────

export interface WhaleWallet {
  address: string;
  totalPnl: number;
  winRate: number;
  tradeCount: number;
  lastUpdated: number;
  tags?: string[];
}

export interface WhaleTrade {
  id: string;
  whaleAddress: string;
  market: string;
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  timestamp: number;
  txHash?: string;
}

export interface CopiedTrade {
  id: string;
  originalTradeId: string;
  whaleAddress: string;
  market: string;
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  originalPrice: number;
  size: number;
  timestamp: number;
  delayMs: number;
  status: "PENDING" | "EXECUTED" | "SKIPPED" | "FAILED";
  reason?: string;
  pnl?: number;
}

export interface WhaleHistory {
  wallets: WhaleWallet[];
  trades: WhaleTrade[];
  copiedTrades: CopiedTrade[];
  lastSyncTimestamp: number;
}

export interface KellyResult {
  fraction: number;
  recommendedSize: number;
  reason: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const WHALE_HISTORY_KEY = "whaleHistory";
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const WHALE_HISTORY_FILE = path.join(DATA_DIR, "whale-history.json");

// Polymarket CTF Exchange contract on Polygon
const CTF_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";

// Minimal ABI for tracking trades on CTF Exchange
const CTF_EXCHANGE_ABI = [
  "event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee)",
  "event OrdersMatched(bytes32 indexed takerOrderHash, address indexed takerOrderMaker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled)",
];

// Default configuration
const DEFAULT_COPY_DELAY_MS = 5000; // 5 second delay before copying trades
const DEFAULT_MAX_PRICE_DEVIATION = 0.02; // 2% max price change before copying
const DEFAULT_MIN_WHALE_PNL = 1000; // Minimum $1000 PnL to be considered a whale
const DEFAULT_MIN_WIN_RATE = 0.55; // Minimum 55% win rate
const DEFAULT_MAX_KELLY_FRACTION = 0.25; // Max 25% of bankroll per trade

// ── Configuration ──────────────────────────────────────────────────────────

function getConfig() {
  return {
    copyDelayMs: parseInt(process.env.WHALE_COPY_DELAY_MS ?? String(DEFAULT_COPY_DELAY_MS), 10),
    maxPriceDeviation: parseFloat(process.env.WHALE_MAX_PRICE_DEVIATION ?? String(DEFAULT_MAX_PRICE_DEVIATION)),
    minWhalePnl: parseFloat(process.env.WHALE_MIN_PNL ?? String(DEFAULT_MIN_WHALE_PNL)),
    minWinRate: parseFloat(process.env.WHALE_MIN_WIN_RATE ?? String(DEFAULT_MIN_WIN_RATE)),
    maxKellyFraction: parseFloat(process.env.WHALE_MAX_KELLY_FRACTION ?? String(DEFAULT_MAX_KELLY_FRACTION)),
    enabled: process.env.WHALE_TRACKING_ENABLED === "true",
    rpcUrl: process.env.POLYGON_RPC_URL ?? "https://polygon-rpc.com",
    clobApiUrl: process.env.CLOB_API_URL ?? "https://clob.polymarket.com",
  };
}

// ── State Management ───────────────────────────────────────────────────────

let _provider: JsonRpcProvider | null = null;
let _ctfExchange: Contract | null = null;
let _isTracking = false;
let _trackingTimer: NodeJS.Timeout | null = null;

function getProvider(): JsonRpcProvider {
  if (!_provider) {
    const config = getConfig();
    _provider = new JsonRpcProvider(config.rpcUrl);
  }
  return _provider;
}

function getCTFExchange(): Contract {
  if (!_ctfExchange) {
    _ctfExchange = new Contract(CTF_EXCHANGE_ADDRESS, CTF_EXCHANGE_ABI, getProvider());
  }
  return _ctfExchange;
}

// ── History Management ─────────────────────────────────────────────────────

function getDefaultHistory(): WhaleHistory {
  return {
    wallets: [],
    trades: [],
    copiedTrades: [],
    lastSyncTimestamp: 0,
  };
}

/** Load whale history from in-memory store or disk. */
export function loadWhaleHistory(): WhaleHistory {
  // Try in-memory store first
  const memHistory = getItem<WhaleHistory>(WHALE_HISTORY_KEY);
  if (memHistory) {
    return memHistory;
  }

  // Try loading from disk
  if (fs.existsSync(WHALE_HISTORY_FILE)) {
    try {
      const raw = fs.readFileSync(WHALE_HISTORY_FILE, "utf-8");
      const history = JSON.parse(raw) as WhaleHistory;
      setItem(WHALE_HISTORY_KEY, history, false);
      return history;
    } catch (err) {
      console.error("[whaleTracker] Failed to load whale history from disk:", err);
    }
  }

  return getDefaultHistory();
}

/** Save whale history to in-memory store and disk. */
export function saveWhaleHistory(history: WhaleHistory): void {
  setItem(WHALE_HISTORY_KEY, history, false);
  
  // Also persist to dedicated file
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(WHALE_HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
}

// ── Whale Discovery ────────────────────────────────────────────────────────

interface LeaderboardEntry {
  address: string;
  profit: number;
  volume: number;
  trades: number;
  winRate?: number;
}

/**
 * Fetch profitable wallets from Polymarket leaderboard API.
 * Scans for top-profit traders (similar to searches like "vague-sourdough").
 */
export async function fetchProfitableWallets(): Promise<WhaleWallet[]> {
  const config = getConfig();
  const whales: WhaleWallet[] = [];

  try {
    // Fetch leaderboard data from Polymarket
    const { data } = await axios.get<{ data?: LeaderboardEntry[]; rankings?: LeaderboardEntry[] }>(
      `${config.clobApiUrl}/leaderboard`,
      { timeout: 15_000 }
    );

    const entries = data.data ?? data.rankings ?? [];
    
    for (const entry of entries) {
      // Filter by minimum PnL and win rate
      if (entry.profit >= config.minWhalePnl) {
        const winRate = entry.winRate ?? 0.5;
        if (winRate >= config.minWinRate) {
          whales.push({
            address: entry.address,
            totalPnl: entry.profit,
            winRate: winRate,
            tradeCount: entry.trades ?? 0,
            lastUpdated: Date.now(),
            tags: ["leaderboard"],
          });
        }
      }
    }

    console.log(`[whaleTracker] Found ${whales.length} profitable wallets from leaderboard`);
  } catch (err) {
    console.error("[whaleTracker] Failed to fetch leaderboard:", err);
  }

  return whales;
}

/**
 * Search for specific profitable traders by username or criteria.
 * This can be used to find traders like "vague-sourdough" pattern.
 */
export async function searchProfitableTraders(query?: string): Promise<WhaleWallet[]> {
  const config = getConfig();
  const whales: WhaleWallet[] = [];

  try {
    const params: Record<string, string> = {
      limit: "100",
      sortBy: "profit",
      order: "desc",
    };
    
    if (query) {
      params.search = query;
    }

    const { data } = await axios.get<{ data?: LeaderboardEntry[]; users?: LeaderboardEntry[] }>(
      `${config.clobApiUrl}/users`,
      { params, timeout: 15_000 }
    );

    const entries = data.data ?? data.users ?? [];

    for (const entry of entries) {
      if (entry.profit >= config.minWhalePnl) {
        whales.push({
          address: entry.address,
          totalPnl: entry.profit,
          winRate: entry.winRate ?? 0.5,
          tradeCount: entry.trades ?? 0,
          lastUpdated: Date.now(),
          tags: query ? [query] : [],
        });
      }
    }

    console.log(`[whaleTracker] Found ${whales.length} traders matching criteria`);
  } catch (err) {
    console.error("[whaleTracker] Failed to search traders:", err);
  }

  return whales;
}

// ── On-Chain Trade Monitoring ──────────────────────────────────────────────

interface TradeEvent {
  maker: string;
  taker: string;
  makerAssetId: bigint;
  takerAssetId: bigint;
  makerAmountFilled: bigint;
  takerAmountFilled: bigint;
  txHash: string;
  blockNumber: number;
}

/**
 * Fetch recent trades for a specific wallet from on-chain events.
 * Uses Ethers.js to query the Polygon blockchain.
 */
export async function fetchWalletTradesOnChain(
  walletAddress: string,
  fromBlock: number = -10000 // Last ~10000 blocks
): Promise<WhaleTrade[]> {
  const trades: WhaleTrade[] = [];
  const provider = getProvider();

  try {
    const currentBlock = await provider.getBlockNumber();
    const startBlock = fromBlock < 0 ? Math.max(0, currentBlock + fromBlock) : fromBlock;

    const ctfExchange = getCTFExchange();

    // Query OrderFilled events where the wallet is involved
    const filter = ctfExchange.filters.OrderFilled();
    const events = await ctfExchange.queryFilter(filter, startBlock, currentBlock);

    for (const event of events) {
      // Type guard: check if this is an EventLog with args
      if (!("args" in event) || !event.args) continue;

      const { maker, taker, makerAssetId, takerAssetId, makerAmountFilled, takerAmountFilled } = event.args;

      // Check if this wallet was involved
      const makerAddr = String(maker);
      const takerAddr = String(taker);
      const isMaker = makerAddr.toLowerCase() === walletAddress.toLowerCase();
      const isTaker = takerAddr.toLowerCase() === walletAddress.toLowerCase();

      if (!isMaker && !isTaker) continue;

      // Determine trade side and details
      const side: "BUY" | "SELL" = isMaker ? "SELL" : "BUY";
      const tokenId = isMaker ? String(makerAssetId) : String(takerAssetId);
      const amount = isMaker ? BigInt(makerAmountFilled) : BigInt(takerAmountFilled);
      const makerAmount = BigInt(makerAmountFilled);
      const takerAmount = BigInt(takerAmountFilled);
      const price = Number(takerAmount) / Number(makerAmount);

      const block = await event.getBlock();
      
      trades.push({
        id: `${event.transactionHash}-${event.index}`,
        whaleAddress: walletAddress,
        market: "", // Would need to map tokenId to market
        tokenId: tokenId,
        side: side,
        price: Math.min(price, 1), // Normalize to 0-1 range
        size: Number(ethers.formatUnits(amount, 6)), // USDC has 6 decimals
        timestamp: (block?.timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
        txHash: event.transactionHash,
      });
    }

    console.log(`[whaleTracker] Found ${trades.length} on-chain trades for ${walletAddress}`);
  } catch (err) {
    console.error("[whaleTracker] Failed to fetch on-chain trades:", err);
  }

  return trades;
}

/**
 * Fetch recent trades for a wallet from the Polymarket API.
 */
export async function fetchWalletTradesApi(walletAddress: string): Promise<WhaleTrade[]> {
  const config = getConfig();
  const trades: WhaleTrade[] = [];

  try {
    const { data } = await axios.get<{ data?: Array<{
      id: string;
      market: string;
      asset_id: string;
      side: string;
      price: string;
      size: string;
      timestamp: string;
      transaction_hash?: string;
    }> }>(
      `${config.clobApiUrl}/trades`,
      {
        params: {
          maker: walletAddress,
          limit: 100,
        },
        timeout: 15_000,
      }
    );

    const entries = data.data ?? [];

    for (const entry of entries) {
      trades.push({
        id: entry.id,
        whaleAddress: walletAddress,
        market: entry.market,
        tokenId: entry.asset_id,
        side: entry.side.toUpperCase() === "BUY" ? "BUY" : "SELL",
        price: parseFloat(entry.price),
        size: parseFloat(entry.size),
        timestamp: new Date(entry.timestamp).getTime(),
        txHash: entry.transaction_hash,
      });
    }

    console.log(`[whaleTracker] Found ${trades.length} API trades for ${walletAddress}`);
  } catch (err) {
    console.error("[whaleTracker] Failed to fetch API trades:", err);
  }

  return trades;
}

// ── Kelly Criterion Risk Management ────────────────────────────────────────

/**
 * Calculate optimal position size using Kelly Criterion.
 * 
 * Kelly formula: f* = (bp - q) / b
 * where:
 *   f* = fraction of bankroll to bet
 *   b = odds received (net return on win, e.g., if price is 0.4, odds = 1.5)
 *   p = probability of winning (estimated from whale's win rate)
 *   q = probability of losing (1 - p)
 */
export function calculateKellyFraction(
  winRate: number,
  price: number,
  totalPnl: number,
  bankroll: number
): KellyResult {
  const config = getConfig();

  // Validate inputs
  if (winRate <= 0 || winRate >= 1) {
    return {
      fraction: 0,
      recommendedSize: 0,
      reason: `Invalid win rate: ${winRate}`,
    };
  }

  if (price <= 0 || price >= 1) {
    return {
      fraction: 0,
      recommendedSize: 0,
      reason: `Invalid price: ${price}`,
    };
  }

  if (bankroll <= 0) {
    return {
      fraction: 0,
      recommendedSize: 0,
      reason: "Bankroll is zero or negative",
    };
  }

  // Calculate Kelly parameters
  const p = winRate; // Probability of winning
  const q = 1 - p;   // Probability of losing
  const b = (1 / price) - 1; // Net odds (e.g., price 0.4 → odds 1.5)

  // Kelly formula
  let kelly = (b * p - q) / b;

  // Apply adjustments based on whale's total PnL
  // More profitable whales get slightly higher confidence
  const pnlMultiplier = Math.min(1.2, 1 + (totalPnl / 100000)); // Cap at 20% boost
  kelly *= pnlMultiplier;

  // Apply fractional Kelly (half-Kelly is common for safety)
  const fractionalKelly = kelly * 0.5;

  // Cap at maximum allowed fraction
  const cappedKelly = Math.min(fractionalKelly, config.maxKellyFraction);
  
  // Ensure non-negative
  const finalFraction = Math.max(0, cappedKelly);

  // Calculate recommended position size
  const recommendedSize = Math.round(finalFraction * bankroll * 100) / 100;

  return {
    fraction: finalFraction,
    recommendedSize: recommendedSize,
    reason: kelly <= 0 
      ? "Negative edge - no bet recommended"
      : `Kelly=${(kelly * 100).toFixed(2)}%, Fractional=${(fractionalKelly * 100).toFixed(2)}%, Capped=${(finalFraction * 100).toFixed(2)}%`,
  };
}

// ── Copy Trading Logic ─────────────────────────────────────────────────────

interface CurrentPrice {
  bid?: number;
  ask?: number;
  mid?: number;
}

/**
 * Get current market price for a token.
 */
async function getCurrentPrice(tokenId: string): Promise<CurrentPrice> {
  const config = getConfig();
  
  try {
    const { data } = await axios.get<{ price?: number; bid?: number; ask?: number }>(
      `${config.clobApiUrl}/price`,
      {
        params: { token_id: tokenId },
        timeout: 5_000,
      }
    );

    return {
      bid: data.bid,
      ask: data.ask,
      mid: data.price ?? (data.bid && data.ask ? (data.bid + data.ask) / 2 : undefined),
    };
  } catch {
    return {};
  }
}

/**
 * Determine if we should copy a whale trade based on current market conditions.
 */
export async function shouldCopyTrade(
  trade: WhaleTrade,
  whale: WhaleWallet,
  bankroll: number
): Promise<{
  shouldCopy: boolean;
  reason: string;
  suggestedSize: number;
  currentPrice?: number;
}> {
  const config = getConfig();

  // Check if whale tracking is enabled
  if (!config.enabled) {
    return {
      shouldCopy: false,
      reason: "Whale tracking is disabled",
      suggestedSize: 0,
    };
  }

  // Get current market price
  const currentPrice = await getCurrentPrice(trade.tokenId);
  const price = trade.side === "BUY" ? currentPrice.ask : currentPrice.bid;

  if (!price) {
    return {
      shouldCopy: false,
      reason: "Could not fetch current market price",
      suggestedSize: 0,
    };
  }

  // Check price deviation
  const priceDeviation = Math.abs(price - trade.price) / trade.price;
  if (priceDeviation > config.maxPriceDeviation) {
    return {
      shouldCopy: false,
      reason: `Price deviation too high: ${(priceDeviation * 100).toFixed(2)}% > ${(config.maxPriceDeviation * 100).toFixed(2)}%`,
      suggestedSize: 0,
      currentPrice: price,
    };
  }

  // Calculate Kelly-optimal position size
  const kelly = calculateKellyFraction(
    whale.winRate,
    price,
    whale.totalPnl,
    bankroll
  );

  if (kelly.fraction <= 0) {
    return {
      shouldCopy: false,
      reason: kelly.reason,
      suggestedSize: 0,
      currentPrice: price,
    };
  }

  return {
    shouldCopy: true,
    reason: `Copying trade at ${price.toFixed(4)} (deviation ${(priceDeviation * 100).toFixed(2)}%). ${kelly.reason}`,
    suggestedSize: kelly.recommendedSize,
    currentPrice: price,
  };
}

/**
 * Create a copied trade record with safety delay.
 */
export function createCopiedTrade(
  trade: WhaleTrade,
  size: number,
  currentPrice: number
): CopiedTrade {
  const config = getConfig();

  return {
    id: `copy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    originalTradeId: trade.id,
    whaleAddress: trade.whaleAddress,
    market: trade.market,
    tokenId: trade.tokenId,
    side: trade.side,
    price: currentPrice,
    originalPrice: trade.price,
    size: size,
    timestamp: Date.now(),
    delayMs: config.copyDelayMs,
    status: "PENDING",
  };
}

// ── Main Tracking Loop ─────────────────────────────────────────────────────

let _lastProcessedTrades: Set<string> = new Set();

/**
 * Process new trades from tracked whales.
 * Returns any trades that should be copied.
 */
export async function processWhaleTrades(
  bankroll: number
): Promise<CopiedTrade[]> {
  const history = loadWhaleHistory();
  const copiesToMake: CopiedTrade[] = [];

  for (const whale of history.wallets) {
    try {
      // Fetch recent trades for this whale
      const trades = await fetchWalletTradesApi(whale.address);

      for (const trade of trades) {
        // Skip if we've already processed this trade
        if (_lastProcessedTrades.has(trade.id)) {
          continue;
        }

        // Skip old trades (more than 5 minutes old)
        const tradeAge = Date.now() - trade.timestamp;
        if (tradeAge > 5 * 60 * 1000) {
          _lastProcessedTrades.add(trade.id);
          continue;
        }

        // Evaluate if we should copy
        const evaluation = await shouldCopyTrade(trade, whale, bankroll);

        if (evaluation.shouldCopy && evaluation.currentPrice) {
          const copiedTrade = createCopiedTrade(
            trade,
            evaluation.suggestedSize,
            evaluation.currentPrice
          );
          copiedTrade.reason = evaluation.reason;
          copiesToMake.push(copiedTrade);
          console.log(
            `[whaleTracker] Copying trade from ${whale.address}: ${trade.side} ${evaluation.suggestedSize} @ ${evaluation.currentPrice}`
          );
        } else {
          console.log(
            `[whaleTracker] Skipping trade from ${whale.address}: ${evaluation.reason}`
          );
        }

        // Mark as processed
        _lastProcessedTrades.add(trade.id);

        // Record in history
        if (!history.trades.find((t) => t.id === trade.id)) {
          history.trades.push(trade);
        }
      }
    } catch (err) {
      console.error(`[whaleTracker] Error processing whale ${whale.address}:`, err);
    }
  }

  // Save updated history
  if (copiesToMake.length > 0) {
    history.copiedTrades.push(...copiesToMake);
    history.lastSyncTimestamp = Date.now();
    saveWhaleHistory(history);
  }

  return copiesToMake;
}

/**
 * Refresh the list of tracked whales.
 */
export async function refreshWhaleList(): Promise<void> {
  const history = loadWhaleHistory();

  // Fetch from leaderboard
  const leaderboardWhales = await fetchProfitableWallets();

  // Search for specific profitable patterns
  const searchWhales = await searchProfitableTraders();

  // Merge new whales with existing (update if already exists)
  const whaleMap = new Map<string, WhaleWallet>();

  // Keep existing whales
  for (const whale of history.wallets) {
    whaleMap.set(whale.address.toLowerCase(), whale);
  }

  // Update with new data
  for (const whale of [...leaderboardWhales, ...searchWhales]) {
    const existing = whaleMap.get(whale.address.toLowerCase());
    if (existing) {
      // Update existing whale
      existing.totalPnl = whale.totalPnl;
      existing.winRate = whale.winRate;
      existing.tradeCount = whale.tradeCount;
      existing.lastUpdated = whale.lastUpdated;
      if (whale.tags) {
        existing.tags = [...new Set([...(existing.tags ?? []), ...whale.tags])];
      }
    } else {
      // Add new whale
      whaleMap.set(whale.address.toLowerCase(), whale);
    }
  }

  history.wallets = Array.from(whaleMap.values());
  history.lastSyncTimestamp = Date.now();
  saveWhaleHistory(history);

  console.log(`[whaleTracker] Whale list refreshed: ${history.wallets.length} whales tracked`);
}

/**
 * Add a specific wallet to track.
 */
export function addWhaleWallet(wallet: WhaleWallet): void {
  const history = loadWhaleHistory();
  
  // Check if already exists
  const idx = history.wallets.findIndex(
    (w) => w.address.toLowerCase() === wallet.address.toLowerCase()
  );

  if (idx >= 0) {
    history.wallets[idx] = wallet;
  } else {
    history.wallets.push(wallet);
  }

  saveWhaleHistory(history);
  console.log(`[whaleTracker] Added whale wallet: ${wallet.address}`);
}

/**
 * Remove a wallet from tracking.
 */
export function removeWhaleWallet(address: string): void {
  const history = loadWhaleHistory();
  history.wallets = history.wallets.filter(
    (w) => w.address.toLowerCase() !== address.toLowerCase()
  );
  saveWhaleHistory(history);
  console.log(`[whaleTracker] Removed whale wallet: ${address}`);
}

/**
 * Get all tracked whales.
 */
export function getTrackedWhales(): WhaleWallet[] {
  return loadWhaleHistory().wallets;
}

/**
 * Get whale tracking statistics.
 */
export function getWhaleStats(): {
  totalWhales: number;
  totalTrades: number;
  totalCopiedTrades: number;
  pendingCopies: number;
  executedCopies: number;
  totalCopiedPnl: number;
} {
  const history = loadWhaleHistory();
  
  const copiedPnl = history.copiedTrades.reduce(
    (sum, t) => sum + (t.pnl ?? 0),
    0
  );

  return {
    totalWhales: history.wallets.length,
    totalTrades: history.trades.length,
    totalCopiedTrades: history.copiedTrades.length,
    pendingCopies: history.copiedTrades.filter((t) => t.status === "PENDING").length,
    executedCopies: history.copiedTrades.filter((t) => t.status === "EXECUTED").length,
    totalCopiedPnl: Math.round(copiedPnl * 100) / 100,
  };
}

/**
 * Update the status of a copied trade.
 */
export function updateCopiedTradeStatus(
  id: string,
  status: CopiedTrade["status"],
  pnl?: number
): void {
  const history = loadWhaleHistory();
  const trade = history.copiedTrades.find((t) => t.id === id);
  
  if (trade) {
    trade.status = status;
    if (pnl !== undefined) {
      trade.pnl = pnl;
    }
    saveWhaleHistory(history);
  }
}

// ── Tracking Control ───────────────────────────────────────────────────────

const TRACKING_INTERVAL_MS = 30_000; // Check for new whale trades every 30 seconds
const WHALE_REFRESH_INTERVAL_MS = 15 * 60 * 1000; // Refresh whale list every 15 minutes

let _lastWhaleRefresh = 0;

/**
 * Start the whale tracking loop.
 * Returns a callback to process pending copies.
 */
export async function startWhaleTracking(
  onCopiesReady: (copies: CopiedTrade[]) => Promise<void>,
  getBankroll: () => Promise<number>
): Promise<void> {
  const config = getConfig();

  if (!config.enabled) {
    console.log("[whaleTracker] Whale tracking is disabled (set WHALE_TRACKING_ENABLED=true to enable)");
    return;
  }

  if (_isTracking) {
    console.log("[whaleTracker] Already tracking");
    return;
  }

  _isTracking = true;
  console.log("[whaleTracker] Starting whale tracking...");

  // Initial whale list refresh
  await refreshWhaleList();
  _lastWhaleRefresh = Date.now();

  const tick = async () => {
    if (!_isTracking) return;

    try {
      // Periodically refresh whale list
      if (Date.now() - _lastWhaleRefresh > WHALE_REFRESH_INTERVAL_MS) {
        await refreshWhaleList();
        _lastWhaleRefresh = Date.now();
      }

      // Get current bankroll
      const bankroll = await getBankroll();

      // Process whale trades
      const copies = await processWhaleTrades(bankroll);

      // Notify callback of pending copies (with delay)
      if (copies.length > 0) {
        console.log(`[whaleTracker] ${copies.length} trades queued for copying with ${config.copyDelayMs}ms delay`);
        
        // Apply safety delay before executing
        await new Promise((resolve) => setTimeout(resolve, config.copyDelayMs));
        
        await onCopiesReady(copies);
      }
    } catch (err) {
      console.error("[whaleTracker] Error in tracking tick:", err);
    }
  };

  // Run initial tick
  await tick();

  // Set up interval
  _trackingTimer = setInterval(tick, TRACKING_INTERVAL_MS);
}

/**
 * Stop the whale tracking loop.
 */
export function stopWhaleTracking(): void {
  if (_trackingTimer) {
    clearInterval(_trackingTimer);
    _trackingTimer = null;
  }
  _isTracking = false;
  console.log("[whaleTracker] Whale tracking stopped");
}

/**
 * Check if whale tracking is currently running.
 */
export function isWhaleTrackingRunning(): boolean {
  return _isTracking;
}
