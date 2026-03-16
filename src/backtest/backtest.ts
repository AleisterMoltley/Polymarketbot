import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import {
  calculatePositionSize,
  calculateStopLossPrice,
  calculateTakeProfitPrice,
  calculatePnlStats,
  initializeBankroll,
  updateBankroll,
  getBankroll,
  DEFAULT_RISK_PER_TRADE,
  DEFAULT_STOP_LOSS_PERCENT,
  DEFAULT_TAKE_PROFIT_PERCENT,
  type PnlStats,
  type TradeResult,
  type BankrollState,
} from "../utils/risk";

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Historical trade record for backtesting.
 */
export interface HistoricalTrade {
  id: string;
  market: string;
  side: "BUY" | "SELL";
  outcome: string;
  price: number;
  size: number;
  timestamp: number;
  paper: boolean;
  status: "OPEN" | "FILLED" | "CANCELLED";
  pnl?: number;
}

/**
 * Historical price data point from Polymarket.
 */
export interface PriceDataPoint {
  timestamp: number;
  price: number;
  volume?: number;
}

/**
 * Market data for backtesting.
 */
export interface MarketHistoricalData {
  conditionId: string;
  question?: string;
  outcomes: string[];
  priceHistory: Record<string, PriceDataPoint[]>;
}

/**
 * Backtest configuration options.
 */
export interface BacktestConfig {
  initialCapital: number;
  riskPerTrade: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  minEdge: number;
  maxPositionSize: number;
  slippage: number;
}

/**
 * Single simulated trade result.
 */
export interface SimulatedTrade {
  id: string;
  market: string;
  outcome: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  size: number;
  entryTimestamp: number;
  exitTimestamp: number;
  pnl: number;
  exitReason: "STOP_LOSS" | "TAKE_PROFIT" | "MARKET_CLOSE" | "SIGNAL";
}

/**
 * Backtest result summary.
 */
export interface BacktestResult {
  config: BacktestConfig;
  trades: SimulatedTrade[];
  stats: PnlStats;
  startCapital: number;
  endCapital: number;
  returnPercent: number;
  tradingDays: number;
  startDate: string;
  endDate: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const POLYMARKET_API_URL = process.env.CLOB_API_URL ?? "https://clob.polymarket.com";

const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: 1000,
  riskPerTrade: DEFAULT_RISK_PER_TRADE,
  stopLossPercent: DEFAULT_STOP_LOSS_PERCENT,
  takeProfitPercent: DEFAULT_TAKE_PROFIT_PERCENT,
  minEdge: 0.05,
  maxPositionSize: 100,
  slippage: 0.005, // 0.5% slippage
};

// ── Historical Data Loading ────────────────────────────────────────────────

/**
 * Load historical trade data from a local JSON file.
 */
export function loadHistoricalTradesFromFile(filePath: string): HistoricalTrade[] {
  try {
    const absolutePath = path.isAbsolute(filePath) 
      ? filePath 
      : path.join(process.cwd(), filePath);
    
    const raw = fs.readFileSync(absolutePath, "utf-8");
    return JSON.parse(raw) as HistoricalTrade[];
  } catch (err) {
    console.error(`[backtest] Failed to load historical trades from ${filePath}:`, err);
    return [];
  }
}

/**
 * Fetch historical price data from Polymarket API.
 * Note: This is a simplified implementation - actual Polymarket API endpoints may differ.
 */
export async function fetchHistoricalPrices(
  conditionId: string,
  startTime?: number,
  endTime?: number
): Promise<PriceDataPoint[]> {
  try {
    const params: Record<string, string | number> = {
      market: conditionId,
    };
    
    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;

    const { data } = await axios.get<{ prices: PriceDataPoint[] }>(
      `${POLYMARKET_API_URL}/prices/history`,
      { params, timeout: 10_000 }
    );

    return data.prices ?? [];
  } catch (err) {
    console.error(`[backtest] Failed to fetch historical prices for ${conditionId}:`, err);
    return [];
  }
}

