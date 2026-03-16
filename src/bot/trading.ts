import axios from "axios";
import { config } from "../config/env";
import { getWallet, getTokenBalance } from "../utils/wallet";
import { recordTrade, getAllTrades } from "../admin/stats";
import { getItem, setItem } from "../utils/jsonStore";
import { isPaperMode } from "../admin/tradingMode";
import { isTradingAllowed, getTradingHoursStatus } from "../utils/tradingHours";
import { 
  applyFilters, 
  recordFilterResult, 
  getFilterConfig,
  type ExtendedMarket 
} from "../utils/marketFilters";
import type { TradeRecord } from "../admin/stats";

// ── Edge Detection Constants ────────────────────────────────────────────────
// For binary markets, the sum of Yes and No prices should be approximately 1.
// These constants define the valid range for price sum validation.
const MIN_VALID_PRICE_SUM = 0.9;  // Minimum valid sum (allows for spread/slippage)
const MAX_VALID_PRICE_SUM = 1.2;  // Maximum valid sum (allows for market maker vig)

// Liquidity Score Constants for edge weighting
const MIN_LIQUIDITY_SCORE = 0.1;  // Minimum liquidity score to avoid extreme downscaling
const MAX_LIQUIDITY_SCORE = 2.0;  // Maximum liquidity score cap

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

// Re-export ExtendedMarket for external use
export type { ExtendedMarket } from "../utils/marketFilters";

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

/** Raw market shape returned by the Polymarket CLOB API */
interface RawToken {
  outcome: string;
  price: number;
}

interface RawMarket extends Omit<ExtendedMarket, "outcomes" | "prices"> {
  tokens?: RawToken[];
  outcomes?: string[];
  prices?: number[];
}

/**
 * Transform a raw API market into the ExtendedMarket shape expected by the bot.
 * Extracts `outcomes` and `prices` from the `tokens` array when present.
 * Returns null when the market cannot be transformed into a valid structure.
 */
function transformMarket(raw: RawMarket): ExtendedMarket | null {
  // Already in the expected format — use as-is
  if (Array.isArray(raw.outcomes) && raw.outcomes.length > 0 &&
      Array.isArray(raw.prices) && raw.prices.length > 0) {
    return raw as ExtendedMarket;
  }

  // Transform from tokens array (standard Polymarket API response)
  if (Array.isArray(raw.tokens) && raw.tokens.length > 0) {
    const { tokens, ...rest } = raw;
    const outcomes = tokens.map(t => t.outcome);
    const prices   = tokens.map(t => t.price);
    return { ...rest, outcomes, prices } as ExtendedMarket;
  }

  return null;
}

/**
 * Calculate liquidity score for edge weighting.
 * Higher liquidity markets get higher scores, making their edge more reliable.
 * 
 * Formula: liquidityScore = sqrt(liquidity / referenceUsdc)
 * - Uses square root to dampen the effect (avoid extreme values)
 * - Clamped between MIN_LIQUIDITY_SCORE and MAX_LIQUIDITY_SCORE
 * 
 * Examples (with referenceUsdc = 10000):
 * - $100 liquidity → score = 0.1 (clamped to minimum)
 * - $2,500 liquidity → score = 0.5
 * - $10,000 liquidity → score = 1.0 (reference point)
 * - $40,000 liquidity → score = 2.0 (capped at maximum)
 */
function calculateLiquidityScore(liquidity: number | undefined): number {
  const referenceUsdc = config.trading.liquidityReferenceUsdc;
  
  // If no liquidity data, return minimum score (conservative)
  if (liquidity === undefined || liquidity <= 0) {
    return MIN_LIQUIDITY_SCORE;
  }
  
  // Calculate score using square root to dampen extreme values
  const rawScore = Math.sqrt(liquidity / referenceUsdc);
  
  // Clamp to valid range
  return Math.min(MAX_LIQUIDITY_SCORE, Math.max(MIN_LIQUIDITY_SCORE, rawScore));
}

