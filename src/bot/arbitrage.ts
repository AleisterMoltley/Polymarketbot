import axios, { AxiosError } from "axios";
import { getWallet, getTokenBalance } from "../utils/wallet";
import { recordTrade, getAllTrades } from "../admin/stats";
import { getItem, setItem } from "../utils/jsonStore";
import type { TradeRecord } from "../admin/stats";

// ── Types ──────────────────────────────────────────────────────────────────

export interface KalshiMarket {
  ticker: string;
  title: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  status: string;
}

export interface PolymarketPrice {
  conditionId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
}

export interface ArbitrageOpportunity {
  id: string;
  polymarketId: string;
  kalshiTicker: string;
  polymarketYesPrice: number;
  kalshiYesPrice: number;
  priceDifference: number;
  direction: "BUY_POLY_SELL_KALSHI" | "BUY_KALSHI_SELL_POLY";
  potentialProfit: number;
  timestamp: number;
}

interface ArbitrageConfig {
  minPriceDifference: number;
  maxBankrollPercentage: number;
  cooldownMs: number;
  kalshiApiUrl: string;
  kalshiApiKey: string;
}

interface ExecutedArbitrage {
  opportunityId: string;
  timestamp: number;
  polyTrade: TradeRecord;
  kalshiOrderId?: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  profit?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const ARBITRAGE_KEY = "arbitrageOpportunities";
const EXECUTED_ARBITRAGE_KEY = "executedArbitrages";
const LAST_ARBITRAGE_KEY = "lastArbitrageTime";
const BANKROLL_KEY = "arbitrageBankroll";

const DEFAULT_KALSHI_API_URL = "https://trading-api.kalshi.com/trade-api/v2";

// ── State ──────────────────────────────────────────────────────────────────

let _arbIdCounter = 0;
let _isRunning = false;
let _arbitrageTimer: NodeJS.Timeout | null = null;

function newArbId(): string {
  return `arb-${Date.now()}-${++_arbIdCounter}`;
}

// ── Configuration ──────────────────────────────────────────────────────────

function getConfig(): ArbitrageConfig {
  return {
    minPriceDifference: parseFloat(process.env.ARB_MIN_PRICE_DIFF ?? "0.03"),
    maxBankrollPercentage: parseFloat(process.env.ARB_MAX_BANKROLL_PCT ?? "0.05"),
    cooldownMs: parseInt(process.env.ARB_COOLDOWN_MS ?? "60000", 10),
    kalshiApiUrl: process.env.KALSHI_API_URL ?? DEFAULT_KALSHI_API_URL,
    kalshiApiKey: process.env.KALSHI_API_KEY ?? "",
  };
}

// ── Bankroll Management ────────────────────────────────────────────────────

/**
 * Get the current arbitrage bankroll (USDC amount available for arbitrage).
 * Falls back to checking wallet balance if not explicitly set.
 */
export async function getBankroll(): Promise<number> {
  const storedBankroll = getItem<number>(BANKROLL_KEY);
  if (storedBankroll !== undefined) {
    return storedBankroll;
  }

  // Try to get actual USDC balance
  try {
    const balance = await getTokenBalance("USDC");
    return parseFloat(balance);
  } catch {
    console.warn("[arbitrage] Could not fetch wallet balance, using default");
    return parseFloat(process.env.ARB_DEFAULT_BANKROLL ?? "1000");
  }
}

/**
 * Set the arbitrage bankroll manually.
 */
export function setBankroll(amount: number): void {
  setItem(BANKROLL_KEY, amount, true);
}

/**
 * Calculate the maximum trade size based on bankroll percentage limit.
 */
export async function getMaxTradeSize(): Promise<number> {
  const config = getConfig();
  const bankroll = await getBankroll();
  return Math.floor(bankroll * config.maxBankrollPercentage * 100) / 100;
}

// ── Kalshi API Integration ─────────────────────────────────────────────────

/**
 * Fetch markets from Kalshi API.
 * Uses the public markets endpoint with optional authentication.
 */
export async function fetchKalshiMarkets(): Promise<KalshiMarket[]> {
  const config = getConfig();
  
  try {
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "Content-Type": "application/json",
    };

    // Add auth header if API key is provided
    if (config.kalshiApiKey) {
      headers["Authorization"] = `Bearer ${config.kalshiApiKey}`;
    }

    const { data } = await axios.get<{ markets: KalshiMarket[] }>(
      `${config.kalshiApiUrl}/markets`,
      {
        headers,
        params: {
          status: "active",
          limit: 100,
        },
        timeout: 15000,
      }
    );

    return data.markets ?? [];
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response) {
      console.error(`[arbitrage] Kalshi API error: ${axiosErr.response.status} - ${JSON.stringify(axiosErr.response.data)}`);
    } else {
      console.error("[arbitrage] fetchKalshiMarkets error:", err);
    }
    return [];
  }
}

