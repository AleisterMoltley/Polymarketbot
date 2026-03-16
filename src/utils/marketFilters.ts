/**
 * Market Filters Module
 * 
 * Provides filtering capabilities for Polymarket markets:
 * - Resolution time filter: Filter markets that resolve within a specified time window
 * - Liquidity filter: Filter out illiquid markets
 * - Volume filter: Filter markets by minimum trading volume
 * - Category filter: Filter markets by category/tags
 * - Pagination: Support for large market volumes
 */

import { config } from "../config/env";
import { getItem, setItem } from "./jsonStore";

// ── Extended Market Interface ──────────────────────────────────────────────

export interface ExtendedMarket {
  conditionId: string;
  question: string;
  outcomes: string[];
  prices: number[];
  // Extended fields for filtering
  liquidity?: number;      // Total liquidity in USDC
  volume?: number;         // 24h trading volume in USDC
  volume24h?: number;      // Alias for volume (API compatibility)
  category?: string;       // Market category (e.g., "politics", "sports", "crypto")
  tags?: string[];         // Market tags for more granular filtering
  slug?: string;           // Market slug/identifier
  endDate?: string;        // Market end date
  active?: boolean;        // Whether market is active
  closed?: boolean;        // Whether market is closed
}

// ── Resolution Time Constants ──────────────────────────────────────────────

/** Maximum resolution time in milliseconds (5 minutes = 300,000ms) */
export const MAX_RESOLUTION_TIME_MS = 5 * 60 * 1000; // 5 minutes

// ── Filter Configuration ───────────────────────────────────────────────────

export interface MarketFilterConfig {
  // Resolution time filter (5-minute markets only)
  maxResolutionTimeMs: number; // Maximum time until resolution in ms (default: 300000 = 5 min)
  
  // Liquidity filter
  minLiquidity: number;        // Minimum liquidity in USDC (default: 0 = no filter)
  
  // Volume filter
  minVolume: number;           // Minimum 24h volume in USDC (default: 0 = no filter)
  
  // Category filter
  categories: string[];        // Allowed categories (empty = all categories)
  excludeCategories: string[]; // Categories to exclude
  
  // Tag filter
  tags: string[];              // Required tags (empty = no tag filter)
  excludeTags: string[];       // Tags to exclude
  
  // Pagination
  pageSize: number;            // Number of markets per page (default: 100)
  
  // General
  enabled: boolean;            // Whether filtering is enabled
}

// ── Default Configuration ──────────────────────────────────────────────────

const DEFAULT_FILTER_CONFIG: MarketFilterConfig = {
  maxResolutionTimeMs: MAX_RESOLUTION_TIME_MS, // 5 minutes - only trade markets resolving soon
  minLiquidity: 0,
  minVolume: 0,
  categories: [],
  excludeCategories: [],
  tags: [],
  excludeTags: [],
  pageSize: 100,
  enabled: true,
};

// ── Store Keys & Limits ────────────────────────────────────────────────────

const FILTER_CONFIG_KEY = "marketFilterConfig";
const MAX_PAGE_SIZE = 1000;
const MIN_PAGE_SIZE = 1;

// ── Configuration Management ───────────────────────────────────────────────

let _filterConfig: MarketFilterConfig = { ...DEFAULT_FILTER_CONFIG };

/**
 * Initialize filter configuration from persistent store
 */
export function initMarketFilters(): void {
  const stored = getItem<MarketFilterConfig>(FILTER_CONFIG_KEY);
  if (stored) {
    _filterConfig = { ...DEFAULT_FILTER_CONFIG, ...stored };
    console.log("[filters] Loaded market filter config:", _filterConfig);
  } else {
    // Load from centralized config
    _filterConfig = {
      ...DEFAULT_FILTER_CONFIG,
      maxResolutionTimeMs: config.marketFilters.maxResolutionTimeMs,
      minLiquidity: config.marketFilters.minLiquidity,
      minVolume: config.marketFilters.minVolume,
      categories: config.marketFilters.filterCategories,
      excludeCategories: config.marketFilters.excludeCategories,
      pageSize: config.marketFilters.marketPageSize,
      enabled: config.marketFilters.filtersEnabled,
    };
    console.log("[filters] Initialized market filter config from env:", _filterConfig);
  }
}

/**
 * Get current filter configuration
 */
export function getFilterConfig(): MarketFilterConfig {
  return { ..._filterConfig };
}

/**
 * Update filter configuration
 */
