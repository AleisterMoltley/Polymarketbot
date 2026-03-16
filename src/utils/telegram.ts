import axios from "axios";

// Telegram Bot API configuration
const TELEGRAM_API_URL = "https://api.telegram.org/bot";

interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
}

let config: TelegramConfig = {
  botToken: "",
  chatId: "",
  enabled: false,
};

/**
 * Initialize Telegram notifications.
 * Reads config from environment variables.
 */
export function initTelegram(): void {
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const chatId = process.env.TELEGRAM_CHAT_ID ?? "";

  config = {
    botToken,
    chatId,
    enabled: Boolean(botToken && chatId),
  };

  if (config.enabled) {
    console.log("[telegram] Notifications enabled");
  } else {
    console.log("[telegram] Notifications disabled (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)");
  }
}

/**
 * Check if Telegram notifications are enabled.
 */
export function isEnabled(): boolean {
  return config.enabled;
}

/**
 * Send a message via Telegram.
 * 
 * @param message - The message text (supports Markdown)
 * @param options - Additional options (parse_mode, disable_notification)
 */
export async function sendMessage(
  message: string,
  options: { parseMode?: "Markdown" | "HTML"; silent?: boolean } = {}
): Promise<void> {
  if (!config.enabled) {
    return;
  }

  try {
    await axios.post(
      `${TELEGRAM_API_URL}${config.botToken}/sendMessage`,
      {
        chat_id: config.chatId,
        text: message,
        parse_mode: options.parseMode ?? "Markdown",
        disable_notification: options.silent ?? false,
      },
      { timeout: 5000 }
    );
  } catch (err) {
    console.error("[telegram] Failed to send message:", (err as Error).message);
  }
}

// ── Alert Types ────────────────────────────────────────────────────────────

export type AlertLevel = "info" | "warning" | "success" | "error";

const EMOJI_MAP: Record<AlertLevel, string> = {
  info: "ℹ️",
  warning: "⚠️",
  success: "✅",
  error: "❌",
};

/**
 * Send a formatted alert with emoji and level indicator.
 */
export async function sendAlert(
  title: string,
  details: string,
  level: AlertLevel = "info"
): Promise<void> {
  const emoji = EMOJI_MAP[level];
  const message = `${emoji} *${title}*\n\n${details}`;
  await sendMessage(message);
}

// ── Trade Alerts ───────────────────────────────────────────────────────────

export interface TradeAlertData {
  market: string;
  side: "BUY" | "SELL";
  outcome: string;
  price: number;
  size: number;
  paper: boolean;
  strategy?: string;
}

/**
 * Send a trade execution alert.
 */
export async function alertTrade(trade: TradeAlertData): Promise<void> {
  const mode = trade.paper ? "📝 PAPER" : "💰 LIVE";
  const strategy = trade.strategy ? ` (${trade.strategy})` : "";
  
  const message = `
${mode} *Trade Executed*${strategy}

*Market:* \`${trade.market.slice(0, 12)}...\`
*Side:* ${trade.side}
*Outcome:* ${trade.outcome}
*Price:* ${trade.price.toFixed(4)}
*Size:* $${trade.size.toFixed(2)} USDC
`;

  await sendMessage(message.trim());
}

// ── Whale Alerts ───────────────────────────────────────────────────────────

export interface WhaleAlertData {
  address: string;
  market: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
}

/**
 * Send a whale activity alert.
 */
export async function alertWhale(whale: WhaleAlertData): Promise<void> {
  const emoji = whale.side === "BUY" ? "🟢" : "🔴";
  
  const message = `
🐋 *Whale Alert*

${emoji} *${whale.side}* detected

*Wallet:* \`${whale.address.slice(0, 10)}...\`
*Market:* \`${whale.market.slice(0, 12)}...\`
*Size:* $${whale.size.toLocaleString()} USDC
*Price:* ${whale.price.toFixed(4)}
`;

  await sendMessage(message.trim());
}

// ── Arbitrage Alerts ───────────────────────────────────────────────────────

export interface ArbitrageAlertData {
  markets: string[];
  spread: number;
  expectedProfit: number;
  executed: boolean;
}

/**
 * Send an arbitrage opportunity alert.
 */
export async function alertArbitrage(arb: ArbitrageAlertData): Promise<void> {
  const status = arb.executed ? "✅ Executed" : "👀 Detected";
  
  const message = `
📊 *Arbitrage ${status}*

*Spread:* ${(arb.spread * 100).toFixed(2)}%
*Expected Profit:* $${arb.expectedProfit.toFixed(2)}
*Markets:* ${arb.markets.length}
`;

  await sendMessage(message.trim());
}

// ── System Alerts ──────────────────────────────────────────────────────────

/**
 * Send a bot startup notification.
 */
export async function alertStartup(mode: string): Promise<void> {
  const message = `
🚀 *Bot Started*

*Mode:* ${mode}
*Time:* ${new Date().toISOString()}
`;

  await sendMessage(message.trim());
}

/**
 * Send a bot shutdown notification.
 */
export async function alertShutdown(reason: string): Promise<void> {
  const message = `
🛑 *Bot Stopped*

*Reason:* ${reason}
*Time:* ${new Date().toISOString()}
`;

  await sendMessage(message.trim());
}

/**
 * Send an error alert.
 */
export async function alertError(error: string, context?: string): Promise<void> {
  const message = `
❌ *Error*

*Message:* ${error}
${context ? `*Context:* ${context}` : ""}
*Time:* ${new Date().toISOString()}
`;

  await sendMessage(message.trim());
}

/**
 * Send a daily summary.
 */
export async function alertDailySummary(stats: {
  totalTrades: number;
  pnl: number;
  winRate: number;
  bestStrategy: string;
}): Promise<void> {
  const pnlEmoji = stats.pnl >= 0 ? "📈" : "📉";
  
  const message = `
📊 *Daily Summary*

*Total Trades:* ${stats.totalTrades}
${pnlEmoji} *PnL:* $${stats.pnl.toFixed(2)}
*Win Rate:* ${(stats.winRate * 100).toFixed(1)}%
*Best Strategy:* ${stats.bestStrategy}
`;

  await sendMessage(message.trim());
}