/**
 * Fetch a specific market from Kalshi by ticker.
 */
export async function fetchKalshiMarket(ticker: string): Promise<KalshiMarket | null> {
  const config = getConfig();
  
  try {
    const headers: Record<string, string> = {
      "Accept": "application/json",
    };

    if (config.kalshiApiKey) {
      headers["Authorization"] = `Bearer ${config.kalshiApiKey}`;
    }

    const { data } = await axios.get<{ market: KalshiMarket }>(
      `${config.kalshiApiUrl}/markets/${ticker}`,
      {
        headers,
        timeout: 10000,
      }
    );

    return data.market ?? null;
  } catch (err) {
    console.error(`[arbitrage] Error fetching Kalshi market ${ticker}:`, err);
    return null;
  }
}

// ── Polymarket Price Integration ───────────────────────────────────────────

/**
 * Fetch current prices from Polymarket CLOB API.
 */
export async function fetchPolymarketPrices(): Promise<PolymarketPrice[]> {
  const baseUrl = process.env.CLOB_API_URL ?? "https://clob.polymarket.com";
  
  try {
    const { data } = await axios.get<{ data: Array<{
      conditionId: string;
      question: string;
      outcomes: string[];
      prices: number[];
    }> }>(`${baseUrl}/markets`, {
      params: { active: true, closed: false },
      timeout: 10000,
    });

    return (data.data ?? []).map((market) => ({
      conditionId: market.conditionId,
      question: market.question,
      yesPrice: market.prices[0] ?? 0,
      noPrice: market.prices[1] ?? 0,
    }));
  } catch (err) {
    console.error("[arbitrage] fetchPolymarketPrices error:", err);
    return [];
  }
}

// ── Market Matching ────────────────────────────────────────────────────────

/**
 * Map of known market pairs between Polymarket and Kalshi.
 * In production, this would be dynamically maintained or use NLP matching.
 * Key: Polymarket conditionId, Value: Kalshi ticker
 */
const MARKET_PAIRS = getItem<Record<string, string>>("marketPairs") ?? {};

/**
 * Register a market pair between Polymarket and Kalshi.
 */
export function registerMarketPair(polymarketId: string, kalshiTicker: string): void {
  MARKET_PAIRS[polymarketId] = kalshiTicker;
  setItem("marketPairs", MARKET_PAIRS, true);
  console.log(`[arbitrage] Registered market pair: ${polymarketId} <-> ${kalshiTicker}`);
}

/**
 * Get all registered market pairs.
 */
export function getMarketPairs(): Record<string, string> {
  return { ...MARKET_PAIRS };
}

// ── Arbitrage Detection ────────────────────────────────────────────────────

/**
 * Detect arbitrage opportunities by comparing prices between platforms.
 * Looks for mispricings where the price difference exceeds the threshold.
 * 
 * Example: If Polymarket Yes = 0.60 and Kalshi Yes = 0.55,
 * there's a 0.05 difference that could be arbitraged.
 */
