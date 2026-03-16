import axios from "axios";
import { getWallet, getTokenBalance } from "../utils/wallet";
import { recordTrade, getAllTrades } from "../admin/stats";
import { getItem, setItem } from "../utils/jsonStore";
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
 * Optimized for 5-minute paper trading only - no real orders are sent.
 * Includes position tracking to prevent duplicate orders.
 */
export async function evaluateAndTrade(market: Market): Promise<void> {
  const minEdge = parseFloat(process.env.MIN_EDGE ?? "0.05");
  const maxSize = parseFloat(process.env.MAX_POSITION_SIZE_USDC ?? "100");
  // Always use paper mode - this bot only supports paper trading
  const isPaper = PAPER_MODE_ONLY;

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

    // Round to 2 decimal places (cents) for USDC sizing
    const CENTS = 100;
    const size = Math.min(maxSize, Math.round(edge * maxSize * CENTS) / CENTS);

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
      } catch (err) {
        console.error("[trading] submitOrder error:", err);
        trade.status = "CANCELLED";
      }
    } else {
      console.log(`[paper-trade] BUY ${size} USDC of "${outcome}" @ ${price}`);
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

// ── 5-Minute Optimization Constants ────────────────────────────────────────
// This bot only supports 5-minute trading intervals in paper mode.
const FIVE_MINUTE_INTERVAL_MS = 300000; // 5 minutes = 300,000ms
const PAPER_MODE_ONLY = true; // Paper mode is always enabled

/** Main trading loop — polls markets and evaluates trade signals.
 *  Optimized for 5-minute intervals in paper mode only.
 */
export async function runTradingLoop(): Promise<void> {
  // Always use 5-minute interval regardless of env setting
  const interval = FIVE_MINUTE_INTERVAL_MS;
  console.log(`[trading] Starting 5-minute paper trading loop (interval=${interval}ms)`);
  console.log('[trading] Paper mode: ENABLED (locked)');
  _isRunning = true;

  const tick = async () => {
    if (!_isRunning) return;
    
    try {
      const markets = await fetchMarkets();
      console.log(`[trading] Evaluating ${markets.length} markets…`);
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