/**
 * Fetch market data from Polymarket API.
 */
export async function fetchMarketData(conditionId: string): Promise<MarketHistoricalData | null> {
  try {
    const { data } = await axios.get(`${POLYMARKET_API_URL}/markets/${conditionId}`, {
      timeout: 10_000,
    });

    return {
      conditionId,
      question: data.question,
      outcomes: data.outcomes ?? ["Yes", "No"],
      priceHistory: {},
    };
  } catch (err) {
    console.error(`[backtest] Failed to fetch market data for ${conditionId}:`, err);
    return null;
  }
}

// ── Price Simulation ───────────────────────────────────────────────────────

/**
 * Generate simulated price movements for backtesting.
 * Uses historical trades to create a price timeline.
 */
export function generatePriceTimeline(
  trades: HistoricalTrade[],
  intervalMs: number = 3600000 // 1 hour default
): Map<string, Map<string, PriceDataPoint[]>> {
  const timeline = new Map<string, Map<string, PriceDataPoint[]>>();

  // Sort trades by timestamp
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  for (const trade of sortedTrades) {
    const marketKey = trade.market;
    const outcomeKey = trade.outcome;

    if (!timeline.has(marketKey)) {
      timeline.set(marketKey, new Map());
    }

    const marketTimeline = timeline.get(marketKey)!;
    if (!marketTimeline.has(outcomeKey)) {
      marketTimeline.set(outcomeKey, []);
    }

    const outcomeTimeline = marketTimeline.get(outcomeKey)!;
    outcomeTimeline.push({
      timestamp: trade.timestamp,
      price: trade.price,
      volume: trade.size,
    });
  }

  return timeline;
}

// ── Backtesting Engine ─────────────────────────────────────────────────────

/**
 * Simulate a single trade with risk management.
 */
function simulateTrade(
  entry: HistoricalTrade,
  futurePrices: PriceDataPoint[],
  config: BacktestConfig,
  currentCapital: number
): SimulatedTrade | null {
  // Calculate position size based on risk management
  const stopLossPrice = calculateStopLossPrice(
    entry.price,
    entry.side,
    config.stopLossPercent
  );
  
  const takeProfitPrice = calculateTakeProfitPrice(
    entry.price,
    entry.side,
    config.takeProfitPercent
  );

  // Calculate position size using 2% risk rule
  let positionSize = calculatePositionSize(
    currentCapital,
    entry.price,
    stopLossPrice,
    config.riskPerTrade
  );

  // Cap at max position size
  positionSize = Math.min(positionSize, config.maxPositionSize);

  // Apply slippage to entry
  const slippageMultiplier = 1 + (entry.side === "BUY" ? config.slippage : -config.slippage);
  const actualEntryPrice = entry.price * slippageMultiplier;

  // Find exit point
  let exitPrice = actualEntryPrice;
  let exitTimestamp = entry.timestamp;
  let exitReason: SimulatedTrade["exitReason"] = "MARKET_CLOSE";

  for (const pricePoint of futurePrices) {
    const currentPrice = pricePoint.price;

    // Check stop-loss
    if (entry.side === "BUY" && currentPrice <= stopLossPrice) {
      exitPrice = stopLossPrice * (1 - config.slippage); // Slippage on exit
      exitTimestamp = pricePoint.timestamp;
      exitReason = "STOP_LOSS";
      break;
    } else if (entry.side === "SELL" && currentPrice >= stopLossPrice) {
      exitPrice = stopLossPrice * (1 + config.slippage);
      exitTimestamp = pricePoint.timestamp;
      exitReason = "STOP_LOSS";
      break;
    }

    // Check take-profit
    if (entry.side === "BUY" && currentPrice >= takeProfitPrice) {
      exitPrice = takeProfitPrice * (1 - config.slippage);
      exitTimestamp = pricePoint.timestamp;
      exitReason = "TAKE_PROFIT";
      break;
    } else if (entry.side === "SELL" && currentPrice <= takeProfitPrice) {
      exitPrice = takeProfitPrice * (1 + config.slippage);
      exitTimestamp = pricePoint.timestamp;
      exitReason = "TAKE_PROFIT";
      break;
    }

    // Update last known price
    exitPrice = currentPrice;
    exitTimestamp = pricePoint.timestamp;
  }

  // Calculate PNL
  let pnl: number;
  if (entry.side === "BUY") {
    // BUY: profit when price goes up
    pnl = (exitPrice - actualEntryPrice) * positionSize;
  } else {
    // SELL: profit when price goes down
    pnl = (actualEntryPrice - exitPrice) * positionSize;
  }

  return {
    id: `sim-${entry.id}`,
    market: entry.market,
    outcome: entry.outcome,
    side: entry.side,
    entryPrice: actualEntryPrice,
    exitPrice,
    size: positionSize,
    entryTimestamp: entry.timestamp,
    exitTimestamp,
    pnl: Math.round(pnl * 100) / 100,
    exitReason,
  };
}

