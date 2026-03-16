import axios from "axios";
import { getWallet, getTokenBalance } from "../utils/wallet";
import { recordTrade, getAllTrades } from "../admin/stats";
import { getItem, setItem } from "../utils/jsonStore";
import {
  getBankroll,
  initializeBankroll,
  updateBankroll,
  calculatePositionSize,
  calculateStopLossPrice,
  calculateTakeProfitPrice,
  validateTradeRisk,
  addRiskPosition,
  removeRiskPosition,
  findRiskPosition,
  getRiskPositions,
  shouldTriggerStopLoss,
  shouldTriggerTakeProfit,
  flushRiskData,
  DEFAULT_RISK_PER_TRADE,
  DEFAULT_STOP_LOSS_PERCENT,
  DEFAULT_TAKE_PROFIT_PERCENT,
  type RiskPosition,
} from "../utils/risk";
import type { TradeRecord } from "../admin/stats";

let _tradeIdCounter = 0;
function newId(): string {
  return `trade-${Date.now()}-${++_tradeIdCounter}`;
}

export interface Market {
  conditionId: string;
  question: string;
  outcomes: string[];
  prices: number[];
}

/** Track open positions to prevent duplicates */
interface Position {
  market: string;
  outcome: string;
  size: number;
  entryPrice: number;
  timestamp: number;
}

const POSITIONS_KEY = "positions";

// Risk management configuration from environment
const RISK_PER_TRADE = parseFloat(process.env.RISK_PER_TRADE ?? String(DEFAULT_RISK_PER_TRADE));
const STOP_LOSS_PERCENT = parseFloat(process.env.STOP_LOSS_PERCENT ?? String(DEFAULT_STOP_LOSS_PERCENT));
const TAKE_PROFIT_PERCENT = parseFloat(process.env.TAKE_PROFIT_PERCENT ?? String(DEFAULT_TAKE_PROFIT_PERCENT));
const INITIAL_BANKROLL = parseFloat(process.env.INITIAL_BANKROLL ?? "1000");
const MAX_DRAWDOWN_PERCENT = parseFloat(process.env.MAX_DRAWDOWN_PERCENT ?? "20");

function getPositions(): Position[] {
  return getItem<Position[]>(POSITIONS_KEY) ?? [];
}

function addPosition(pos: Position): void {
  const positions = getPositions();
  positions.push(pos);
  setItem(POSITIONS_KEY, positions, true);
}

function hasExistingPosition(market: string, outcome: string): boolean {
  return getPositions().some((p) => p.market === market && p.outcome === outcome);
}

function removePosition(market: string, outcome: string): void {
  const positions = getPositions();
  const filtered = positions.filter((p) => !(p.market === market && p.outcome === outcome));
  setItem(POSITIONS_KEY, filtered, true);
}

/** Fetch a list of active markets from the Polymarket CLOB API. */
export async function fetchMarkets(): Promise<Market[]> {
  const baseUrl = process.env.CLOB_API_URL ?? "https://clob.polymarket.com";
  try {
    const { data } = await axios.get<{ data: Market[] }>(`${baseUrl}/markets`, {
      params: { active: true, closed: false },
      timeout: 10_000,
    });
    return data.data ?? [];
  } catch (err) {
    console.error("[trading] fetchMarkets error:", err);
    return [];
  }
}

/**
 * Evaluate a market and return a trade signal if edge exceeds MIN_EDGE.
 * In paper-trade mode no real order is sent.
 * Includes position tracking to prevent duplicate orders and balance checks.
 * Now integrates risk management with stop-loss, position sizing, and bankroll tracking.
 */
