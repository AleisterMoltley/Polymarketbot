/**
 * tradingHours.ts — Trading Hours Management
 *
 * This module manages trading hours restrictions (10 AM - 4 PM EST).
 * It provides functions to check if trading is allowed based on time
 * and to toggle the trading hours restriction on/off via the dashboard.
 */

import { getItem, setItem } from "./jsonStore";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TradingHoursState {
  enabled: boolean;
  startHour: number;  // 10 = 10 AM EST
  endHour: number;    // 16 = 4 PM EST
  timezone: string;   // "America/New_York" for EST/EDT
  changedAt: number;
  changedBy: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const TRADING_HOURS_KEY = "tradingHours";

// Default trading hours: 10 AM - 4 PM EST (most profitable hours)
const DEFAULT_START_HOUR = 10;  // 10 AM
const DEFAULT_END_HOUR = 16;    // 4 PM
const DEFAULT_TIMEZONE = "America/New_York";

// ── State ──────────────────────────────────────────────────────────────────

let currentState: TradingHoursState | null = null;

// ── Functions ──────────────────────────────────────────────────────────────

/**
 * Initialize the trading hours state from persistent storage or defaults.
 */
export function initTradingHours(): void {
  const stored = getItem<TradingHoursState>(TRADING_HOURS_KEY);
  if (stored) {
    currentState = stored;
    console.log(`[tradingHours] Loaded trading hours: ${currentState.enabled ? 'enabled' : 'disabled'} (${currentState.startHour}:00 - ${currentState.endHour}:00 ${currentState.timezone})`);
  } else {
    currentState = {
      enabled: false,  // Disabled by default
      startHour: DEFAULT_START_HOUR,
      endHour: DEFAULT_END_HOUR,
      timezone: DEFAULT_TIMEZONE,
      changedAt: Date.now(),
      changedBy: "system",
    };
    setItem(TRADING_HOURS_KEY, currentState, true);
    console.log(`[tradingHours] Initialized trading hours: disabled by default`);
  }
}

/**
 * Get the current trading hours state.
 * @returns The trading hours state object
 */
export function getTradingHoursState(): TradingHoursState {
  if (!currentState) {
    initTradingHours();
  }
  // Return a copy to prevent external mutation
  return currentState
    ? { ...currentState }
    : {
        enabled: false,
        startHour: DEFAULT_START_HOUR,
        endHour: DEFAULT_END_HOUR,
        timezone: DEFAULT_TIMEZONE,
        changedAt: Date.now(),
        changedBy: "system",
      };
}

/**
 * Check if trading hours restriction is enabled.
 * @returns true if trading hours restriction is enabled
 */
export function isTradingHoursEnabled(): boolean {
  return getTradingHoursState().enabled;
}

/**
 * Get the current hour in the configured timezone (EST/EDT).
 * @returns The current hour (0-23) in EST/EDT
 */
export function getCurrentHourInTimezone(): number {
  const state = getTradingHoursState();
  const now = new Date();
  
  // Use Intl API to get the hour in the specified timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: state.timezone,
    hour: 'numeric',
    hour12: false,
  });
  
  const hourStr = formatter.format(now);
  return parseInt(hourStr, 10);
}

/**
 * Check if current time is within allowed trading hours.
 * @returns true if current time is between startHour and endHour in EST/EDT
 */
export function isWithinTradingHours(): boolean {
  const state = getTradingHoursState();
  const currentHour = getCurrentHourInTimezone();
  
  // Check if current hour is between start and end (exclusive of end)
  // e.g., 10 AM to 4 PM means hours 10, 11, 12, 13, 14, 15 are allowed
  return currentHour >= state.startHour && currentHour < state.endHour;
}

/**
 * Check if trading is allowed based on trading hours setting.
 * @returns true if trading is allowed (either hours restriction disabled, or within hours)
 */
export function isTradingAllowed(): boolean {
  const state = getTradingHoursState();
  
  // If trading hours restriction is disabled, always allow trading
  if (!state.enabled) {
    return true;
  }
  
  // If enabled, check if within trading hours
  return isWithinTradingHours();
}

/**
 * Get a human-readable status message about trading hours.
 * @returns Status message indicating current trading hours status
 */
