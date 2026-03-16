import axios from "axios";
import { getItem, setItem } from "../utils/jsonStore";
import { alertWhale, alertTrade, type WhaleAlertData, type TradeAlertData } from "../utils/telegram";

// ── Types ──────────────────────────────────────────────────────────────────

export interface WhaleWallet {
  address: string;
  label?: string;
  profitRate: number; // Historical win rate 0-1
  totalVolume: number; // Total USDC traded
  lastActivity: number; // Timestamp
  enabled: boolean;
}

export interface WhaleTransaction {
  id: string;
  whale: string;
  market: string;
  side: "BUY" | "SELL";
  outcome: string;
  price: number;
  size: number;
  timestamp: number;
  copied: boolean;
}

export interface CopyTradeConfig {
  enabled: boolean;
  maxCopySize: number; // Max USDC per copy trade
  copyRatio: number; // Fraction of whale's trade to copy (0-1)
  minWhaleSize: number; // Minimum whale trade size to trigger copy
  delayMs: number; // Delay before copying (avoid front-running detection)
  onlyProfitableWhales: boolean; // Only copy whales with >50% win rate
}

// ── Constants ──────────────────────────────────────────────────────────────

const WHALES_KEY = "whaleWallets";
const TRANSACTIONS_KEY = "whaleTransactions";
const COPY_CONFIG_KEY = "whaleCopyConfig";

// Known profitable Polymarket whales (example addresses - replace with real ones)
const DEFAULT_WHALES: WhaleWallet[] = [
  {
    address: "0x0000000000000000000000000000000000000001", // Placeholder
    label: "Whale Alpha",
    profitRate: 0.65,
    totalVolume: 500000,
    lastActivity: Date.now(),
    enabled: true,
  },
];

// Polygonscan API for monitoring (requires API key for production)
const POLYGONSCAN_API = "https://api.polygonscan.com/api";

// ── State ──────────────────────────────────────────────────────────────────

let isMonitoring = false;
let monitorInterval: NodeJS.Timeout | null = null;

// ── Configuration ──────────────────────────────────────────────────────────

/**
 * Get the whale copy trading configuration.
 */
export function getCopyConfig(): CopyTradeConfig {
  return getItem<CopyTradeConfig>(COPY_CONFIG_KEY) ?? {
    enabled: process.env.WHALE_COPY_ENABLED === "true",
    maxCopySize: parseFloat(process.env.WHALE_COPY_MAX_SIZE ?? "50"),
    copyRatio: parseFloat(process.env.WHALE_COPY_RATIO ?? "0.1"),
    minWhaleSize: parseFloat(process.env.WHALE_MIN_SIZE ?? "1000"),
    delayMs: parseInt(process.env.WHALE_COPY_DELAY_MS ?? "2000", 10),
    onlyProfitableWhales: true,
  };
}

/**
 * Update the whale copy trading configuration.
 */
export function updateCopyConfig(config: Partial<CopyTradeConfig>): void {
  const current = getCopyConfig();
  setItem(COPY_CONFIG_KEY, { ...current, ...config }, true);
  console.log("[whaleCopy] Config updated:", { ...current, ...config });
}

// ── Whale Management ───────────────────────────────────────────────────────

/**
 * Get all tracked whale wallets.
 */
export function getWhales(): WhaleWallet[] {
  const stored = getItem<WhaleWallet[]>(WHALES_KEY);
  return stored ?? DEFAULT_WHALES;
}

/**
 * Add a whale wallet to track.
 */
export function addWhale(wallet: WhaleWallet): void {
  const whales = getWhales();
  const existing = whales.findIndex((w) => w.address.toLowerCase() === wallet.address.toLowerCase());
  
  if (existing !== -1) {
    whales[existing] = wallet;
  } else {
    whales.push(wallet);
  }
  
  setItem(WHALES_KEY, whales, true);
  console.log(`[whaleCopy] Added whale: ${wallet.address} (${wallet.label ?? "unlabeled"})`);
}

/**
 * Remove a whale wallet from tracking.
 */
export function removeWhale(address: string): void {
  const whales = getWhales().filter((w) => w.address.toLowerCase() !== address.toLowerCase());
  setItem(WHALES_KEY, whales, true);
  console.log(`[whaleCopy] Removed whale: ${address}`);
}