export async function evaluateAndTrade(market: Market): Promise<void> {
  const minEdge = parseFloat(process.env.MIN_EDGE ?? "0.05");
  const maxSize = parseFloat(process.env.MAX_POSITION_SIZE_USDC ?? "100");
  const isPaper = process.env.PAPER_TRADE === "true";

  // Initialize bankroll if not already initialized
  let bankroll = getBankroll();
  if (!bankroll) {
    bankroll = initializeBankroll(INITIAL_BANKROLL);
    console.log(`[trading] Initialized bankroll with $${INITIAL_BANKROLL}`);
  }

  for (let i = 0; i < market.outcomes.length; i++) {
    const price = market.prices[i];
    if (price === undefined) continue;

    const outcome = market.outcomes[i];

    // Check for existing position to prevent duplicates
    if (hasExistingPosition(market.conditionId, outcome)) {
      console.log(`[trading] Skipping duplicate position: ${market.conditionId} / ${outcome}`);
      continue;
    }

    // Simple edge model: buy if implied probability is below (1 - MIN_EDGE)
    const edge = 1 - price - minEdge;
    if (edge <= 0) continue;

    // Calculate stop-loss and take-profit prices for risk management
    const stopLossPrice = calculateStopLossPrice(price, "BUY", STOP_LOSS_PERCENT);
    const takeProfitPrice = calculateTakeProfitPrice(price, "BUY", TAKE_PROFIT_PERCENT);

    // Calculate position size using 2% risk rule instead of simple edge-based sizing
    let size = calculatePositionSize(
      bankroll.currentCapital,
      price,
      stopLossPrice,
      RISK_PER_TRADE
    );

    // Cap at max position size
    size = Math.min(maxSize, size);

    // Round to 2 decimal places (cents) for USDC sizing
    const CENTS = 100;
    size = Math.round(size * CENTS) / CENTS;

    // Validate the trade against risk management rules
    const riskValidation = validateTradeRisk(size, bankroll.currentCapital, MAX_DRAWDOWN_PERCENT);
    if (!riskValidation.valid) {
      console.warn(`[trading] Trade rejected by risk management: ${riskValidation.reason}`);
      continue;
    }

    // Check balance for live trades
    if (!isPaper) {
      try {
        const balance = await getTokenBalance("USDC");
        if (parseFloat(balance) < size) {
          console.warn(`[trading] Insufficient USDC balance (${balance}) for trade size (${size})`);
          continue;
        }
      } catch (err) {
        console.warn("[trading] Could not check balance, proceeding anyway:", err);
      }
    }

    const trade: TradeRecord = {
      id: newId(),
      market: market.conditionId,
      side: "BUY",
      outcome,
      price,
      size,
      timestamp: Date.now(),
      paper: isPaper,
      status: "OPEN",
    };

    // Create risk position for stop-loss tracking
    const riskPosition: RiskPosition = {
      id: trade.id,
      market: market.conditionId,
      outcome,
      entryPrice: price,
      size,
      stopLossPrice,
      takeProfitPrice,
      openedAt: Date.now(),
    };

    if (!isPaper) {
      try {
        await submitOrder(trade);
        trade.status = "FILLED";
        // Track the position
        addPosition({
          market: market.conditionId,
          outcome,
          size,
          entryPrice: price,
          timestamp: Date.now(),
        });
        // Add risk position for stop-loss monitoring
        addRiskPosition(riskPosition);
        console.log(`[trading] Opened position with stop-loss @ ${stopLossPrice.toFixed(4)}, TP @ ${takeProfitPrice.toFixed(4)}`);
      } catch (err) {
        console.error("[trading] submitOrder error:", err);
        trade.status = "CANCELLED";
      }
    } else {
      console.log(`[paper-trade] BUY ${size} USDC of "${outcome}" @ ${price} (SL: ${stopLossPrice.toFixed(4)}, TP: ${takeProfitPrice.toFixed(4)})`);
      trade.status = "FILLED";
      trade.pnl = 0;
      // Track paper position too
      addPosition({
        market: market.conditionId,
        outcome,
        size,
        entryPrice: price,
        timestamp: Date.now(),
      });
      // Add risk position for stop-loss monitoring
      addRiskPosition(riskPosition);
    }

    recordTrade(trade);
  }
}

/**
 * Submit a real order to the Polymarket CLOB API.
 * Requires CLOB_API_KEY, CLOB_API_SECRET, CLOB_API_PASSPHRASE.
 */
async function submitOrder(trade: TradeRecord): Promise<void> {
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
    { headers, timeout: 10_000 }
  );
}

let _tradingLoopTimer: NodeJS.Timeout | null = null;
let _isRunning = false;

/** Main trading loop — polls markets and evaluates trade signals. */
export async function runTradingLoop(): Promise<void> {
  const interval = parseInt(process.env.POLL_INTERVAL_MS ?? "30000", 10);
  console.log(`[trading] Starting loop (interval=${interval}ms, paper=${process.env.PAPER_TRADE})`);
  _isRunning = true;

  const tick = async () => {
    if (!_isRunning) return;
    
    try {
      const markets = await fetchMarkets();
      console.log(`[trading] Evaluating ${markets.length} markets…`);
      
      // First, check existing positions for stop-loss and take-profit
      await checkStopLossAndTakeProfit(markets);
      
      // Then evaluate new trading opportunities
      for (const market of markets) {
        if (!_isRunning) break;
        await evaluateAndTrade(market);
      }
    } catch (err) {
      console.error("[trading] Error in trading tick:", err);
    }
  };

  await tick();
  _tradingLoopTimer = setInterval(tick, interval);
}