export async function detectArbitrageOpportunities(): Promise<ArbitrageOpportunity[]> {
  const config = getConfig();
  const opportunities: ArbitrageOpportunity[] = [];

  // Fetch prices from both platforms
  const [polyPrices, kalshiMarkets] = await Promise.all([
    fetchPolymarketPrices(),
    fetchKalshiMarkets(),
  ]);

  console.log(`[arbitrage] Fetched ${polyPrices.length} Polymarket markets, ${kalshiMarkets.length} Kalshi markets`);

  // Create lookup map for Kalshi markets by ticker
  const kalshiByTicker = new Map<string, KalshiMarket>();
  for (const market of kalshiMarkets) {
    kalshiByTicker.set(market.ticker, market);
  }

  // Compare prices for matched markets
  for (const polyMarket of polyPrices) {
    const kalshiTicker = MARKET_PAIRS[polyMarket.conditionId];
    if (!kalshiTicker) continue;

    const kalshiMarket = kalshiByTicker.get(kalshiTicker);
    if (!kalshiMarket || kalshiMarket.status !== "active") continue;

    // Calculate Yes price from Kalshi (using mid-price of bid/ask)
    const kalshiYesPrice = (kalshiMarket.yes_bid + kalshiMarket.yes_ask) / 2;
    const polyYesPrice = polyMarket.yesPrice;

    // Check for mispricing
    const priceDiff = Math.abs(polyYesPrice - kalshiYesPrice);

    if (priceDiff >= config.minPriceDifference) {
      const direction: ArbitrageOpportunity["direction"] =
        polyYesPrice < kalshiYesPrice
          ? "BUY_POLY_SELL_KALSHI"
          : "BUY_KALSHI_SELL_POLY";

      // Estimate potential profit (simplified - doesn't account for fees)
      const potentialProfit = priceDiff;

      const opportunity: ArbitrageOpportunity = {
        id: newArbId(),
        polymarketId: polyMarket.conditionId,
        kalshiTicker,
        polymarketYesPrice: polyYesPrice,
        kalshiYesPrice,
        priceDifference: Math.round(priceDiff * 10000) / 10000,
        direction,
        potentialProfit: Math.round(potentialProfit * 10000) / 10000,
        timestamp: Date.now(),
      };

      opportunities.push(opportunity);
      console.log(
        `[arbitrage] Found opportunity: ${direction} | Poly=${polyYesPrice.toFixed(4)} Kalshi=${kalshiYesPrice.toFixed(4)} | Diff=${priceDiff.toFixed(4)}`
      );
    }
  }

  // Store opportunities for reference
  setItem(ARBITRAGE_KEY, opportunities, true);

  return opportunities;
}

// ── Arbitrage Execution ────────────────────────────────────────────────────

/**
 * Execute an arbitrage opportunity.
 * Places orders on both platforms to lock in the price difference.
 */
