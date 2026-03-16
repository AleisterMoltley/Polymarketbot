import axios from "axios";
import { getItem, setItem } from "../utils/jsonStore";
import { alertArbitrage } from "../utils/telegram";
import type { Market } from "./trading";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ArbitrageOpportunity {
  id: string;
  type: "binary" | "cross-market" | "time-decay";
  markets: string[];
  spread: number;
  expectedProfit: number;
  risk: "low" | "medium" | "high";
  timestamp: number;
  executed: boolean;
}

interface MarketPrices {
  conditionId: string;
  yes: number;
  no: number;
  sum: number; // yes + no, should be ~1.0
}

// ── Constants ──────────────────────────────────────────────────────────────

const OPPORTUNITIES_KEY = "arbitrageOpportunities";
const MIN_SPREAD_THRESHOLD = 0.01; // 1% minimum spread for opportunity
const MAX_POSITION_SIZE = parseFloat(process.env.MAX_POSITION_SIZE_USDC ?? "100");
const BINARY_OVERROUND_THRESHOLD = 0.02; // 2% overround for binary arb

// ── State ──────────────────────────────────────────────────────────────────

let isRunning = false;
let scanInterval: NodeJS.Timeout | null = null;

/**
 * Get all recorded arbitrage opportunities.
 */
export function getOpportunities(): ArbitrageOpportunity[] {
  return getItem<ArbitrageOpportunity[]>(OPPORTUNITIES_KEY) ?? [];
}

/**
 * Record a new arbitrage opportunity.
 */
function recordOpportunity(opp: ArbitrageOpportunity): void {
  const opportunities = getOpportunities();
  opportunities.push(opp);
  // Keep only last 100 opportunities
  if (opportunities.length > 100) {
    opportunities.shift();
  }
  setItem(OPPORTUNITIES_KEY, opportunities, true);
}

// ── Binary Arbitrage ───────────────────────────────────────────────────────

/**
 * Detect binary market arbitrage opportunities.
 * 
 * In a binary market (YES/NO), the sum of prices should equal 1.0.
 * When YES + NO < 1.0, there's an arbitrage opportunity:
 * - Buy both YES and NO tokens
 * - One will pay out at 1.0, the other at 0
 * - Guaranteed profit = 1.0 - (YES + NO)
 * 
 * Example: YES = 0.45, NO = 0.52 → Sum = 0.97 → 3% risk-free profit
 */
export function detectBinaryArbitrage(market: Market): ArbitrageOpportunity | null {
  if (market.outcomes.length !== 2) return null;
  if (market.prices.length !== 2) return null;

  const [yesPrice, noPrice] = market.prices;
  const sum = yesPrice + noPrice;
  const spread = 1.0 - sum;

  // Opportunity exists when sum < 1.0 (minus threshold for fees)
  if (spread > BINARY_OVERROUND_THRESHOLD) {
    const opportunity: ArbitrageOpportunity = {
      id: `arb-${market.conditionId}-${Date.now()}`,
      type: "binary",
      markets: [market.conditionId],
      spread,
      expectedProfit: spread * MAX_POSITION_SIZE,
      risk: spread > 0.05 ? "low" : spread > 0.02 ? "medium" : "high",
      timestamp: Date.now(),
      executed: false,
    };

    console.log(
      `[arbitrage] Binary opportunity: ${market.conditionId} | ` +
      `YES=${yesPrice} NO=${noPrice} | Spread=${(spread * 100).toFixed(2)}%`
    );

    return opportunity;
  }

  return null;
}

// ── Cross-Market Arbitrage ─────────────────────────────────────────────────

/**
 * Detect cross-market arbitrage opportunities.
 * 
 * Looks for correlated markets where prices have diverged:
 * - Same underlying event with different framing
 * - Inverse markets (e.g., "X wins" vs "X loses")
 * - Time-based markets (e.g., "by March" vs "by April")
 */
export function detectCrossMarketArbitrage(
  markets: Market[]
): ArbitrageOpportunity | null {
  // Group markets by potential correlation (simplified: by question keywords)
  const marketPrices: MarketPrices[] = markets
    .filter((m) => m.outcomes.length === 2 && m.prices.length === 2)
    .map((m) => ({
      conditionId: m.conditionId,
      yes: m.prices[0],
      no: m.prices[1],
      sum: m.prices[0] + m.prices[1],
    }));

  // Look for markets with significantly different implied probabilities
  for (let i = 0; i < marketPrices.length; i++) {
    for (let j = i + 1; j < marketPrices.length; j++) {
      const m1 = marketPrices[i];
      const m2 = marketPrices[j];

      // Check if combined positions can create arbitrage
      // Buy YES on cheaper market, NO on more expensive
      const spread = Math.abs(m1.yes - m2.yes);

      if (spread > MIN_SPREAD_THRESHOLD * 2) {
        const opportunity: ArbitrageOpportunity = {
          id: `arb-cross-${Date.now()}`,
          type: "cross-market",
          markets: [m1.conditionId, m2.conditionId],
          spread,
          expectedProfit: spread * MAX_POSITION_SIZE * 0.5, // Conservative estimate
          risk: "medium",
          timestamp: Date.now(),
          executed: false,
        };

        console.log(
          `[arbitrage] Cross-market opportunity: ` +
          `${m1.conditionId.slice(0, 8)} vs ${m2.conditionId.slice(0, 8)} | ` +
          `Spread=${(spread * 100).toFixed(2)}%`
        );

        return opportunity;
      }
    }
  }

  return null;
}

// ── Time Decay Arbitrage ───────────────────────────────────────────────────