/** Stop the trading loop gracefully. */
export function stopTradingLoop(): void {
  console.log("[trading] Stopping trading loop...");
  _isRunning = false;
  if (_tradingLoopTimer) {
    clearInterval(_tradingLoopTimer);
    _tradingLoopTimer = null;
  }
  console.log("[trading] Trading loop stopped");
}

/** Check if the trading loop is currently running. */
export function isTradingLoopRunning(): boolean {
  return _isRunning;
}

/**
 * Check all open risk positions against current market prices
 * and execute stop-loss or take-profit if triggered.
 */
export async function checkStopLossAndTakeProfit(markets: Market[]): Promise<void> {
  const riskPositions = getRiskPositions();
  const isPaper = process.env.PAPER_TRADE === "true";

  if (riskPositions.length === 0) return;

  // Create a price lookup from current market data
  const priceMap = new Map<string, Map<string, number>>();
  for (const market of markets) {
    const marketPrices = new Map<string, number>();
    for (let i = 0; i < market.outcomes.length; i++) {
      if (market.prices[i] !== undefined) {
        marketPrices.set(market.outcomes[i], market.prices[i]);
      }
    }
    priceMap.set(market.conditionId, marketPrices);
  }

  for (const position of riskPositions) {
    const marketPrices = priceMap.get(position.market);
    if (!marketPrices) continue;

    const currentPrice = marketPrices.get(position.outcome);
    if (currentPrice === undefined) continue;

    // Check for stop-loss trigger
    if (shouldTriggerStopLoss(position, currentPrice, "BUY")) {
      console.log(`[trading] 🛑 STOP-LOSS triggered for ${position.market}/${position.outcome} @ ${currentPrice.toFixed(4)}`);
      await closePosition(position, currentPrice, "STOP_LOSS", isPaper);
      continue;
    }

    // Check for take-profit trigger
    if (shouldTriggerTakeProfit(position, currentPrice, "BUY")) {
      console.log(`[trading] 💰 TAKE-PROFIT triggered for ${position.market}/${position.outcome} @ ${currentPrice.toFixed(4)}`);
      await closePosition(position, currentPrice, "TAKE_PROFIT", isPaper);
      continue;
    }
  }
}

/**
 * Close a position and update bankroll.
 */
async function closePosition(
  position: RiskPosition,
  exitPrice: number,
  reason: "STOP_LOSS" | "TAKE_PROFIT" | "MANUAL",
  isPaper: boolean
): Promise<void> {
  // Calculate PNL
  const pnl = (exitPrice - position.entryPrice) * position.size;
  
  // Create sell trade record
  const trade: TradeRecord = {
    id: newId(),
    market: position.market,
    side: "SELL",
    outcome: position.outcome,
    price: exitPrice,
    size: position.size,
    timestamp: Date.now(),
    paper: isPaper,
    status: "FILLED",
    pnl: Math.round(pnl * 100) / 100,
  };

  if (!isPaper) {
    try {
      await submitSellOrder(trade);
    } catch (err) {
      console.error(`[trading] Failed to close position: ${err}`);
      trade.status = "CANCELLED";
    }
  } else {
    console.log(`[paper-trade] SELL ${position.size} USDC of "${position.outcome}" @ ${exitPrice} (${reason}, PNL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)})`);
  }

  // Record the trade
  recordTrade(trade);

  // Update bankroll
  const bankroll = getBankroll();
  if (bankroll) {
    updateBankroll(bankroll.currentCapital + pnl);
    console.log(`[trading] Bankroll updated: $${(bankroll.currentCapital + pnl).toFixed(2)}`);
  }

  // Remove the position tracking
  removePosition(position.market, position.outcome);
  removeRiskPosition(position.id);

  // Persist risk data
  flushRiskData();
}

/**
 * Submit a sell order to close a position.
 */
async function submitSellOrder(trade: TradeRecord): Promise<void> {
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
    { headers, timeout: 10_000 }
  );
}

/**
 * Get the current bankroll state (exported for admin stats).
 */
export function getCurrentBankroll() {
  return getBankroll();
}

/**
 * Get all current risk positions (exported for admin stats).
 */
export function getCurrentRiskPositions(): RiskPosition[] {
  return getRiskPositions();
}
