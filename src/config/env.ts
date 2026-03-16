/**
 * Centralized Environment Configuration
 *
 * This module provides a single source of truth for all environment variables
 * used throughout the application. It handles:
 * - Type-safe parsing of environment variables
 * - Default values
 * - Validation with helpful error messages
 * - Documentation of all configuration options
 *
 * All modules should import config from here instead of reading process.env directly.
 */

// ── Type Definitions ───────────────────────────────────────────────────────

export interface PolymarketApiConfig {
  /** Base URL for the Polymarket CLOB API */
  clobApiUrl: string;
  /** WebSocket URL for real-time price streaming */
  clobWsUrl: string;
  /** API key for authenticated requests */
  clobApiKey: string;
  /** API secret for authenticated requests */
  clobApiSecret: string;
  /** API passphrase for authenticated requests */
  clobApiPassphrase: string;
}

export interface WalletConfig {
  /** Private key for the trading wallet (hex string) */
  privateKey: string;
  /** Polygon RPC URL for on-chain interactions */
  polygonRpcUrl: string;
  /** Chain ID (137 = Polygon mainnet, 80002 = Amoy testnet) */
  chainId: number;
}

export interface TradingConfig {
  /** Trading mode: "paper" (simulated) or "live" (real money) */
  tradingMode: "paper" | "live";
  /** Maximum position size per trade in USDC */
  maxPositionSizeUsdc: number;
  /** Minimum edge threshold to trigger a trade (e.g., 0.05 = 5%) */
  minEdge: number;
  /** Enable liquidity-weighted edge calculation */
  enableLiquidityWeightedEdge: boolean;
  /** Reference liquidity for normalization in USDC (markets with this liquidity have weight 1.0) */
  liquidityReferenceUsdc: number;
  /** Trading loop interval in milliseconds (default: 300000 = 5 min) */
  pollIntervalMs: number;
  /** Enable speed trading on startup */
  enableSpeedTrading: boolean;
  /** Minimum USDC balance required to trade */
  minBalanceUsdc: number;
  /** Minimum price lag threshold for speed trading (e.g., 0.02 = 2%) */
  lagThreshold: number;
  /** Maximum spread to accept (e.g., 0.05 = 5%) */
  maxSpread: number;
  /** Minimum milliseconds between trades per market */
  throttleMs: number;
  /** Number of price samples to track for lag detection */
  priceHistorySize: number;
  /** Time window for last-second trading (ms before 5-min close) */
  lastSecondWindowMs: number;
  /** Market close detection window (ms before anticipated close) */
  closeDetectionWindowMs: number;
  /** Delay before restarting trading loop after failure (ms) */
  tradingLoopRestartDelayMs: number;
}

export interface MarketConfig {
  /** 5-Minute market condition ID */
  market5minConditionId: string;
  /** 5-Minute market YES token ID */
  market5minYesToken: string;
  /** 5-Minute market NO token ID */
  market5minNoToken: string;
}

export interface MarketFilterConfig {
  /** Enable/disable market filtering */
  filtersEnabled: boolean;
  /** Maximum time until resolution in ms (default: 300000 = 5 min). Set to 0 to disable. */
  maxResolutionTimeMs: number;
  /** Minimum liquidity in USDC (0 = no filter) */
  minLiquidity: number;
  /** Minimum 24h trading volume in USDC (0 = no filter) */
  minVolume: number;
  /** Allowed categories (comma-separated, empty = all) */
  filterCategories: string[];
  /** Excluded categories (comma-separated) */
  excludeCategories: string[];
  /** Number of markets to fetch per page (max: 1000) */
  marketPageSize: number;
}

export interface ServerConfig {
  /** HTTP server port */
  port: number;
  /** Admin API secret for authentication */
  adminSecret: string;
  /** WebSocket stats broadcast interval in milliseconds */
  statsBroadcastIntervalMs: number;
  /** Data directory for persistent storage */
  dataDir: string;
}

export interface AppConfig {
  polymarket: PolymarketApiConfig;
  wallet: WalletConfig;
  trading: TradingConfig;
  markets: MarketConfig;
  marketFilters: MarketFilterConfig;
  server: ServerConfig;
}

// ── Helper Functions ───────────────────────────────────────────────────────

/**
 * Parse a string environment variable with a default value.
 */