export async function executeArbitrage(opportunity: ArbitrageOpportunity): Promise<ExecutedArbitrage> {
  const config = getConfig();
  const isPaper = process.env.PAPER_TRADE === "true";
  const maxSize = await getMaxTradeSize();

  // Check cooldown
  const lastArbitrageTime = getItem<number>(LAST_ARBITRAGE_KEY) ?? 0;
  const timeSinceLastArb = Date.now() - lastArbitrageTime;
  
  if (timeSinceLastArb < config.cooldownMs) {
    console.log(
      `[arbitrage] Cooldown active. ${Math.ceil((config.cooldownMs - timeSinceLastArb) / 1000)}s remaining`
    );
    throw new Error("Arbitrage cooldown active");
  }

  // Calculate trade size (capped at 5% of bankroll)
  const tradeSize = Math.min(maxSize, 50); // Also cap at $50 for safety

  console.log(`[arbitrage] Executing ${opportunity.direction} with size $${tradeSize}`);

  const executed: ExecutedArbitrage = {
    opportunityId: opportunity.id,
    timestamp: Date.now(),
    polyTrade: {
      id: `arb-trade-${Date.now()}`,
      market: opportunity.polymarketId,
      side: opportunity.direction === "BUY_POLY_SELL_KALSHI" ? "BUY" : "SELL",
      outcome: "YES",
      price: opportunity.polymarketYesPrice,
      size: tradeSize,
      timestamp: Date.now(),
      paper: isPaper,
      status: "OPEN",
    },
    status: "PENDING",
  };

  try {
    if (isPaper) {
      // Paper trade - simulate execution
      console.log(`[arbitrage] [PAPER] ${executed.polyTrade.side} $${tradeSize} on Polymarket @ ${opportunity.polymarketYesPrice}`);
      console.log(`[arbitrage] [PAPER] ${executed.polyTrade.side === "BUY" ? "SELL" : "BUY"} $${tradeSize} on Kalshi @ ${opportunity.kalshiYesPrice}`);
      
      executed.polyTrade.status = "FILLED";
      executed.status = "COMPLETED";
      executed.profit = tradeSize * opportunity.priceDifference;
      executed.polyTrade.pnl = executed.profit;
    } else {
      // Live trade - submit real orders
      // Check balance first
      const balance = await getTokenBalance("USDC");
      if (parseFloat(balance) < tradeSize) {
        throw new Error(`Insufficient USDC balance: ${balance} < ${tradeSize}`);
      }

      // Execute Polymarket order
      await submitPolymarketOrder(executed.polyTrade);
      executed.polyTrade.status = "FILLED";

      // Execute Kalshi order
      const kalshiOrderId = await submitKalshiOrder(
        opportunity.kalshiTicker,
        executed.polyTrade.side === "BUY" ? "sell" : "buy",
        opportunity.kalshiYesPrice,
        tradeSize
      );
      executed.kalshiOrderId = kalshiOrderId;

      executed.status = "COMPLETED";
      executed.profit = tradeSize * opportunity.priceDifference;
      executed.polyTrade.pnl = executed.profit;
    }
  } catch (err) {
    console.error("[arbitrage] Execution failed:", err);
    executed.status = "FAILED";
    executed.polyTrade.status = "CANCELLED";
  }

  // Record the trade and update cooldown
  recordTrade(executed.polyTrade);
  setItem(LAST_ARBITRAGE_KEY, Date.now(), true);

  // Store executed arbitrage
  const executedArbitrages = getItem<ExecutedArbitrage[]>(EXECUTED_ARBITRAGE_KEY) ?? [];
  executedArbitrages.push(executed);
  setItem(EXECUTED_ARBITRAGE_KEY, executedArbitrages, true);

  return executed;
}

/**
 * Submit an order to Polymarket CLOB API.
 */
async function submitPolymarketOrder(trade: TradeRecord): Promise<void> {
  const baseUrl = process.env.CLOB_API_URL ?? "https://clob.polymarket.com";
  const wallet = getWallet();
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const headers = {
    "POLY_ADDRESS": wallet.address,
    "POLY_SIGNATURE": await wallet.signMessage(timestamp),
    "POLY_TIMESTAMP": timestamp,
    "POLY_API_KEY": process.env.CLOB_API_KEY ?? "",
    "POLY_API_SECRET": process.env.CLOB_API_SECRET ?? "",
    "POLY_PASSPHRASE": process.env.CLOB_API_PASSPHRASE ?? "",
  };

  await axios.post(
    `${baseUrl}/order`,
    {
      market: trade.market,
      side: trade.side,
      price: trade.price,
      size: trade.size,
      outcome: trade.outcome,
    },
    { headers, timeout: 10000 }
  );
}

/**
 * Submit an order to Kalshi API.
 */