/**
 * Run a backtest on historical trade data.
 */
export function runBacktest(
  historicalTrades: HistoricalTrade[],
  config: Partial<BacktestConfig> = {}
): BacktestResult {
  const fullConfig: BacktestConfig = { ...DEFAULT_CONFIG, ...config };
  
  console.log("[backtest] Starting backtest with config:", fullConfig);

  // Initialize bankroll for tracking
  initializeBankroll(fullConfig.initialCapital, true);
  
  // Sort trades by timestamp
  const sortedTrades = [...historicalTrades]
    .filter((t) => t.status === "FILLED")
    .sort((a, b) => a.timestamp - b.timestamp);

  if (sortedTrades.length === 0) {
    console.warn("[backtest] No filled trades to backtest");
    return createEmptyResult(fullConfig);
  }

  // Generate price timeline
  const priceTimeline = generatePriceTimeline(sortedTrades);
  
  const simulatedTrades: SimulatedTrade[] = [];
  let currentCapital = fullConfig.initialCapital;

  // Process each trade
  for (let i = 0; i < sortedTrades.length; i++) {
    const trade = sortedTrades[i];
    
    // Get future prices for this market/outcome
    const marketPrices = priceTimeline.get(trade.market);
    const outcomePrices = marketPrices?.get(trade.outcome) ?? [];
    
    // Get prices after this trade entry
    const futurePrices = outcomePrices.filter((p) => p.timestamp > trade.timestamp);

    // Simulate the trade with risk management
    const simulated = simulateTrade(trade, futurePrices, fullConfig, currentCapital);
    
    if (simulated) {
      simulatedTrades.push(simulated);
      currentCapital += simulated.pnl;
      updateBankroll(currentCapital);

      // Stop if bankroll is depleted
      if (currentCapital <= 0) {
        console.log("[backtest] Bankroll depleted, stopping simulation");
        break;
      }
    }
  }

  // Calculate statistics
  const tradeResults: TradeResult[] = simulatedTrades.map((t) => ({
    pnl: t.pnl,
    timestamp: t.exitTimestamp,
  }));

  const stats = calculatePnlStats(tradeResults);

  // Calculate date range
  const startDate = new Date(sortedTrades[0].timestamp).toISOString();
  const endDate = new Date(sortedTrades[sortedTrades.length - 1].timestamp).toISOString();
  const tradingDays = Math.ceil(
    (sortedTrades[sortedTrades.length - 1].timestamp - sortedTrades[0].timestamp) / 
    (1000 * 60 * 60 * 24)
  );

  const returnPercent = ((currentCapital - fullConfig.initialCapital) / fullConfig.initialCapital) * 100;

  return {
    config: fullConfig,
    trades: simulatedTrades,
    stats,
    startCapital: fullConfig.initialCapital,
    endCapital: Math.round(currentCapital * 100) / 100,
    returnPercent: Math.round(returnPercent * 100) / 100,
    tradingDays,
    startDate,
    endDate,
  };
}

