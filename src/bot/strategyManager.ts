import { fetchMarkets, type Market } from "./trading";
import { 
  startArbitrageScanner, 
  stopArbitrageScanner, 
  scanForArbitrage,
  getOpportunities,
  type ArbitrageOpportunity 
} from "./arbitrage";
import {
  startWhaleMonitoring,
  stopWhaleMonitoring,
  getWhaleStats,
  getCopyConfig,
  type WhaleTransaction,
} from "./whaleCopy";
import {
  startSentimentAnalysis,
  stopSentimentAnalysis,
  getSentimentStats,
  getSentimentConfig,
  analyzeAllMarkets,
  type SentimentSignal,
} from "./aiSentiment";
import { recordTrade, type TradeRecord } from "../admin/stats";
import { alertStartup, alertShutdown, initTelegram } from "../utils/telegram";

// ── Types ──────────────────────────────────────────────────────────────────

export type StrategyType = "edge" | "arbitrage" | "whale-copy" | "ai-sentiment";

export interface StrategyConfig {
  name: StrategyType;
  enabled: boolean;
  weight: number; // Priority weight for position sizing
  maxPositionSize: number;
  description: string;
}

export interface StrategyManagerConfig {
  strategies: StrategyConfig[];
  globalMaxPositionSize: number;
  maxConcurrentStrategies: number;
  riskLevel: "low" | "medium" | "high";
}

export interface StrategyPerformance {
  strategy: StrategyType;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  winRate: number;
  avgReturn: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: StrategyManagerConfig = {
  strategies: [
    {
      name: "edge",
      enabled: true,
      weight: 1.0,
      maxPositionSize: 100,
      description: "Simple probability edge trading",
    },
    {
      name: "arbitrage",
      enabled: true,
      weight: 1.5, // Higher priority for risk-free arb
      maxPositionSize: 200,
      description: "Cross-market and binary arbitrage",
    },
    {
      name: "whale-copy",
      enabled: false, // Disabled by default
      weight: 0.8,
      maxPositionSize: 50,
      description: "Copy profitable whale wallets",
    },
    {
      name: "ai-sentiment",
      enabled: false, // Disabled by default
      weight: 0.6,
      maxPositionSize: 50,
      description: "AI-powered news sentiment analysis",
    },
  ],
  globalMaxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE_USDC ?? "100"),
  maxConcurrentStrategies: 3,
  riskLevel: (process.env.RISK_LEVEL as "low" | "medium" | "high") ?? "medium",
};

// ── State ──────────────────────────────────────────────────────────────────

let isRunning = false;
let config = { ...DEFAULT_CONFIG };
let performanceData: Map<StrategyType, StrategyPerformance> = new Map();

// ── Configuration ──────────────────────────────────────────────────────────

/**
 * Get the current strategy manager configuration.
 */
export function getManagerConfig(): StrategyManagerConfig {
  return { ...config };
}

/**
 * Update the strategy manager configuration.
 */
export function updateManagerConfig(newConfig: Partial<StrategyManagerConfig>): void {
  config = { ...config, ...newConfig };
  console.log("[strategyManager] Configuration updated");
}

/**
 * Enable or disable a specific strategy.
 */
export function setStrategyEnabled(name: StrategyType, enabled: boolean): void {
  const strategy = config.strategies.find((s) => s.name === name);
  if (strategy) {
    strategy.enabled = enabled;
    console.log(`[strategyManager] Strategy '${name}' ${enabled ? "enabled" : "disabled"}`);
  }
}

/**
 * Get all enabled strategies.
 */
export function getEnabledStrategies(): StrategyConfig[] {
  return config.strategies.filter((s) => s.enabled);
}

// ── Performance Tracking ───────────────────────────────────────────────────

/**
 * Initialize performance tracking for a strategy.
 */
function initPerformance(strategy: StrategyType): void {
  if (!performanceData.has(strategy)) {
    performanceData.set(strategy, {
      strategy,
      trades: 0,
      wins: 0,
      losses: 0,
      pnl: 0,
      winRate: 0,
      avgReturn: 0,
    });
  }
}

/**
 * Record a trade result for a strategy.
 */
export function recordStrategyTrade(
  strategy: StrategyType,
  pnl: number,
  won: boolean
): void {
  initPerformance(strategy);
  const perf = performanceData.get(strategy)!;

  perf.trades++;
  perf.pnl += pnl;
  if (won) {
    perf.wins++;
  } else {
    perf.losses++;
  }
  perf.winRate = perf.trades > 0 ? perf.wins / perf.trades : 0;
  perf.avgReturn = perf.trades > 0 ? perf.pnl / perf.trades : 0;
}

/**
 * Get performance data for all strategies.
 */
export function getStrategyPerformance(): StrategyPerformance[] {
  return Array.from(performanceData.values());
}

/**
 * Get the best performing strategy.
 */