function parseEnvString(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

/**
 * Parse a required string environment variable.
 * Returns empty string if not set (for optional secrets).
 */
function parseOptionalString(name: string): string {
  return process.env[name] ?? "";
}

/**
 * Parse an integer environment variable with a default value.
 */
function parseEnvInt(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    console.warn(`[config] Invalid integer for ${name}: "${value}", using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * Parse a float environment variable with a default value.
 */
function parseEnvFloat(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    console.warn(`[config] Invalid float for ${name}: "${value}", using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * Parse a boolean environment variable with a default value.
 */
function parseBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  return value.toLowerCase() === "true" || value === "1";
}

/**
 * Parse a comma-separated list into an array of trimmed strings.
 */
function parseStringArray(name: string): string[] {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    return [];
  }
  return value.split(",").map(s => s.trim()).filter(Boolean);
}

// ── Configuration Loading ──────────────────────────────────────────────────

/**
 * Load and validate all environment configuration.
 * This function is called once at startup and caches the result.
 */
function loadConfig(): AppConfig {
  return {
    polymarket: {
      clobApiUrl: parseEnvString("CLOB_API_URL", "https://clob.polymarket.com"),
      clobWsUrl: parseEnvString("CLOB_WS_URL", "wss://clob.polymarket.com/ws"),
      clobApiKey: parseOptionalString("CLOB_API_KEY"),
      clobApiSecret: parseOptionalString("CLOB_API_SECRET"),
      clobApiPassphrase: parseOptionalString("CLOB_API_PASSPHRASE"),
    },
    wallet: {
      privateKey: parseOptionalString("PRIVATE_KEY"),
      polygonRpcUrl: parseEnvString("POLYGON_RPC_URL", ""),
      chainId: parseEnvInt("CHAIN_ID", 137),
    },
    trading: {
      tradingMode: process.env.TRADING_MODE === "live" ? "live" : "paper",
      maxPositionSizeUsdc: parseEnvFloat("MAX_POSITION_SIZE_USDC", 100),
      minEdge: parseEnvFloat("MIN_EDGE", 0.05),
      enableLiquidityWeightedEdge: parseBoolean("ENABLE_LIQUIDITY_WEIGHTED_EDGE", false),
      liquidityReferenceUsdc: parseEnvFloat("LIQUIDITY_REFERENCE_USDC", 10000),
      pollIntervalMs: parseEnvInt("POLL_INTERVAL_MS", 300000),
      enableSpeedTrading: parseBoolean("ENABLE_SPEED_TRADING", false),
      minBalanceUsdc: parseEnvFloat("MIN_BALANCE_USDC", 10),
      lagThreshold: parseEnvFloat("LAG_THRESHOLD", 0.02),
      maxSpread: parseEnvFloat("MAX_SPREAD", 0.05),
      throttleMs: parseEnvInt("THROTTLE_MS", 5000),
      priceHistorySize: parseEnvInt("PRICE_HISTORY_SIZE", 20),
      lastSecondWindowMs: parseEnvInt("LAST_SECOND_WINDOW_MS", 10000),
      closeDetectionWindowMs: parseEnvInt("CLOSE_DETECTION_WINDOW_MS", 60000),
      tradingLoopRestartDelayMs: parseEnvInt("TRADING_LOOP_RESTART_DELAY_MS", 30000),
    },
    markets: {
      market5minConditionId: parseEnvString("MARKET_5MIN_CONDITION_ID", "market-5min"),
      market5minYesToken: parseEnvString("MARKET_5MIN_YES_TOKEN", "market-5min-yes"),
      market5minNoToken: parseEnvString("MARKET_5MIN_NO_TOKEN", "market-5min-no"),
    },
    marketFilters: {
      filtersEnabled: process.env.MARKET_FILTERS_ENABLED !== "false",
      maxResolutionTimeMs: parseEnvInt("MAX_RESOLUTION_TIME_MS", 300000), // Default: 5 minutes
      minLiquidity: parseEnvFloat("MIN_LIQUIDITY", 0),
      minVolume: parseEnvFloat("MIN_VOLUME", 0),
      filterCategories: parseStringArray("FILTER_CATEGORIES"),
      excludeCategories: parseStringArray("EXCLUDE_CATEGORIES"),
      marketPageSize: parseEnvInt("MARKET_PAGE_SIZE", 100),
    },
    server: {
      port: parseEnvInt("PORT", 3000),
      adminSecret: parseEnvString("ADMIN_SECRET", ""),
      statsBroadcastIntervalMs: parseEnvInt("STATS_BROADCAST_INTERVAL_MS", 10000),
      dataDir: parseEnvString("DATA_DIR", "./data"),
    },
  };
}

// ── Cached Configuration ───────────────────────────────────────────────────

let _config: AppConfig | null = null;

/**
 * Get the application configuration.
 * Configuration is loaded once and cached for subsequent calls.
 */
export function getConfig(): AppConfig {
  if (_config === null) {
    _config = loadConfig();
  }
  return _config;
}

/**
 * Reload the configuration from environment variables.
 * Useful for testing or if env vars change at runtime.
 */
export function reloadConfig(): AppConfig {
  _config = loadConfig();
  return _config;
}

// ── Validation Functions ───────────────────────────────────────────────────

/**
 * Validate that required configuration for live trading is present.
 * Returns an array of missing/invalid config items.
 */
export function validateLiveTradingConfig(): string[] {
  const config = getConfig();
  const errors: string[] = [];

  // Wallet config is required for live trading
  if (!config.wallet.privateKey) {
    errors.push("PRIVATE_KEY is required for live trading");
  } else if (!/^(0x)?[0-9a-fA-F]{64}$/.test(config.wallet.privateKey)) {
    errors.push("PRIVATE_KEY must be a valid 64-character hexadecimal string");
  }

  // API credentials are required for live trading
  if (!config.polymarket.clobApiKey) {
    errors.push("CLOB_API_KEY is required for live trading");
  }
  if (!config.polymarket.clobApiSecret) {
    errors.push("CLOB_API_SECRET is required for live trading");
  }
  if (!config.polymarket.clobApiPassphrase) {
    errors.push("CLOB_API_PASSPHRASE is required for live trading");
  }

  return errors;
}

/**
 * Check if the current configuration is valid for live trading.
 */
export function isLiveTradingConfigValid(): boolean {
  return validateLiveTradingConfig().length === 0;
}

/**
 * Log the current configuration (with sensitive values masked).
 */
export function logConfig(): void {
  const config = getConfig();
  
  console.log("[config] ── Application Configuration ──────────────────────────────");
  console.log("[config] Polymarket API:");
  console.log(`[config]   CLOB API URL: ${config.polymarket.clobApiUrl}`);
  console.log(`[config]   CLOB WS URL: ${config.polymarket.clobWsUrl}`);
  console.log(`[config]   API Key: ${config.polymarket.clobApiKey ? "****" + config.polymarket.clobApiKey.slice(-4) : "(not set)"}`);
  
  console.log("[config] Wallet:");
  console.log(`[config]   Private Key: ${config.wallet.privateKey ? "****" : "(not set)"}`);
  console.log(`[config]   Polygon RPC: ${config.wallet.polygonRpcUrl || "(not set)"}`);
  console.log(`[config]   Chain ID: ${config.wallet.chainId}`);
  
  console.log("[config] Trading:");
  console.log(`[config]   Mode: ${config.trading.tradingMode}`);
  console.log(`[config]   Max Position Size: ${config.trading.maxPositionSizeUsdc} USDC`);
  console.log(`[config]   Min Edge: ${(config.trading.minEdge * 100).toFixed(1)}%`);
  console.log(`[config]   Poll Interval: ${config.trading.pollIntervalMs}ms`);
  console.log(`[config]   Speed Trading: ${config.trading.enableSpeedTrading ? "enabled" : "disabled"}`);
  
  console.log("[config] Server:");
  console.log(`[config]   Port: ${config.server.port}`);
  console.log(`[config]   Admin Secret: ${config.server.adminSecret ? "(set)" : "(not set)"}`);
  console.log(`[config]   Data Dir: ${config.server.dataDir}`);
  
  console.log("[config] ──────────────────────────────────────────────────────────");
}

// ── Convenience Exports ────────────────────────────────────────────────────

// Export commonly used config values for easy access
export const config = {
  get polymarket() { return getConfig().polymarket; },
  get wallet() { return getConfig().wallet; },
  get trading() { return getConfig().trading; },
  get markets() { return getConfig().markets; },
  get marketFilters() { return getConfig().marketFilters; },
  get server() { return getConfig().server; },
};