/**
 * Create an empty backtest result.
 */
function createEmptyResult(config: BacktestConfig): BacktestResult {
  return {
    config,
    trades: [],
    stats: calculatePnlStats([]),
    startCapital: config.initialCapital,
    endCapital: config.initialCapital,
    returnPercent: 0,
    tradingDays: 0,
    startDate: new Date().toISOString(),
    endDate: new Date().toISOString(),
  };
}

// ── Report Generation ──────────────────────────────────────────────────────

/**
 * Generate a human-readable backtest report.
 */
export function generateBacktestReport(result: BacktestResult): string {
  const { config, stats, trades } = result;

  const lines: string[] = [
    "",
    "═══════════════════════════════════════════════════════════════",
    "                    BACKTEST REPORT                            ",
    "═══════════════════════════════════════════════════════════════",
    "",
    "📊 CONFIGURATION",
    "───────────────────────────────────────────────────────────────",
    `  Initial Capital:     $${config.initialCapital.toLocaleString()}`,
    `  Risk Per Trade:      ${(config.riskPerTrade * 100).toFixed(1)}%`,
    `  Stop-Loss:           ${(config.stopLossPercent * 100).toFixed(1)}%`,
    `  Take-Profit:         ${(config.takeProfitPercent * 100).toFixed(1)}%`,
    `  Max Position Size:   $${config.maxPositionSize}`,
    `  Slippage:            ${(config.slippage * 100).toFixed(2)}%`,
    "",
    "📈 PERFORMANCE SUMMARY",
    "───────────────────────────────────────────────────────────────",
    `  Trading Period:      ${result.startDate.split("T")[0]} to ${result.endDate.split("T")[0]}`,
    `  Trading Days:        ${result.tradingDays}`,
    `  Start Capital:       $${result.startCapital.toLocaleString()}`,
    `  End Capital:         $${result.endCapital.toLocaleString()}`,
    `  Total Return:        ${result.returnPercent >= 0 ? "+" : ""}${result.returnPercent.toFixed(2)}%`,
    "",
    "📉 TRADE STATISTICS",
    "───────────────────────────────────────────────────────────────",
    `  Total Trades:        ${stats.totalTrades}`,
    `  Winning Trades:      ${stats.winningTrades} (${stats.winRate.toFixed(1)}%)`,
    `  Losing Trades:       ${stats.losingTrades}`,
    `  Total PNL:           ${stats.totalPnl >= 0 ? "+" : ""}$${stats.totalPnl.toFixed(2)}`,
    `  Gross Profit:        $${stats.grossProfit.toFixed(2)}`,
    `  Gross Loss:          $${stats.grossLoss.toFixed(2)}`,
    "",
    "🎯 RISK METRICS",
    "───────────────────────────────────────────────────────────────",
    `  Profit Factor:       ${stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}`,
    `  Win Rate:            ${stats.winRate.toFixed(1)}%`,
    `  Average Win:         $${stats.averageWin.toFixed(2)}`,
    `  Average Loss:        $${stats.averageLoss.toFixed(2)}`,
    `  Largest Win:         $${stats.largestWin.toFixed(2)}`,
    `  Largest Loss:        $${stats.largestLoss.toFixed(2)}`,
    `  Max Drawdown:        $${stats.maxDrawdown.toFixed(2)} (${stats.maxDrawdownPercent.toFixed(1)}%)`,
    `  Sharpe Ratio:        ${stats.sharpeRatio.toFixed(2)}`,
    `  Expectancy:          $${stats.expectancy.toFixed(2)}`,
    "",
    "📋 TRADE BREAKDOWN BY EXIT REASON",
    "───────────────────────────────────────────────────────────────",
  ];

  // Count by exit reason
  const exitReasons: Record<string, { count: number; totalPnl: number }> = {};
  for (const trade of trades) {
    if (!exitReasons[trade.exitReason]) {
      exitReasons[trade.exitReason] = { count: 0, totalPnl: 0 };
    }
    exitReasons[trade.exitReason].count++;
    exitReasons[trade.exitReason].totalPnl += trade.pnl;
  }

  for (const [reason, data] of Object.entries(exitReasons)) {
    const emoji = reason === "STOP_LOSS" ? "🛑" : reason === "TAKE_PROFIT" ? "💰" : "📊";
    lines.push(
      `  ${emoji} ${reason.replace("_", " ")}:`.padEnd(24) +
      `${data.count} trades, PNL: ${data.totalPnl >= 0 ? "+" : ""}$${data.totalPnl.toFixed(2)}`
    );
  }

  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("");

  // Analysis summary - consider multiple factors including total PNL
  const isProfitable = stats.totalPnl > 0 || result.returnPercent > 0;
  const hasGoodExpectancy = stats.expectancy > 0;
  const hasGoodProfitFactor = stats.profitFactor > 1;
  
  if (isProfitable && hasGoodExpectancy && (stats.winRate >= 40 || hasGoodProfitFactor)) {
    lines.push("✅ STRATEGY ANALYSIS: Profitable strategy with positive expectancy.");
  } else if (isProfitable || hasGoodExpectancy) {
    lines.push("⚠️  STRATEGY ANALYSIS: Marginal performance. Consider parameter optimization.");
  } else {
    lines.push("❌ STRATEGY ANALYSIS: Poor performance. Strategy may need revision.");
  }

  if (stats.maxDrawdownPercent > 20) {
    lines.push("⚠️  WARNING: High max drawdown detected. Consider tighter risk controls.");
  }

  lines.push("");

  return lines.join("\n");
}