export function getBestStrategy(): StrategyType {
  let best: StrategyType = "edge";
  let bestReturn = -Infinity;

  for (const perf of performanceData.values()) {
    if (perf.avgReturn > bestReturn) {
      bestReturn = perf.avgReturn;
      best = perf.strategy;
    }
  }

  return best;
}

// ── Position Sizing ────────────────────────────────────────────────────────

/**
 * Calculate optimal position size based on strategy weight and risk level.
 * 
 * Uses a Kelly Criterion-inspired approach:
 * - Higher weight strategies get larger allocations
 * - Risk level scales the base size
 * - Win rate adjusts position dynamically
 */
export function calculatePositionSize(
  strategy: StrategyType,
  baseSize: number,
  confidence = 0.5
): number {
  const strategyConfig = config.strategies.find((s) => s.name === strategy);
  if (!strategyConfig) return 0;

  // Risk multipliers
  const riskMultipliers: Record<string, number> = {
    low: 0.5,
    medium: 1.0,
    high: 1.5,
  };

  const riskMultiplier = riskMultipliers[config.riskLevel];
  const weightMultiplier = strategyConfig.weight;

  // Get strategy performance
  const perf = performanceData.get(strategy);
  const performanceMultiplier = perf && perf.winRate > 0.5 
    ? 1 + (perf.winRate - 0.5) 
    : 1;

  // Calculate size
  let size = baseSize * weightMultiplier * riskMultiplier * performanceMultiplier * confidence;

  // Apply caps
  size = Math.min(size, strategyConfig.maxPositionSize);
  size = Math.min(size, config.globalMaxPositionSize);

  // Round to 2 decimal places
  return Math.round(size * 100) / 100;
}

// ── Strategy Execution ─────────────────────────────────────────────────────

/**
 * Execute trades from arbitrage opportunities.
 */
async function executeArbitrageStrategy(markets: Market[]): Promise<void> {
  const strategyConfig = config.strategies.find((s) => s.name === "arbitrage");
  if (!strategyConfig?.enabled) return;

  const opportunities = await scanForArbitrage(markets);
  
  for (const opp of opportunities) {
    if (opp.risk !== "low") continue; // Only execute low-risk arb

    const size = calculatePositionSize("arbitrage", opp.expectedProfit * 10, 0.8);
    
    console.log(
      `[strategyManager] Arbitrage opportunity: ${opp.type} | ` +
      `Spread=${(opp.spread * 100).toFixed(2)}% | Size=$${size.toFixed(2)}`
    );

    // Record as paper trade for now
    const trade: TradeRecord = {
      id: `arb-${Date.now()}`,
      market: opp.markets[0],
      side: "BUY",
      outcome: "ARBITRAGE",
      price: 1 - opp.spread,
      size,
      timestamp: Date.now(),
      paper: process.env.PAPER_TRADE === "true",
      status: "FILLED",
      pnl: opp.expectedProfit,
    };

    recordTrade(trade);
    recordStrategyTrade("arbitrage", opp.expectedProfit, true);
  }
}

/**
 * Execute trades from sentiment signals.
 */