async function submitKalshiOrder(
  ticker: string,
  side: "buy" | "sell",
  price: number,
  size: number
): Promise<string> {
  const config = getConfig();

  if (!config.kalshiApiKey) {
    throw new Error("KALSHI_API_KEY not configured");
  }

  // Convert price to cents (Kalshi uses integer cents 1-99)
  const priceCents = Math.round(price * 100);

  const { data } = await axios.post<{ order: { order_id: string } }>(
    `${config.kalshiApiUrl}/portfolio/orders`,
    {
      ticker,
      action: side,
      type: "limit",
      side: "yes",
      count: Math.round(size), // Kalshi uses contract count
      yes_price: priceCents,
    },
    {
      headers: {
        "Authorization": `Bearer ${config.kalshiApiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    }
  );

  return data.order?.order_id ?? "";
}

// ── Arbitrage Loop ─────────────────────────────────────────────────────────

/**
 * Main arbitrage loop - continuously scans for and executes opportunities.
 */
export async function runArbitrageLoop(): Promise<void> {
  const interval = parseInt(process.env.ARB_POLL_INTERVAL_MS ?? "30000", 10);
  const autoExecute = process.env.ARB_AUTO_EXECUTE === "true";
  
  console.log(`[arbitrage] Starting loop (interval=${interval}ms, autoExecute=${autoExecute})`);
  _isRunning = true;

  const tick = async () => {
    if (!_isRunning) return;

    try {
      const opportunities = await detectArbitrageOpportunities();
      console.log(`[arbitrage] Found ${opportunities.length} opportunities`);

      if (autoExecute && opportunities.length > 0) {
        // Execute the best opportunity (highest potential profit)
        const sorted = opportunities.sort((a, b) => b.potentialProfit - a.potentialProfit);
        const best = sorted[0];

        console.log(`[arbitrage] Auto-executing best opportunity: ${best.id}`);
        try {
          const result = await executeArbitrage(best);
          console.log(
            `[arbitrage] Execution ${result.status}: profit=${result.profit?.toFixed(4) ?? "N/A"}`
          );
        } catch (err) {
          console.error("[arbitrage] Auto-execution failed:", err);
        }
      }
    } catch (err) {
      console.error("[arbitrage] Error in arbitrage tick:", err);
    }
  };

  await tick();
  _arbitrageTimer = setInterval(tick, interval);
}

/**
 * Stop the arbitrage loop gracefully.
 */
export function stopArbitrageLoop(): void {
  console.log("[arbitrage] Stopping arbitrage loop...");
  _isRunning = false;
  if (_arbitrageTimer) {
    clearInterval(_arbitrageTimer);
    _arbitrageTimer = null;
  }
  console.log("[arbitrage] Arbitrage loop stopped");
}

/**
 * Check if the arbitrage loop is currently running.
 */
export function isArbitrageLoopRunning(): boolean {
  return _isRunning;
}

// ── Stats & Monitoring ─────────────────────────────────────────────────────

/**
 * Get current arbitrage statistics.
 */
export function getArbitrageStats(): {
  totalOpportunities: number;
  executedArbitrages: number;
  completedArbitrages: number;
  failedArbitrages: number;
  totalProfit: number;
  lastScanTime: number | null;
  isRunning: boolean;
} {
  const opportunities = getItem<ArbitrageOpportunity[]>(ARBITRAGE_KEY) ?? [];
  const executed = getItem<ExecutedArbitrage[]>(EXECUTED_ARBITRAGE_KEY) ?? [];
  const lastScan = getItem<number>(LAST_ARBITRAGE_KEY);

  const completed = executed.filter((e) => e.status === "COMPLETED");
  const failed = executed.filter((e) => e.status === "FAILED");
  const totalProfit = completed.reduce((sum, e) => sum + (e.profit ?? 0), 0);

  return {
    totalOpportunities: opportunities.length,
    executedArbitrages: executed.length,
    completedArbitrages: completed.length,
    failedArbitrages: failed.length,
    totalProfit: Math.round(totalProfit * 100) / 100,
    lastScanTime: lastScan ?? null,
    isRunning: _isRunning,
  };
}

/**
 * Get all detected opportunities.
 */
export function getOpportunities(): ArbitrageOpportunity[] {
  return getItem<ArbitrageOpportunity[]>(ARBITRAGE_KEY) ?? [];
}

/**
 * Get all executed arbitrages.
 */
export function getExecutedArbitrages(): ExecutedArbitrage[] {
  return getItem<ExecutedArbitrage[]>(EXECUTED_ARBITRAGE_KEY) ?? [];
}