/**
 * Enable or disable tracking for a whale.
 */
export function setWhaleEnabled(address: string, enabled: boolean): void {
  const whales = getWhales();
  const whale = whales.find((w) => w.address.toLowerCase() === address.toLowerCase());
  
  if (whale) {
    whale.enabled = enabled;
    setItem(WHALES_KEY, whales, true);
    console.log(`[whaleCopy] Whale ${address} ${enabled ? "enabled" : "disabled"}`);
  }
}

// ── Transaction Tracking ───────────────────────────────────────────────────

/**
 * Get recent whale transactions.
 */
export function getTransactions(limit = 100): WhaleTransaction[] {
  const txs = getItem<WhaleTransaction[]>(TRANSACTIONS_KEY) ?? [];
  return txs.slice(-limit);
}

/**
 * Record a whale transaction.
 */
function recordTransaction(tx: WhaleTransaction): void {
  const txs = getItem<WhaleTransaction[]>(TRANSACTIONS_KEY) ?? [];
  txs.push(tx);
  
  // Keep only last 500 transactions
  if (txs.length > 500) {
    txs.splice(0, txs.length - 500);
  }
  
  setItem(TRANSACTIONS_KEY, txs, true);
}

/**
 * Mark a transaction as copied.
 */
function markTransactionCopied(id: string): void {
  const txs = getItem<WhaleTransaction[]>(TRANSACTIONS_KEY) ?? [];
  const tx = txs.find((t) => t.id === id);
  
  if (tx) {
    tx.copied = true;
    setItem(TRANSACTIONS_KEY, txs, true);
  }
}

// ── Whale Detection ────────────────────────────────────────────────────────

/**
 * Check if an address is a tracked whale.
 */
export function isWhale(address: string): WhaleWallet | undefined {
  return getWhales().find(
    (w) => w.address.toLowerCase() === address.toLowerCase() && w.enabled
  );
}

/**
 * Analyze a transaction to detect whale activity.
 * In production, this would monitor Polymarket's CLOB contract events.
 */