/** Fetch a list of active markets from the Polymarket CLOB API with optional filtering. */
export async function fetchMarkets(): Promise<ExtendedMarket[]> {
  const baseUrl = config.polymarket.clobApiUrl;
  const filterConfig = getFilterConfig();
  
  try {
    // Build query parameters
    const params: Record<string, unknown> = { 
      active: true, 
      closed: false,
    };
    
    // Add pagination parameter (pageSize is always positive due to validation)
    params.limit = filterConfig.pageSize;
    
    const { data } = await axios.get<{ data: RawMarket[] }>(`${baseUrl}/markets`, {
      params,
      timeout: 10_000,
    });
    
    const rawMarkets = data.data ?? [];

    // Transform raw API markets into the shape the bot expects
    const markets: ExtendedMarket[] = [];
    for (const raw of rawMarkets) {
      const market = transformMarket(raw);
      if (market) {
        markets.push(market);
      }
    }
    
    // Apply local filters
    const filterResult = applyFilters(markets, filterConfig);
    recordFilterResult(filterResult);
    
    if (filterResult.totalBefore !== filterResult.totalAfter) {
      console.log(`[trading] Filtered markets: ${filterResult.totalBefore} → ${filterResult.totalAfter} (${filterResult.filtersApplied.join(", ")})`);
    }
    
    return filterResult.markets;
  } catch (err) {
    console.error("[trading] fetchMarkets error:", err);
    return [];
  }
}

/**
 * Evaluate a market and return a trade signal if edge exceeds MIN_EDGE.
 * Supports both paper and live trading modes, controlled via dashboard.
 * Includes position tracking to prevent duplicate orders.
 * Respects trading hours restriction when enabled.
 * 
 * Edge Detection Logic:
 * For binary markets (Yes/No), we check if there's actual market inefficiency:
 * - If Yes + No > 1 + MIN_EDGE, there may be an edge on the underpriced outcome
 * - An outcome is only considered to have edge if buying it at current price
 *   gives better expected value than the market implies
 * - We validate BOTH outcomes to ensure we're not detecting false edges
 *   (e.g., Yes=0.95, No=0.05 is a fairly priced market, not an edge)
 * 
 * Liquidity-Weighted Edge (when enabled):
 * - Raw edge is multiplied by a liquidity score
 * - Higher liquidity markets produce higher weighted edges
 * - This favors trading in more liquid markets where edge is more reliable
 */