export function setFilterConfig(
  updates: Partial<MarketFilterConfig>,
  changedBy: string = "api"
): MarketFilterConfig {
  // Validate updates
  if (updates.maxResolutionTimeMs !== undefined && updates.maxResolutionTimeMs < 0) {
    throw new Error("maxResolutionTimeMs cannot be negative");
  }
  if (updates.minLiquidity !== undefined && updates.minLiquidity < 0) {
    throw new Error("minLiquidity cannot be negative");
  }
  if (updates.minVolume !== undefined && updates.minVolume < 0) {
    throw new Error("minVolume cannot be negative");
  }
  if (updates.pageSize !== undefined && (updates.pageSize < MIN_PAGE_SIZE || updates.pageSize > MAX_PAGE_SIZE)) {
    throw new Error(`pageSize must be between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}`);
  }
  
  _filterConfig = { ..._filterConfig, ...updates };
  setItem(FILTER_CONFIG_KEY, _filterConfig, true);
  console.log(`[filters] Filter config updated by ${changedBy}:`, updates);
  return { ..._filterConfig };
}

/**
 * Reset filter configuration to defaults
 */
export function resetFilterConfig(): MarketFilterConfig {
  _filterConfig = { ...DEFAULT_FILTER_CONFIG };
  setItem(FILTER_CONFIG_KEY, _filterConfig, true);
  console.log("[filters] Filter config reset to defaults");
  return { ..._filterConfig };
}

// ── Filter Functions ───────────────────────────────────────────────────────

/**
 * Filter markets by resolution time.
 * Only includes markets that will resolve within the specified time window.
 * This ensures the bot only trades markets resolving within 5 minutes (or configured time).
 * 
 * @param markets - Array of markets to filter
 * @param maxResolutionTimeMs - Maximum time until resolution in milliseconds
 * @returns Markets that resolve within the specified time window
 */
export function filterByResolutionTime(
  markets: ExtendedMarket[],
  maxResolutionTimeMs: number
): ExtendedMarket[] {
  if (maxResolutionTimeMs <= 0) return markets;
  
  const now = Date.now();
  const maxEndTime = now + maxResolutionTimeMs;
  
  return markets.filter(market => {
    // Skip markets without endDate
    if (!market.endDate) {
      return false;
    }
    
    // Parse the end date
    const endTime = new Date(market.endDate).getTime();
    
    // Check if the date is valid
    if (isNaN(endTime)) {
      console.warn(`[filters] Invalid endDate for market ${market.conditionId}: ${market.endDate}`);
      return false;
    }
    
    // Market must resolve in the future but within the max time window
    // Allow markets that resolve within the next maxResolutionTimeMs
    return endTime > now && endTime <= maxEndTime;
  });
}

/**
 * Filter markets by minimum liquidity
 */
export function filterByLiquidity(
  markets: ExtendedMarket[],
  minLiquidity: number
): ExtendedMarket[] {
  if (minLiquidity <= 0) return markets;
  
  return markets.filter(market => {
    const liquidity = market.liquidity ?? 0;
    return liquidity >= minLiquidity;
  });
}

/**
 * Filter markets by minimum 24h volume
 */
export function filterByVolume(
  markets: ExtendedMarket[],
  minVolume: number
): ExtendedMarket[] {
  if (minVolume <= 0) return markets;
  
  return markets.filter(market => {
    const volume = market.volume ?? market.volume24h ?? 0;
    return volume >= minVolume;
  });
}

/**
 * Filter markets by categories
 */
export function filterByCategory(
  markets: ExtendedMarket[],
  allowedCategories: string[],
  excludedCategories: string[] = []
): ExtendedMarket[] {
  return markets.filter(market => {
    const category = market.category?.toLowerCase() ?? "";
    
    // Check excluded categories first
    if (excludedCategories.length > 0) {
      const isExcluded = excludedCategories.some(
        exc => category === exc.toLowerCase()
      );
      if (isExcluded) return false;
    }
    
    // If no allowed categories specified, allow all (except excluded)
    if (allowedCategories.length === 0) return true;
    
    // Check if market is in allowed categories
    return allowedCategories.some(
      allowed => category === allowed.toLowerCase()
    );
  });
}

/**
 * Filter markets by tags
 */
export function filterByTags(
  markets: ExtendedMarket[],
  requiredTags: string[],
  excludedTags: string[] = []
): ExtendedMarket[] {
  return markets.filter(market => {
    const marketTags = (market.tags ?? []).map(t => t.toLowerCase());
    
    // Check excluded tags first
    if (excludedTags.length > 0) {
      const hasExcludedTag = excludedTags.some(
        exc => marketTags.includes(exc.toLowerCase())
      );
      if (hasExcludedTag) return false;
    }
    
    // If no required tags specified, allow all (except excluded)
    if (requiredTags.length === 0) return true;
    
    // Check if market has at least one required tag
    return requiredTags.some(
      req => marketTags.includes(req.toLowerCase())
    );
  });
}

/**
 * Apply pagination to markets
 */
