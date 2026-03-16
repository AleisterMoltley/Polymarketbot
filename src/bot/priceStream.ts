import WebSocket from "ws";
import { config } from "../config/env";
import { setItem, getItem } from "../utils/jsonStore";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PriceData {
  marketId: string;
  midPrice: number;
  bestBid?: number;
  bestAsk?: number;
  timestamp: number;
}

interface SubscribeMessage {
  action: "subscribe";
  markets: string[];
}

interface UnsubscribeMessage {
  action: "unsubscribe";
  markets: string[];
}

type OutgoingMessage = SubscribeMessage | UnsubscribeMessage;

// ── Constants ──────────────────────────────────────────────────────────────

const WS_URL = config.polymarket.clobWsUrl;
const RECONNECT_DELAY_MS = 5000;
const PRICES_KEY = "realtimePrices";
const PERSIST_TO_DISK = false; // Don't persist price updates to disk on every update

// ── State ──────────────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let subscribedMarkets: Set<string> = new Set();
let isConnecting = false;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let priceListeners: Array<(data: PriceData) => void> = [];

// ── In-memory price store ──────────────────────────────────────────────────

/** Get the current price for a market from the in-memory store. */
export function getPrice(marketId: string): PriceData | undefined {
  const prices = getItem<Record<string, PriceData>>(PRICES_KEY) ?? {};
  return prices[marketId];
}

/** Get all current prices from the in-memory store. */
export function getAllPrices(): Record<string, PriceData> {
  return getItem<Record<string, PriceData>>(PRICES_KEY) ?? {};
}

/** Store a price update in the in-memory store. */
function storePrice(data: PriceData): void {
  const prices = getItem<Record<string, PriceData>>(PRICES_KEY) ?? {};
  prices[data.marketId] = data;
  setItem(PRICES_KEY, prices, PERSIST_TO_DISK);
}

// ── Listener management ────────────────────────────────────────────────────

/** Register a callback to receive price updates. */
export function onPriceUpdate(listener: (data: PriceData) => void): () => void {
  priceListeners.push(listener);
  return () => {
    priceListeners = priceListeners.filter((l) => l !== listener);
  };
}

/** Notify all registered listeners of a price update. */
function notifyListeners(data: PriceData): void {
  for (const listener of priceListeners) {
    try {
      listener(data);
    } catch (err) {
      console.error("[priceStream] Listener error:", err);
    }
  }
}

// ── WebSocket connection ───────────────────────────────────────────────────

/** Connect to the Polymarket CLOB WebSocket. */
export function connect(): void {
  if (ws !== null || isConnecting) {
    return;
  }

  isConnecting = true;
  console.log(`[priceStream] Connecting to ${WS_URL}...`);

  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    isConnecting = false;
    console.log("[priceStream] Connected to Polymarket WebSocket");

    // Re-subscribe to any markets we were tracking before disconnect
    if (subscribedMarkets.size > 0) {
      const markets = Array.from(subscribedMarkets);
      console.log(`[priceStream] Re-subscribing to ${markets.length} markets`);
      sendMessage({ action: "subscribe", markets });
    }
  });

  ws.on("message", (raw: WebSocket.RawData) => {
    try {
      const data = JSON.parse(raw.toString());
      handleMessage(data);
    } catch (err) {
      console.error("[priceStream] Failed to parse message:", err);
    }
  });

  ws.on("error", (err: Error) => {
    console.error("[priceStream] WebSocket error:", err.message);
  });

  ws.on("close", (code: number, reason: Buffer) => {
    console.log(`[priceStream] Disconnected (code=${code}, reason=${reason.toString()})`);
    ws = null;
    isConnecting = false;
    scheduleReconnect();
  });
}

/** Disconnect from the WebSocket server. */
export function disconnect(): void {
  if (reconnectTimeout !== null) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (ws !== null) {
    ws.close();
    ws = null;
  }

  isConnecting = false;
  console.log("[priceStream] Disconnected");
}

/** Schedule a reconnection attempt. */
function scheduleReconnect(): void {
  if (reconnectTimeout !== null) {
    return;
  }

  console.log(`[priceStream] Reconnecting in ${RECONNECT_DELAY_MS}ms...`);
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

/** Send a message to the WebSocket server. */
function sendMessage(message: OutgoingMessage): void {
  if (ws === null || ws.readyState !== WebSocket.OPEN) {
    console.warn("[priceStream] Cannot send message: not connected");
    return;
  }

  ws.send(JSON.stringify(message));
}

/** 
 * Handle incoming WebSocket messages.
 * Expected price message format from Polymarket CLOB WebSocket:
 * {
 *   market: string,      // Primary market identifier (condition ID)
 *   midPrice: number,    // Required: mid-market price
 *   bestBid?: number,    // Optional: best bid price
 *   bestAsk?: number,    // Optional: best ask price
 * }
 * Note: The API may use 'market', 'marketId', or 'conditionId' as the identifier field.
 */
function handleMessage(data: unknown): void {
  if (typeof data !== "object" || data === null) {
    return;
  }

  const msg = data as Record<string, unknown>;

  // Handle price update messages - require midPrice to be present and valid
  if ("midPrice" in msg && typeof msg.midPrice === "number") {
    // Extract market identifier - API may use different field names
    const marketId = (msg.market ?? msg.marketId ?? msg.conditionId) as string | undefined;
    if (!marketId || typeof marketId !== "string") {
      console.warn("[priceStream] Price message missing valid market identifier");
      return;
    }

    const priceData: PriceData = {
      marketId,
      midPrice: msg.midPrice,
      bestBid: typeof msg.bestBid === "number" ? msg.bestBid : undefined,
      bestAsk: typeof msg.bestAsk === "number" ? msg.bestAsk : undefined,
      timestamp: Date.now(),
    };

    console.log(`[priceStream] Price update: ${marketId} midPrice=${priceData.midPrice}`);
    storePrice(priceData);
    notifyListeners(priceData);
  }
}

// ── Subscription management ────────────────────────────────────────────────

/** Subscribe to real-time price updates for the given markets. */
export function subscribe(markets: string[]): void {
  const newMarkets = markets.filter((m) => !subscribedMarkets.has(m));

  if (newMarkets.length === 0) {
    return;
  }

  for (const market of newMarkets) {
    subscribedMarkets.add(market);
  }

  console.log(`[priceStream] Subscribing to ${newMarkets.length} markets`);
  sendMessage({ action: "subscribe", markets: newMarkets });
}

/** Unsubscribe from price updates for the given markets. */
export function unsubscribe(markets: string[]): void {
  const existingMarkets = markets.filter((m) => subscribedMarkets.has(m));

  if (existingMarkets.length === 0) {
    return;
  }

  for (const market of existingMarkets) {
    subscribedMarkets.delete(market);
  }

  console.log(`[priceStream] Unsubscribing from ${existingMarkets.length} markets`);
  sendMessage({ action: "unsubscribe", markets: existingMarkets });
}

/** Get the list of currently subscribed markets. */
export function getSubscribedMarkets(): string[] {
  return Array.from(subscribedMarkets);
}

/** Check if the WebSocket is currently connected. */
export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}
