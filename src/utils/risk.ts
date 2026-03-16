import { getItem, setItem, saveStore } from "./jsonStore";

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Bankroll state stored in the in-memory store.
 */
export interface BankrollState {
  /** Initial capital when tracking started */
  initialCapital: number;
  /** Current available capital */
  currentCapital: number;
  /** Highest capital reached (for drawdown calculation) */
  highWaterMark: number;
  /** Timestamp when bankroll tracking started */
  startedAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

/**
 * Position with risk parameters for stop-loss tracking.
 */
export interface RiskPosition {
  id: string;
  market: string;
  outcome: string;
  entryPrice: number;
  size: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
  openedAt: number;
}

/**
 * PNL statistics for performance analysis.
 */
export interface PnlStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  expectancy: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const BANKROLL_KEY = "bankroll";
const RISK_POSITIONS_KEY = "riskPositions";

/** Default risk percentage per trade (2% of bankroll) */
export const DEFAULT_RISK_PER_TRADE = 0.02;

/** Default stop-loss percentage (e.g., 10% below entry) */
export const DEFAULT_STOP_LOSS_PERCENT = 0.10;

/** Default take-profit percentage (e.g., 30% above entry for 3:1 risk/reward) */
export const DEFAULT_TAKE_PROFIT_PERCENT = 0.30;

// ── Bankroll Management ────────────────────────────────────────────────────

/**
 * Initialize the bankroll tracker with starting capital.
 * Does not overwrite if bankroll already exists.
 */
export function initializeBankroll(initialCapital: number, force = false): BankrollState {
  const existing = getItem<BankrollState>(BANKROLL_KEY);
  if (existing && !force) {
    return existing;
  }

  const bankroll: BankrollState = {
    initialCapital,
    currentCapital: initialCapital,
    highWaterMark: initialCapital,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };

  setItem(BANKROLL_KEY, bankroll, true);
  return bankroll;
}

/**
 * Get the current bankroll state.
 */
export function getBankroll(): BankrollState | undefined {
  return getItem<BankrollState>(BANKROLL_KEY);
}

/**
 * Update the current capital (e.g., after a trade closes).
 */
export function updateBankroll(newCapital: number): BankrollState {
  let bankroll = getBankroll();
  if (!bankroll) {
    bankroll = initializeBankroll(newCapital);
  }

  bankroll.currentCapital = newCapital;
  bankroll.updatedAt = Date.now();

  // Update high water mark if we've reached a new peak
  if (newCapital > bankroll.highWaterMark) {
    bankroll.highWaterMark = newCapital;
  }

  setItem(BANKROLL_KEY, bankroll, true);
  return bankroll;
}

/**
 * Calculate current drawdown from high water mark.
 */
export function calculateDrawdown(): { absolute: number; percent: number } {
  const bankroll = getBankroll();
  if (!bankroll) {
    return { absolute: 0, percent: 0 };
  }

  const absolute = bankroll.highWaterMark - bankroll.currentCapital;
  const percent = bankroll.highWaterMark > 0 
    ? (absolute / bankroll.highWaterMark) * 100 
    : 0;

  return { absolute, percent };
}

// ── Position Sizing (Kelly Criterion & Fixed Percentage) ──────────────────

/**
 * Calculate position size using fixed percentage risk model.
 * This limits each trade to risk a fixed percentage of the bankroll.
 * 
 * @param bankrollCapital - Current bankroll capital
 * @param entryPrice - Entry price (0-1 for prediction markets)
 * @param stopLossPrice - Stop-loss price
 * @param riskPerTrade - Risk percentage per trade (default: 2%)
 * @returns Position size in USDC
 */
export function calculatePositionSize(
  bankrollCapital: number,
  entryPrice: number,
  stopLossPrice: number,
  riskPerTrade: number = DEFAULT_RISK_PER_TRADE
): number {
  // Amount we're willing to risk on this trade
  const riskAmount = bankrollCapital * riskPerTrade;

  // Calculate risk per unit (difference between entry and stop-loss)
  const riskPerUnit = Math.abs(entryPrice - stopLossPrice);

  // Avoid division by zero
  if (riskPerUnit <= 0) {
    console.warn("[risk] Invalid stop-loss, returning minimum position size");
    return riskAmount * 0.1; // Very small position if no valid stop-loss
  }

  // Position size = Risk Amount / Risk Per Unit
  const positionSize = riskAmount / riskPerUnit;

  // Round to 2 decimal places (cents)
  return Math.round(positionSize * 100) / 100;
}

/**
 * Calculate optimal position size using Kelly Criterion.
 * Kelly = (bp - q) / b where:
 *   b = odds (potential profit / potential loss)
 *   p = probability of winning
 *   q = probability of losing (1 - p)
 * 
 * @param winProbability - Estimated probability of winning (0-1)
 * @param winLossRatio - Ratio of average win to average loss
 * @param kellyFraction - Fraction of Kelly to use (0.25-0.5 recommended)
 * @returns Optimal betting fraction of bankroll
 */
export function calculateKellyFraction(
  winProbability: number,
  winLossRatio: number,
  kellyFraction: number = 0.25
): number {
  const lossProbability = 1 - winProbability;
  const kelly = (winLossRatio * winProbability - lossProbability) / winLossRatio;
  
  // Never bet more than the Kelly fraction recommends (fractional Kelly)
  const adjustedKelly = Math.max(0, kelly * kellyFraction);
  
  // Cap at 10% of bankroll as absolute max
  return Math.min(adjustedKelly, 0.10);
}

// ── Stop-Loss Management ───────────────────────────────────────────────────

/**
 * Calculate stop-loss price based on entry price and stop-loss percentage.
 * For BUY orders (betting YES), stop-loss is below entry.
 * For SELL orders (betting NO), stop-loss is above entry.
 */
export function calculateStopLossPrice(
  entryPrice: number,
  side: "BUY" | "SELL",
  stopLossPercent: number = DEFAULT_STOP_LOSS_PERCENT
): number {
  if (side === "BUY") {
    // For buys, stop-loss triggers if price falls below threshold
    return Math.max(0.01, entryPrice * (1 - stopLossPercent));
  } else {
    // For sells, stop-loss triggers if price rises above threshold
    return Math.min(0.99, entryPrice * (1 + stopLossPercent));
  }
}

/**
 * Calculate take-profit price based on entry price and take-profit percentage.
 */
export function calculateTakeProfitPrice(
  entryPrice: number,
  side: "BUY" | "SELL",
  takeProfitPercent: number = DEFAULT_TAKE_PROFIT_PERCENT
): number {
  if (side === "BUY") {
    // For buys, take-profit triggers if price rises above threshold
    return Math.min(0.99, entryPrice * (1 + takeProfitPercent));
  } else {
    // For sells, take-profit triggers if price falls below threshold
    return Math.max(0.01, entryPrice * (1 - takeProfitPercent));
  }
}

/**
 * Check if a position should be stopped out based on current price.
 */
export function shouldTriggerStopLoss(
  position: RiskPosition,
  currentPrice: number,
  side: "BUY" | "SELL"
): boolean {
  if (side === "BUY") {
    return currentPrice <= position.stopLossPrice;
  } else {
    return currentPrice >= position.stopLossPrice;
  }
}

/**
 * Check if a position should take profit based on current price.
 */
export function shouldTriggerTakeProfit(
  position: RiskPosition,
  currentPrice: number,
  side: "BUY" | "SELL"
): boolean {
  if (!position.takeProfitPrice) return false;
  
  if (side === "BUY") {
    return currentPrice >= position.takeProfitPrice;
  } else {
    return currentPrice <= position.takeProfitPrice;
  }
}

// ── Risk Position Tracking ─────────────────────────────────────────────────

/**
 * Get all tracked risk positions.
 */
export function getRiskPositions(): RiskPosition[] {
  return getItem<RiskPosition[]>(RISK_POSITIONS_KEY) ?? [];
}

/**
 * Add a new risk position to track.
 */
export function addRiskPosition(position: RiskPosition): void {
  const positions = getRiskPositions();
  positions.push(position);
  setItem(RISK_POSITIONS_KEY, positions, true);
}

/**
 * Remove a risk position by ID.
 */
export function removeRiskPosition(id: string): void {
  const positions = getRiskPositions();
  const filtered = positions.filter((p) => p.id !== id);
  setItem(RISK_POSITIONS_KEY, filtered, true);
}

/**
 * Find a risk position by market and outcome.
 */
export function findRiskPosition(market: string, outcome: string): RiskPosition | undefined {
  return getRiskPositions().find((p) => p.market === market && p.outcome === outcome);
}

// ── PNL Statistics ─────────────────────────────────────────────────────────

/**
 * Trade result for PNL calculation.
 */
export interface TradeResult {
  pnl: number;
  timestamp: number;
}

/**
 * Calculate comprehensive PNL statistics from trade results.
 */
export function calculatePnlStats(trades: TradeResult[]): PnlStats {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnl: 0,
      grossProfit: 0,
      grossLoss: 0,
      profitFactor: 0,
      averageWin: 0,
      averageLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      sharpeRatio: 0,
      expectancy: 0,
    };
  }

  const winningTrades = trades.filter((t) => t.pnl > 0);
  const losingTrades = trades.filter((t) => t.pnl < 0);

  const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  const totalPnl = grossProfit - grossLoss;

  const wins = winningTrades.map((t) => t.pnl);
  const losses = losingTrades.map((t) => Math.abs(t.pnl));

  const largestWin = wins.length > 0 ? Math.max(...wins) : 0;
  const largestLoss = losses.length > 0 ? Math.max(...losses) : 0;
  const averageWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const averageLoss = losses.length > 0 ? grossLoss / losses.length : 0;

  // Profit factor: Gross Profit / Gross Loss
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Win rate
  const winRate = (winningTrades.length / trades.length) * 100;

  // Expectancy: (Win Rate * Avg Win) - (Loss Rate * Avg Loss)
  const expectancy = 
    (winningTrades.length / trades.length) * averageWin -
    (losingTrades.length / trades.length) * averageLoss;

  // Calculate max drawdown
  const { maxDrawdown, maxDrawdownPercent } = calculateMaxDrawdown(trades);

  // Calculate Sharpe Ratio (simplified - assuming risk-free rate of 0)
  const sharpeRatio = calculateSharpeRatio(trades);

  return {
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: Math.round(winRate * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    grossProfit: Math.round(grossProfit * 100) / 100,
    grossLoss: Math.round(grossLoss * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    averageWin: Math.round(averageWin * 100) / 100,
    averageLoss: Math.round(averageLoss * 100) / 100,
    largestWin: Math.round(largestWin * 100) / 100,
    largestLoss: Math.round(largestLoss * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    maxDrawdownPercent: Math.round(maxDrawdownPercent * 100) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
  };
}

/**
 * Calculate maximum drawdown from a series of trades.
 */
function calculateMaxDrawdown(trades: TradeResult[]): { maxDrawdown: number; maxDrawdownPercent: number } {
  if (trades.length === 0) {
    return { maxDrawdown: 0, maxDrawdownPercent: 0 };
  }

  // Sort trades by timestamp
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;

  for (const trade of sortedTrades) {
    cumulative += trade.pnl;
    
    if (cumulative > peak) {
      peak = cumulative;
    }

    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = peak > 0 ? (drawdown / peak) * 100 : 0;
    }
  }

  return { maxDrawdown, maxDrawdownPercent };
}

/**
 * Calculate Sharpe Ratio (simplified version).
 * Sharpe = Mean Return / Std Dev of Returns
 */
function calculateSharpeRatio(trades: TradeResult[]): number {
  if (trades.length < 2) return 0;

  const returns = trades.map((t) => t.pnl);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  
  const squaredDiffs = returns.map((r) => Math.pow(r - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return mean > 0 ? Infinity : 0;
  
  // Annualized Sharpe (assuming ~252 trading days)
  return (mean / stdDev) * Math.sqrt(252);
}

// ── Risk Validation ────────────────────────────────────────────────────────

/**
 * Validate that a trade meets risk management criteria.
 */
export function validateTradeRisk(
  positionSize: number,
  bankrollCapital: number,
  maxDrawdownPercent: number = 20
): { valid: boolean; reason?: string } {
  // Check if position size is within reasonable limits
  if (positionSize <= 0) {
    return { valid: false, reason: "Position size must be positive" };
  }

  // Check current drawdown
  const drawdown = calculateDrawdown();
  if (drawdown.percent > maxDrawdownPercent) {
    return { 
      valid: false, 
      reason: `Current drawdown (${drawdown.percent.toFixed(2)}%) exceeds max allowed (${maxDrawdownPercent}%)` 
    };
  }

  // Check if position size exceeds maximum allowed (10% of bankroll)
  const maxPositionPercent = 0.10;
  if (positionSize > bankrollCapital * maxPositionPercent) {
    return { 
      valid: false, 
      reason: `Position size ($${positionSize}) exceeds max (${maxPositionPercent * 100}% of bankroll)` 
    };
  }

  return { valid: true };
}

/**
 * Flush risk data to persistent storage.
 */
export function flushRiskData(): void {
  saveStore();
}