export function analyzeTransaction(
  from: string,
  market: string,
  side: "BUY" | "SELL",
  outcome: string,
  price: number,
  size: number
): WhaleTransaction | null {
  const config = getCopyConfig();
  
  // Check if it's a whale trade
  const whale = isWhale(from);
  if (!whale) return null;

  // Check minimum size threshold
  if (size < config.minWhaleSize) return null;

  // Check profitability requirement
  if (config.onlyProfitableWhales && whale.profitRate < 0.5) {
    console.log(`[whaleCopy] Skipping unprofitable whale: ${from} (${(whale.profitRate * 100).toFixed(1)}% win rate)`);
    return null;
  }

  const tx: WhaleTransaction = {
    id: `whale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    whale: from,
    market,
    side,
    outcome,
    price,
    size,
    timestamp: Date.now(),
    copied: false,
  };

  console.log(
    `[whaleCopy] Whale activity detected: ${whale.label ?? from.slice(0, 10)} ` +
    `${side} $${size} on ${market.slice(0, 12)}...`
  );

  recordTransaction(tx);

  // Send alert
  const alertData: WhaleAlertData = {
    address: from,
    market,
    side,
    size,
    price,
  };
  alertWhale(alertData).catch(console.error);

  return tx;
}

// ── Copy Trading Logic ─────────────────────────────────────────────────────

/**
 * Calculate the copy trade size based on configuration.
 */
export function calculateCopySize(whaleSize: number): number {
  const config = getCopyConfig();
  const copySize = whaleSize * config.copyRatio;
  return Math.min(copySize, config.maxCopySize);
}

/**
 * Execute a copy trade based on whale activity.
 */
export async function executeCopyTrade(
  tx: WhaleTransaction,
  placeTrade: (market: string, side: "BUY" | "SELL", outcome: string, price: number, size: number) => Promise<void>
): Promise<boolean> {
  const config = getCopyConfig();
  
  if (!config.enabled) {
    console.log("[whaleCopy] Copy trading disabled");
    return false;
  }

  if (tx.copied) {
    console.log(`[whaleCopy] Transaction ${tx.id} already copied`);
    return false;
  }

  const copySize = calculateCopySize(tx.size);
  
  if (copySize < 1) {
    console.log(`[whaleCopy] Copy size too small: $${copySize.toFixed(2)}`);
    return false;
  }

  console.log(
    `[whaleCopy] Copying trade: ${tx.side} $${copySize.toFixed(2)} ` +
    `(${(config.copyRatio * 100).toFixed(0)}% of $${tx.size})`
  );

  // Add delay to avoid front-running detection
  await new Promise((resolve) => setTimeout(resolve, config.delayMs));

  try {
    await placeTrade(tx.market, tx.side, tx.outcome, tx.price, copySize);
    markTransactionCopied(tx.id);

    // Send trade alert
    const alertData: TradeAlertData = {
      market: tx.market,
      side: tx.side,
      outcome: tx.outcome,
      price: tx.price,
      size: copySize,
      paper: process.env.PAPER_TRADE === "true",
      strategy: "Whale Copy",
    };
    alertTrade(alertData).catch(console.error);

    console.log(`[whaleCopy] Copy trade executed successfully`);
    return true;
  } catch (err) {
    console.error(`[whaleCopy] Copy trade failed:`, err);
    return false;
  }
}

// ── Monitoring ─────────────────────────────────────────────────────────────

/**
 * Fetch recent transactions for tracked whales.
 * In production, this would use Polygonscan API or direct contract event monitoring.
 */
async function fetchWhaleActivity(): Promise<void> {
  const whales = getWhales().filter((w) => w.enabled);
  
  if (whales.length === 0) {
    console.log("[whaleCopy] No active whales to monitor");
    return;
  }

  // In production, you would:
  // 1. Use Polygonscan API to fetch recent transactions for whale addresses
  // 2. Filter for Polymarket CLOB contract interactions
  // 3. Parse transaction data to extract trade details
  
  // For now, we'll simulate the monitoring process
  console.log(`[whaleCopy] Monitoring ${whales.length} whales...`);
  
  // This is where you would integrate with:
  // - Polygonscan API: https://api.polygonscan.com/api
  // - The Graph subgraph for Polymarket
  // - Direct WebSocket connection to Polygon node
  
  // Example API call structure (requires POLYGONSCAN_API_KEY):
  /*
  for (const whale of whales) {
    try {
      const response = await axios.get(POLYGONSCAN_API, {
        params: {
          module: "account",
          action: "tokentx",
          address: whale.address,
          startblock: "latest",
          endblock: "latest",
          sort: "desc",
          apikey: process.env.POLYGONSCAN_API_KEY,
        },
        timeout: 10000,
      });
      
      // Process transactions...
    } catch (err) {
      console.error(`[whaleCopy] Failed to fetch activity for ${whale.address}:`, err);
    }
  }
  */
}

/**
 * Start whale monitoring.
 */
export function startWhaleMonitoring(intervalMs = 30000): void {
  if (isMonitoring) return;
  isMonitoring = true;

  console.log(`[whaleCopy] Starting whale monitoring (interval=${intervalMs}ms)`);

  const monitor = async () => {
    if (!isMonitoring) return;
    try {
      await fetchWhaleActivity();
    } catch (err) {
      console.error("[whaleCopy] Monitoring error:", err);
    }
  };

  monitor();
  monitorInterval = setInterval(monitor, intervalMs);
}

/**
 * Stop whale monitoring.
 */
export function stopWhaleMonitoring(): void {
  if (!isMonitoring) return;
  isMonitoring = false;

  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }

  console.log("[whaleCopy] Monitoring stopped");
}

/**
 * Check if whale monitoring is active.
 */
export function isWhaleMonitoringActive(): boolean {
  return isMonitoring;
}

// ── Statistics ─────────────────────────────────────────────────────────────

/**
 * Get whale copy trading statistics.
 */
export function getWhaleStats(): {
  totalWhales: number;
  activeWhales: number;
  totalTransactions: number;
  copiedTransactions: number;
  copyRate: number;
} {
  const whales = getWhales();
  const txs = getTransactions(1000);
  const copied = txs.filter((t) => t.copied);

  return {
    totalWhales: whales.length,
    activeWhales: whales.filter((w) => w.enabled).length,
    totalTransactions: txs.length,
    copiedTransactions: copied.length,
    copyRate: txs.length > 0 ? copied.length / txs.length : 0,
  };
}