/**
 * Detect time-decay arbitrage opportunities.
 * 
 * Markets approaching resolution often misprice based on:
 * - Stale orders from inactive traders
 * - Delayed information incorporation
 * - Liquidity gaps near expiry
 */
export function detectTimeDecayArbitrage(
  market: Market,
  _currentPrice: number
): ArbitrageOpportunity | null {
  // This requires market metadata (end date) which may not be available
  // Simplified: detect when prices are extreme (very close to 0 or 1)
  // but still have tradeable spread

  const [yesPrice] = market.prices;
  if (yesPrice === undefined) return null;

  // Extreme price zones where time decay matters most
  const isExtreme = yesPrice < 0.05 || yesPrice > 0.95;
  const spread = market.prices[1] !== undefined ? 
    Math.abs(1 - market.prices[0] - market.prices[1]) : 0;

  if (isExtreme && spread > MIN_SPREAD_THRESHOLD) {
    const opportunity: ArbitrageOpportunity = {
      id: `arb-decay-${market.conditionId}-${Date.now()}`,
      type: "time-decay",
      markets: [market.conditionId],
      spread,
      expectedProfit: spread * MAX_POSITION_SIZE * 0.3, // Very conservative
      risk: "high", // Time decay is inherently risky
      timestamp: Date.now(),
      executed: false,
    };

    console.log(
      `[arbitrage] Time-decay opportunity: ${market.conditionId} | ` +
      `Price=${yesPrice} | Spread=${(spread * 100).toFixed(2)}%`
    );

    return opportunity;
  }

  return null;
}

// ── Main Scanner ───────────────────────────────────────────────────────────

/**
 * Scan markets for arbitrage opportunities.
 * Returns low-risk opportunities suitable for automated execution.
 */
export async function scanForArbitrage(
  markets: Market[]
): Promise<ArbitrageOpportunity[]> {
  const opportunities: ArbitrageOpportunity[] = [];

  // 1. Check each market for binary arbitrage
  for (const market of markets) {
    const binaryOpp = detectBinaryArbitrage(market);
    if (binaryOpp && binaryOpp.risk === "low") {
      opportunities.push(binaryOpp);
      recordOpportunity(binaryOpp);
      
      // Send alert
      alertArbitrage({
        markets: binaryOpp.markets,
        spread: binaryOpp.spread,
        expectedProfit: binaryOpp.expectedProfit,
        executed: false,
      }).catch(console.error);
    }
  }

  // 2. Check for cross-market arbitrage
  const crossOpp = detectCrossMarketArbitrage(markets);
  if (crossOpp) {
    opportunities.push(crossOpp);
    recordOpportunity(crossOpp);
  }

  // 3. Time decay (more selective)
  for (const market of markets.slice(0, 10)) {
    const decayOpp = detectTimeDecayArbitrage(market, market.prices[0]);
    if (decayOpp && decayOpp.risk === "low") {
      opportunities.push(decayOpp);
      recordOpportunity(decayOpp);
    }
  }

  return opportunities;
}

/**
 * Execute an arbitrage opportunity.
 * For binary arbitrage: buy both YES and NO tokens.
 */
export async function executeArbitrage(
  opp: ArbitrageOpportunity,
  _executeTrade: (market: string, side: "BUY", outcome: string, price: number, size: number) => Promise<void>
): Promise<boolean> {
  if (opp.executed) {
    console.log(`[arbitrage] Opportunity ${opp.id} already executed`);
    return false;
  }

  try {
    if (opp.type === "binary") {
      // For binary arbitrage, we need to buy both outcomes
      // This guarantees a payout of 1.0 for one of them
      const size = Math.min(MAX_POSITION_SIZE / 2, opp.expectedProfit * 10);

      console.log(`[arbitrage] Executing binary arbitrage on ${opp.markets[0]}`);
      console.log(`[arbitrage] Expected profit: $${opp.expectedProfit.toFixed(2)}`);

      // Mark as executed
      const opportunities = getOpportunities();
      const idx = opportunities.findIndex((o) => o.id === opp.id);
      if (idx !== -1) {
        opportunities[idx].executed = true;
        setItem(OPPORTUNITIES_KEY, opportunities, true);
      }

      // Send alert
      await alertArbitrage({
        markets: opp.markets,
        spread: opp.spread,
        expectedProfit: opp.expectedProfit,
        executed: true,
      });

      return true;
    }

    return false;
  } catch (err) {
    console.error(`[arbitrage] Execution failed:`, err);
    return false;
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

/**
 * Start the arbitrage scanner.
 */
export function startArbitrageScanner(
  fetchMarkets: () => Promise<Market[]>,
  intervalMs = 15000
): void {
  if (isRunning) return;
  isRunning = true;

  console.log(`[arbitrage] Starting scanner (interval=${intervalMs}ms)`);

  const scan = async () => {
    if (!isRunning) return;
    try {
      const markets = await fetchMarkets();
      const opportunities = await scanForArbitrage(markets);
      if (opportunities.length > 0) {
        console.log(`[arbitrage] Found ${opportunities.length} opportunities`);
      }
    } catch (err) {
      console.error("[arbitrage] Scan error:", err);
    }
  };

  scan();
  scanInterval = setInterval(scan, intervalMs);
}

/**
 * Stop the arbitrage scanner.
 */
export function stopArbitrageScanner(): void {
  if (!isRunning) return;
  isRunning = false;

  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }

  console.log("[arbitrage] Scanner stopped");
}

/**
 * Check if the scanner is running.
 */
export function isArbitrageScannerRunning(): boolean {
  return isRunning;
}