export function paginateMarkets(
  markets: ExtendedMarket[],
  page: number,
  pageSize: number
): {
  markets: ExtendedMarket[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
} {
  const total = markets.length;
  const totalPages = Math.ceil(total / pageSize);
  const currentPage = Math.max(1, Math.min(page, totalPages || 1));
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  
  return {
    markets: markets.slice(start, end),
    pagination: {
      page: currentPage,
      pageSize,
      total,
      totalPages,
      hasNext: currentPage < totalPages,
      hasPrev: currentPage > 1,
    },
  };
}

// ── Main Filter Function ───────────────────────────────────────────────────

export interface FilterResult {
  markets: ExtendedMarket[];
  totalBefore: number;
  totalAfter: number;
  filtersApplied: string[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

/**
 * Apply all configured filters to markets
 */
export function applyFilters(
  markets: ExtendedMarket[],
  config?: Partial<MarketFilterConfig>,
  page?: number
): FilterResult {
  const cfg = { ..._filterConfig, ...config };
  const filtersApplied: string[] = [];
  const totalBefore = markets.length;
  
  let filtered = [...markets];
  
  // Skip filtering if disabled
  if (!cfg.enabled) {
    return {
      markets: filtered,
      totalBefore,
      totalAfter: filtered.length,
      filtersApplied: ["none (filtering disabled)"],
    };
  }
  
  // Apply resolution time filter (5-minute markets only)
  // This is the most important filter - ensures we only trade markets resolving soon
  if (cfg.maxResolutionTimeMs > 0) {
    filtered = filterByResolutionTime(filtered, cfg.maxResolutionTimeMs);
    const minutes = Math.round(cfg.maxResolutionTimeMs / 60000);
    filtersApplied.push(`resolves within ${minutes} min`);
  }
  
  // Apply liquidity filter
  if (cfg.minLiquidity > 0) {
    filtered = filterByLiquidity(filtered, cfg.minLiquidity);
    filtersApplied.push(`liquidity >= ${cfg.minLiquidity}`);
  }
  
  // Apply volume filter
  if (cfg.minVolume > 0) {
    filtered = filterByVolume(filtered, cfg.minVolume);
    filtersApplied.push(`volume >= ${cfg.minVolume}`);
  }
  
  // Apply category filter
  if (cfg.categories.length > 0 || cfg.excludeCategories.length > 0) {
    filtered = filterByCategory(filtered, cfg.categories, cfg.excludeCategories);
    if (cfg.categories.length > 0) {
      filtersApplied.push(`categories: ${cfg.categories.join(", ")}`);
    }
    if (cfg.excludeCategories.length > 0) {
      filtersApplied.push(`excluded categories: ${cfg.excludeCategories.join(", ")}`);
    }
  }
  
  // Apply tag filter
  if (cfg.tags.length > 0 || cfg.excludeTags.length > 0) {
    filtered = filterByTags(filtered, cfg.tags, cfg.excludeTags);
    if (cfg.tags.length > 0) {
      filtersApplied.push(`tags: ${cfg.tags.join(", ")}`);
    }
    if (cfg.excludeTags.length > 0) {
      filtersApplied.push(`excluded tags: ${cfg.excludeTags.join(", ")}`);
    }
  }
  
  // Apply pagination if page is specified
  if (page !== undefined && page > 0) {
    const paginated = paginateMarkets(filtered, page, cfg.pageSize);
    return {
      markets: paginated.markets,
      totalBefore,
      totalAfter: filtered.length,
      filtersApplied: filtersApplied.length > 0 ? filtersApplied : ["none"],
      pagination: paginated.pagination,
    };
  }
  
  return {
    markets: filtered,
    totalBefore,
    totalAfter: filtered.length,
    filtersApplied: filtersApplied.length > 0 ? filtersApplied : ["none"],
  };
}

// ── Filter Statistics ──────────────────────────────────────────────────────

export interface FilterStats {
  config: MarketFilterConfig;
  lastFilterResult?: {
    totalBefore: number;
    totalAfter: number;
    filtered: number;
    filterRate: string;
    filtersApplied: string[];
    timestamp: number;
  };
}

let _lastFilterResult: FilterStats["lastFilterResult"] | undefined;

/**
 * Record filter result for statistics
 */
export function recordFilterResult(result: FilterResult): void {
  const filtered = result.totalBefore - result.totalAfter;
  _lastFilterResult = {
    totalBefore: result.totalBefore,
    totalAfter: result.totalAfter,
    filtered,
    filterRate: result.totalBefore > 0 
      ? `${((filtered / result.totalBefore) * 100).toFixed(1)}%` 
      : "0%",
    filtersApplied: result.filtersApplied,
    timestamp: Date.now(),
  };
}

/**
 * Get filter statistics
 */
export function getFilterStats(): FilterStats {
  return {
    config: getFilterConfig(),
    lastFilterResult: _lastFilterResult,
  };
}