// ── CLI Entry Point ────────────────────────────────────────────────────────

/**
 * Main function for running backtest from command line.
 */
export async function main(): Promise<void> {
  console.log("[backtest] Polymarket Trading Bot Backtester");
  console.log("[backtest] Loading historical data...");

  // Default data file path
  const dataFile = process.argv[2] ?? "paper-trade-history-march11.json";
  
  // Load historical trades
  const historicalTrades = loadHistoricalTradesFromFile(dataFile);
  
  if (historicalTrades.length === 0) {
    console.error("[backtest] No historical data found. Exiting.");
    process.exit(1);
  }

  console.log(`[backtest] Loaded ${historicalTrades.length} historical trades from ${dataFile}`);

  // Parse config from environment or use defaults
  const config: Partial<BacktestConfig> = {
    initialCapital: parseFloat(process.env.BACKTEST_INITIAL_CAPITAL ?? "1000"),
    riskPerTrade: parseFloat(process.env.BACKTEST_RISK_PER_TRADE ?? "0.02"),
    stopLossPercent: parseFloat(process.env.BACKTEST_STOP_LOSS ?? "0.10"),
    takeProfitPercent: parseFloat(process.env.BACKTEST_TAKE_PROFIT ?? "0.30"),
    minEdge: parseFloat(process.env.MIN_EDGE ?? "0.05"),
    maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE_USDC ?? "100"),
    slippage: parseFloat(process.env.BACKTEST_SLIPPAGE ?? "0.005"),
  };

  // Run backtest
  const result = runBacktest(historicalTrades, config);

  // Generate and print report
  const report = generateBacktestReport(result);
  console.log(report);

  // Save results to file
  const outputPath = path.join(process.cwd(), "data", "backtest-results.json");
  try {
    const dataDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8");
    console.log(`[backtest] Results saved to ${outputPath}`);
  } catch (err) {
    console.error("[backtest] Failed to save results:", err);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}
