import axios from "axios";
import { getWallet } from "../utils/wallet";
import { recordTrade } from "../admin/stats";
import type { TradeRecord } from "../admin/stats";

let _tradeIdCounter = 0;
function newId(): string {
  return `trade-${Date.now()}-${++_tradeIdCounter}`;
}

export interface Market {
  conditionId: string;
  question: string;
  outcomes: string[];
  prices: number[];
}

/** Fetch a list of active markets from the Polymarket CLOB API. */
export async function fetchMarkets(): Promise<Market[]> {
  const baseUrl = process.env.CLOB_API_URL ?? "https://clob.polymarket.com";
  try {
    const { data } = await axios.get<{ data: Market[] }>(`${baseUrl}/markets`, {
      params: { active: true, closed: false },
      timeout: 10_000,
    });
    return data.data ?? [];
  } catch (err) {
    console.error("[trading] fetchMarkets error:", err);
    return [];
  }
}

/**
 * Evaluate a market and return a trade signal if edge exceeds MIN_EDGE.
 * In paper-trade mode no real order is sent.
 */
export async function evaluateAndTrade(market: Market): Promise<void> {
  const minEdge = parseFloat(process.env.MIN_EDGE ?? "0.05");
  const maxSize = parseFloat(process.env.MAX_POSITION_SIZE_USDC ?? "100");
  const isPaper = process.env.PAPER_TRADE === "true";

  for (let i = 0; i < market.outcomes.length; i++) {
    const price = market.prices[i];
    if (price === undefined) continue;

    // Simple edge model: buy if implied probability is below (1 - MIN_EDGE)
    const edge = 1 - price - minEdge;
    if (edge <= 0) continue;

    // Round to 2 decimal places (cents) for USDC sizing
    const CENTS = 100;
    const size = Math.min(maxSize, Math.round(edge * maxSize * CENTS) / CENTS);

    const trade: TradeRecord = {
      id: newId(),
      market: market.conditionId,
      side: "BUY",
      outcome: market.outcomes[i],
      price,
      size,
      timestamp: Date.now(),
      paper: isPaper,
      status: "OPEN",
    };

    if (!isPaper) {
      try {
        await submitOrder(trade);
        trade.status = "FILLED";
      } catch (err) {
        console.error("[trading] submitOrder error:", err);
        trade.status = "CANCELLED";
      }
    } else {
      console.log(`[paper-trade] BUY ${size} USDC of "${market.outcomes[i]}" @ ${price}`);
      trade.status = "FILLED";
      trade.pnl = 0;
    }

    recordTrade(trade);
  }
}

/**
 * Submit a real order to the Polymarket CLOB API.
 * Requires CLOB_API_KEY, CLOB_API_SECRET, CLOB_API_PASSPHRASE.
 */
async function submitOrder(trade: TradeRecord): Promise<void> {
  const baseUrl = process.env.CLOB_API_URL ?? "https://clob.polymarket.com";
  const wallet = getWallet();
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const headers = {
    "POLY_ADDRESS": wallet.address,
    "POLY_SIGNATURE": await wallet.signMessage(timestamp),
    "POLY_TIMESTAMP": timestamp,
    "POLY_API_KEY": process.env.CLOB_API_KEY ?? "",
    "POLY_API_SECRET": process.env.CLOB_API_SECRET ?? "",
    "POLY_PASSPHRASE": process.env.CLOB_API_PASSPHRASE ?? "",
  };

  await axios.post(
    `${baseUrl}/order`,
    {
      market: trade.market,
      side: trade.side,
      price: trade.price,
      size: trade.size,
      outcome: trade.outcome,
    },
    { headers, timeout: 10_000 }
  );
}

/** Main trading loop — polls markets and evaluates trade signals. */
export async function runTradingLoop(): Promise<void> {
  const interval = parseInt(process.env.POLL_INTERVAL_MS ?? "30000", 10);
  console.log(`[trading] Starting loop (interval=${interval}ms, paper=${process.env.PAPER_TRADE})`);

  const tick = async () => {
    const markets = await fetchMarkets();
    console.log(`[trading] Evaluating ${markets.length} markets…`);
    for (const market of markets) {
      await evaluateAndTrade(market);
    }
  };

  await tick();
  setInterval(tick, interval);
}