async function executeSentimentStrategy(markets: Market[]): Promise<void> {
  const strategyConfig = config.strategies.find((s) => s.name === "ai-sentiment");
  if (!strategyConfig?.enabled) return;

  const sentimentConfig = getSentimentConfig();
  if (!sentimentConfig.enabled) return;

  const signals = await analyzeAllMarkets(markets);
  
  for (const signal of signals) {
    if (signal.sentiment === "neutral") continue;
    if (signal.confidence < sentimentConfig.minConfidence) continue;

    const market = markets.find((m) => m.conditionId === signal.market);
    if (!market) continue;

    const baseSize = sentimentConfig.maxPositionSize;
    const size = calculatePositionSize("ai-sentiment", baseSize, signal.confidence);
    
    const outcomeIndex = signal.sentiment === "bullish" ? 0 : 1;
    const outcome = market.outcomes[outcomeIndex] ?? "YES";
    const price = market.prices[outcomeIndex] ?? 0.5;

    console.log(
      `[strategyManager] Sentiment signal: ${signal.sentiment.toUpperCase()} | ` +
      `Conf=${(signal.confidence * 100).toFixed(0)}% | Size=$${size.toFixed(2)}`
    );

    // Record trade
    const trade: TradeRecord = {
      id: `sent-${Date.now()}`,
      market: signal.market,
      side: "BUY",
      outcome,
      price,
      size,
      timestamp: Date.now(),
      paper: process.env.PAPER_TRADE === "true",
      status: "FILLED",
    };

    recordTrade(trade);
    // PnL calculated later when position closes
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

/**
 * Initialize all strategies.
 */
export function initStrategies(): void {
  // Initialize Telegram
  initTelegram();

  // Initialize performance tracking
  for (const strategy of config.strategies) {
    initPerformance(strategy.name);
  }

  console.log("[strategyManager] Strategies initialized");
  console.log(`[strategyManager] Enabled: ${getEnabledStrategies().map((s) => s.name).join(", ")}`);
  console.log(`[strategyManager] Risk level: ${config.riskLevel}`);
}

/**
 * Start all enabled strategies.
 */
export async function startStrategies(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  initStrategies();

  const enabledStrategies = getEnabledStrategies();
  console.log(`[strategyManager] Starting ${enabledStrategies.length} strategies...`);

  // Start arbitrage scanner
  const arbConfig = config.strategies.find((s) => s.name === "arbitrage");
  if (arbConfig?.enabled) {
    startArbitrageScanner(fetchMarkets, 15000);
  }

  // Start whale monitoring
  const whaleConfig = config.strategies.find((s) => s.name === "whale-copy");
  if (whaleConfig?.enabled && getCopyConfig().enabled) {
    startWhaleMonitoring(30000);
  }

  // Start sentiment analysis
  const sentConfig = config.strategies.find((s) => s.name === "ai-sentiment");
  if (sentConfig?.enabled && getSentimentConfig().enabled) {
    startSentimentAnalysis(fetchMarkets, 300000); // 5 min interval
  }

  // Send startup notification
  const mode = process.env.PAPER_TRADE === "true" ? "Paper Trading" : "Live Trading";
  await alertStartup(mode);

  console.log("[strategyManager] All strategies started");
}

/**
 * Stop all strategies.
 */
export async function stopStrategies(): Promise<void> {
  if (!isRunning) return;
  isRunning = false;

  console.log("[strategyManager] Stopping all strategies...");

  stopArbitrageScanner();
  stopWhaleMonitoring();
  stopSentimentAnalysis();

  // Send shutdown notification
  await alertShutdown("Manual shutdown");

  console.log("[strategyManager] All strategies stopped");
}

/**
 * Check if strategies are running.
 */
export function isStrategiesRunning(): boolean {
  return isRunning;
}

// ── Main Strategy Loop ─────────────────────────────────────────────────────

/**
 * Run a single strategy cycle on all markets.
 * This is called from the main trading loop.
 */
export async function runStrategyCycle(markets: Market[]): Promise<void> {
  if (!isRunning) return;

  const enabledStrategies = getEnabledStrategies();
  
  for (const strategy of enabledStrategies) {
    try {
      switch (strategy.name) {
        case "arbitrage":
          await executeArbitrageStrategy(markets);
          break;
        case "ai-sentiment":
          await executeSentimentStrategy(markets);
          break;
        // "edge" strategy is handled by original trading.ts
        // "whale-copy" runs independently via monitoring
      }
    } catch (err) {
      console.error(`[strategyManager] Error in ${strategy.name}:`, err);
    }
  }
}

// ── Statistics ─────────────────────────────────────────────────────────────

/**
 * Get comprehensive strategy statistics.
 */
export function getStrategyStats(): {
  totalStrategies: number;
  enabledStrategies: number;
  performance: StrategyPerformance[];
  bestStrategy: StrategyType;
  arbitrage: { opportunities: number };
  whale: ReturnType<typeof getWhaleStats>;
  sentiment: ReturnType<typeof getSentimentStats>;
  config: StrategyManagerConfig;
} {
  return {
    totalStrategies: config.strategies.length,
    enabledStrategies: getEnabledStrategies().length,
    performance: getStrategyPerformance(),
    bestStrategy: getBestStrategy(),
    arbitrage: {
      opportunities: getOpportunities().length,
    },
    whale: getWhaleStats(),
    sentiment: getSentimentStats(),
    config: getManagerConfig(),
  };
}

/**
 * Calculate annualized return based on current performance.
 * 
 * Example: With 1.5% daily return over 365 days:
 * Annualized = (1 + 0.015)^365 - 1 = ~1800%
 */
export function calculateAnnualizedReturn(): {
  dailyReturn: number;
  annualizedReturn: number;
  projectedAnnualPnl: number;
} {
  const performance = getStrategyPerformance();
  const totalPnl = performance.reduce((sum, p) => sum + p.pnl, 0);
  const totalTrades = performance.reduce((sum, p) => sum + p.trades, 0);

  // Assume average of 10 trades per day
  const tradesPerDay = 10;
  const avgPnlPerTrade = totalTrades > 0 ? totalPnl / totalTrades : 0;
  const dailyPnl = avgPnlPerTrade * tradesPerDay;

  // Base capital assumption
  const baseCapital = config.globalMaxPositionSize * 10;
  const dailyReturn = baseCapital > 0 ? dailyPnl / baseCapital : 0;

  // Compound annual return
  const annualizedReturn = Math.pow(1 + dailyReturn, 365) - 1;
  const projectedAnnualPnl = baseCapital * annualizedReturn;

  return {
    dailyReturn,
    annualizedReturn,
    projectedAnnualPnl,
  };
}