export function getTradingHoursStatus(): string {
  const state = getTradingHoursState();
  
  if (!state.enabled) {
    return "Trading hours restriction: OFF (24/7 trading)";
  }
  
  const currentHour = getCurrentHourInTimezone();
  const isAllowed = isWithinTradingHours();
  
  const startTime = `${state.startHour}:00`;
  const endTime = `${state.endHour}:00`;
  const statusEmoji = isAllowed ? "🟢" : "🔴";
  const statusText = isAllowed ? "ACTIVE" : "PAUSED";
  
  return `${statusEmoji} Trading hours: ${startTime} - ${endTime} EST | Current: ${currentHour}:00 EST | Status: ${statusText}`;
}

/**
 * Enable trading hours restriction.
 * @param changedBy - Identifier for who enabled it (default: "api")
 * @returns The updated trading hours state
 */
export function enableTradingHours(changedBy = "api"): TradingHoursState {
  const state = getTradingHoursState();
  
  currentState = {
    ...state,
    enabled: true,
    changedAt: Date.now(),
    changedBy,
  };
  
  setItem(TRADING_HOURS_KEY, currentState, true);
  
  console.log(`[tradingHours] Trading hours enabled by ${changedBy}`);
  
  return { ...currentState };
}

/**
 * Disable trading hours restriction.
 * @param changedBy - Identifier for who disabled it (default: "api")
 * @returns The updated trading hours state
 */
export function disableTradingHours(changedBy = "api"): TradingHoursState {
  const state = getTradingHoursState();
  
  currentState = {
    ...state,
    enabled: false,
    changedAt: Date.now(),
    changedBy,
  };
  
  setItem(TRADING_HOURS_KEY, currentState, true);
  
  console.log(`[tradingHours] Trading hours disabled by ${changedBy}`);
  
  return { ...currentState };
}

/**
 * Toggle trading hours restriction on/off.
 * @param changedBy - Identifier for who changed the setting (default: "api")
 * @returns The updated trading hours state
 */
export function toggleTradingHours(changedBy = "api"): TradingHoursState {
  const state = getTradingHoursState();
  
  if (state.enabled) {
    return disableTradingHours(changedBy);
  } else {
    return enableTradingHours(changedBy);
  }
}

/**
 * Set trading hours configuration.
 * @param options - Configuration options
 * @returns The updated trading hours state
 */
export function setTradingHours(
  options: {
    enabled?: boolean;
    startHour?: number;
    endHour?: number;
    changedBy?: string;
  }
): TradingHoursState {
  const state = getTradingHoursState();
  const changedBy = options.changedBy ?? "api";
  
  // Validate hours if provided
  if (options.startHour !== undefined) {
    if (typeof options.startHour !== "number" || !Number.isInteger(options.startHour)) {
      throw new Error("Invalid startHour: must be an integer");
    }
    if (options.startHour < 0 || options.startHour > 23) {
      throw new Error("Invalid startHour: must be between 0 and 23");
    }
  }
  if (options.endHour !== undefined) {
    if (typeof options.endHour !== "number" || !Number.isInteger(options.endHour)) {
      throw new Error("Invalid endHour: must be an integer");
    }
    if (options.endHour < 1 || options.endHour > 24) {
      throw new Error("Invalid endHour: must be between 1 and 24");
    }
  }
  
  // Calculate final values
  const finalStartHour = options.startHour ?? state.startHour;
  const finalEndHour = options.endHour ?? state.endHour;
  
  // Validate that startHour < endHour
  if (finalStartHour >= finalEndHour) {
    throw new Error("Invalid hours: startHour must be less than endHour");
  }
  
  currentState = {
    enabled: options.enabled ?? state.enabled,
    startHour: finalStartHour,
    endHour: finalEndHour,
    timezone: state.timezone,
    changedAt: Date.now(),
    changedBy,
  };
  
  setItem(TRADING_HOURS_KEY, currentState, true);
  
  console.log(`[tradingHours] Trading hours updated: enabled=${currentState.enabled}, hours=${currentState.startHour}:00-${currentState.endHour}:00 (by ${changedBy})`);
  
  return { ...currentState };
}