export async function evaluateAndTrade(market: ExtendedMarket): Promise<void> {
  // Check trading hours restriction
  if (!isTradingAllowed()) {
    // Trading is paused due to hours restriction - skip silently
    return;
  }

  const minEdge = config.trading.minEdge;
  const maxSize = config.trading.maxPositionSizeUsdc;
  const useLiquidityWeighting = config.trading.enableLiquidityWeightedEdge;
  // Use dynamic trading mode from dashboard
  const isPaper = isPaperMode();

  // Safety check: skip markets with missing or empty outcomes/prices
  if (!Array.isArray(market.outcomes) || market.outcomes.length === 0 ||
      !Array.isArray(market.prices)   || market.prices.length === 0) {
    return;
  }

  // For binary markets (Yes/No), validate both outcomes together
  // Sum of prices should be approximately 1 (with some spread for market maker)
  const priceSum = market.prices.reduce((sum, p) => sum + (p ?? 0), 0);
  
  // Skip if price sum is invalid (should be roughly 1 for binary markets)
  if (market.outcomes.length === 2 && (priceSum < MIN_VALID_PRICE_SUM || priceSum > MAX_VALID_PRICE_SUM)) {
    console.log(`[trading] Skipping market ${market.conditionId}: invalid price sum ${priceSum.toFixed(3)}`);
    return;
  }

  // Calculate liquidity score for edge weighting (if enabled)
  const liquidityScore = useLiquidityWeighting 
    ? calculateLiquidityScore(market.liquidity) 
    : 1.0;

  for (let i = 0; i < market.outcomes.length; i++) {
    const price = market.prices[i];
    if (price === undefined || price <= 0 || price >= 1) continue;

    const outcome = market.outcomes[i];

    // Check for existing position to prevent duplicates
    if (hasExistingPosition(market.conditionId, outcome)) {
      console.log(`[trading] Skipping duplicate position: ${market.conditionId} / ${outcome}`);
      continue;
    }

    // For binary markets, calculate edge based on market inefficiency
    // Edge exists when: complementary price (1 - price) significantly differs from actual other outcome price
    // This ensures we check BOTH outcomes together
    let rawEdge = 0;
    
    if (market.outcomes.length === 2) {
      // Get the complementary outcome's price
      const complementaryPrice = market.prices[1 - i] ?? 0;
      
      // Fair price for this outcome based on complementary outcome: 1 - complementaryPrice
      // Actual price we'd pay: price
      // Edge = fair_price - actual_price - minEdge
      // This means we buy when our price is cheaper than what the other side implies
      const impliedFairPrice = 1 - complementaryPrice;
      
      // Only count as edge if our price is LOWER than implied fair price by at least MIN_EDGE
      // This prevents false positives like Yes=0.95, No=0.05 where:
      // - For Yes: implied fair = 1 - 0.05 = 0.95, edge = 0.95 - 0.95 - 0.05 = -0.05 (no edge)
      // - For No: implied fair = 1 - 0.95 = 0.05, edge = 0.05 - 0.05 - 0.05 = -0.05 (no edge)
      rawEdge = impliedFairPrice - price - minEdge;
    } else {
      // For multi-outcome markets (3+ outcomes), use simple edge model.
      // The binary market logic doesn't apply because there's no single complementary price.
      // A more sophisticated model for multi-outcome markets would require comparing against
      // the sum of all complementary outcomes, but this is left for future enhancement.
      rawEdge = 1 - price - minEdge;
    }
    
    if (rawEdge <= 0) continue;

    // Apply liquidity weighting: weighted_edge = raw_edge * liquidity_score
    // This makes edge from high-liquidity markets more valuable
    const edge = rawEdge * liquidityScore;
    
    // After weighting, ensure edge is still positive (low liquidity could reduce it significantly)
    if (edge <= 0) continue;
    
    if (useLiquidityWeighting) {
      console.log(`[trading] Edge calculation: raw=${rawEdge.toFixed(4)}, liquidityScore=${liquidityScore.toFixed(3)}, weighted=${edge.toFixed(4)}`);
    }

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
  const baseUrl = config.polymarket.clobApiUrl;
  const wallet = getWallet();
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const headers = {
    "POLY_ADDRESS": wallet.address,
    "POLY_SIGNATURE": await wallet.signMessage(timestamp),
    "POLY_TIMESTAMP": timestamp,
    "POLY_API_KEY": config.polymarket.clobApiKey,
    "POLY_API_SECRET": config.polymarket.clobApiSecret,
    "POLY_PASSPHRASE": config.polymarket.clobApiPassphrase,
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
let _lastTradingPausedLog = 0; // Track last time we logged trading paused message

// ── 5-Minute Optimization Constants ────────────────────────────────────────
// Trading interval constant for 5-minute trading.
const FIVE_MINUTE_INTERVAL_MS = 300000; // 5 minutes = 300,000ms
const TRADING_PAUSED_LOG_INTERVAL_MS = 300000; // Log "trading paused" at most every 5 minutes

/** Main trading loop — polls markets and evaluates trade signals.
 *  Supports both paper and live trading modes, controlled via dashboard.
 *  Respects trading hours restriction when enabled.
 */
export async function runTradingLoop(): Promise<void> {
  // Always use 5-minute interval regardless of env setting
  const interval = FIVE_MINUTE_INTERVAL_MS;
  console.log(`[trading] Starting 5-minute trading loop (interval=${interval}ms)`);
  console.log(`[trading] Trading mode: ${isPaperMode() ? 'PAPER' : 'LIVE'}`);
  console.log(`[trading] ${getTradingHoursStatus()}`);
  _isRunning = true;

  const tick = async () => {
    if (!_isRunning) return;
    
    // Check trading hours at each tick
    if (!isTradingAllowed()) {
      // Only log periodically to avoid spamming logs
      const now = Date.now();
      if (now - _lastTradingPausedLog >= TRADING_PAUSED_LOG_INTERVAL_MS) {
        console.log(`[trading] ⏸️ Trading paused - outside trading hours`);
        _lastTradingPausedLog = now;
      }
      return;
    }
    
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
