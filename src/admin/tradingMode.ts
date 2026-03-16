/**
 * tradingMode.ts — Trading Mode Management
 *
 * This module manages the trading mode (paper vs. live) for the bot.
 * It provides a centralized way to check and toggle the trading mode,
 * which can be controlled via the dashboard.
 */

import { config } from "../config/env";
import { getItem, setItem } from "../utils/jsonStore";

// ── Types ──────────────────────────────────────────────────────────────────

export type TradingMode = "paper" | "live";

export interface TradingModeState {
  mode: TradingMode;
  changedAt: number;
  changedBy: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const TRADING_MODE_KEY = "tradingMode";

// Default mode from environment config
const DEFAULT_MODE: TradingMode = config.trading.tradingMode;

// ── State ──────────────────────────────────────────────────────────────────

let currentState: TradingModeState | null = null;

// ── Functions ──────────────────────────────────────────────────────────────

/**
 * Initialize the trading mode state from persistent storage or defaults.
 */
export function initTradingMode(): void {
  const stored = getItem<TradingModeState>(TRADING_MODE_KEY);
  if (stored) {
    currentState = stored;
    console.log(`[tradingMode] Loaded trading mode: ${currentState.mode}`);
  } else {
    currentState = {
      mode: DEFAULT_MODE,
      changedAt: Date.now(),
      changedBy: "system",
    };
    setItem(TRADING_MODE_KEY, currentState, true);
    console.log(`[tradingMode] Initialized trading mode: ${currentState.mode}`);
  }
}

/**
 * Get the current trading mode.
 * @returns The current trading mode ("paper" or "live")
 */
export function getTradingMode(): TradingMode {
  if (!currentState) {
    initTradingMode();
  }
  // currentState is guaranteed to be non-null after initTradingMode()
  return currentState?.mode ?? DEFAULT_MODE;
}

/**
 * Get the full trading mode state including metadata.
 * @returns The trading mode state object
 */
export function getTradingModeState(): TradingModeState {
  if (!currentState) {
    initTradingMode();
  }
  // currentState is guaranteed to be non-null after initTradingMode()
  // Return a copy to prevent external mutation
  return currentState 
    ? { ...currentState } 
    : { mode: DEFAULT_MODE, changedAt: Date.now(), changedBy: "system" };
}

/**
 * Check if the bot is in paper trading mode.
 * @returns true if in paper mode, false if in live mode
 */
export function isPaperMode(): boolean {
  return getTradingMode() === "paper";
}

/**
 * Check if the bot is in live trading mode.
 * @returns true if in live mode, false if in paper mode
 */
export function isLiveMode(): boolean {
  return getTradingMode() === "live";
}

/**
 * Set the trading mode.
 * @param mode - The new trading mode ("paper" or "live")
 * @param changedBy - Identifier for who changed the mode (default: "api")
 * @returns The updated trading mode state
 */
export function setTradingMode(mode: TradingMode, changedBy = "api"): TradingModeState {
  if (mode !== "paper" && mode !== "live") {
    throw new Error(`Invalid trading mode: ${mode}. Must be "paper" or "live".`);
  }

  const previousMode = currentState?.mode ?? DEFAULT_MODE;
  
  currentState = {
    mode,
    changedAt: Date.now(),
    changedBy,
  };
  
  setItem(TRADING_MODE_KEY, currentState, true);
  
  console.log(`[tradingMode] Trading mode changed: ${previousMode} → ${mode} (by ${changedBy})`);
  
  return { ...currentState };
}

/**
 * Toggle between paper and live trading modes.
 * @param changedBy - Identifier for who changed the mode (default: "api")
 * @returns The updated trading mode state
 */
export function toggleTradingMode(changedBy = "api"): TradingModeState {
  const newMode: TradingMode = getTradingMode() === "paper" ? "live" : "paper";
  return setTradingMode(newMode, changedBy);
}
