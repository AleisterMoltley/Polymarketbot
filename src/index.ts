import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";

import { loadStore, saveStore } from "./utils/jsonStore";
import adminRouter from "./admin/tabs";
import { runTradingLoop, stopTradingLoop } from "./bot/trading";
import { getStats, flushStats } from "./admin/stats";
import { 
  startSpeedTrading, 
  stopSpeedTrading, 
  isSpeedTradingRunning, 
  getSpeedTradeState,
  getSpeedTradeHistory
} from "./bot/speedTrade";

// ── Bootstrap ──────────────────────────────────────────────────────────────

loadStore();

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const STATS_BROADCAST_INTERVAL = parseInt(process.env.STATS_BROADCAST_INTERVAL_MS ?? "10000", 10);
const SHUTDOWN_TIMEOUT_MS = 10000; // Force shutdown after 10 seconds

const app = express();
app.use(express.json());

// Request logging middleware
app.use((req, _res, next) => {
  console.log(`[http] ${req.method} ${req.path}`);
  next();
});

// Static assets (admin SPA / public pages)
app.use(express.static(path.join(__dirname, "..", "public")));

// Admin API tabs
app.use("/admin", adminRouter);

// Simple liveness probe
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Readiness probe (check if trading loop is running)
app.get("/ready", (_req, res) => {
  res.json({ 
    status: "ready", 
    timestamp: new Date().toISOString(),
    stats: getStats(),
    speedTrading: isSpeedTradingRunning()
  });
});

// Speed trading API endpoints
app.get("/api/speed-trade/status", (_req, res) => {
  res.json({
    running: isSpeedTradingRunning(),
    state: getSpeedTradeState(),
    history: getSpeedTradeHistory().slice(-50) // Last 50 trades
  });
});

app.post("/api/speed-trade/start", async (_req, res) => {
  try {
    await startSpeedTrading();
    res.json({ success: true, message: "Speed trading started" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

app.post("/api/speed-trade/stop", (_req, res) => {
  stopSpeedTrading();
  res.json({ success: true, message: "Speed trading stopped" });
});

// ── HTTP + WebSocket server ────────────────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws: WebSocket) => {
  console.log("[ws] Client connected");

  // Send current stats immediately on connection
  ws.send(JSON.stringify({ event: "stats", data: getStats() }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { command?: string };
      if (msg.command === "stats") {
        ws.send(JSON.stringify({ event: "stats", data: getStats() }));
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("close", () => console.log("[ws] Client disconnected"));
});

/** Broadcast a payload to all connected WebSocket clients. */
export function broadcast(event: string, data: unknown): void {
  const payload = JSON.stringify({ event, data });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Auto-broadcast stats to all connected clients
let statsBroadcastTimer: NodeJS.Timeout | null = null;

function startStatsBroadcast(): void {
  statsBroadcastTimer = setInterval(() => {
    broadcast("stats", getStats());
  }, STATS_BROADCAST_INTERVAL);
  console.log(`[ws] Stats broadcast started (interval=${STATS_BROADCAST_INTERVAL}ms)`);
}

function stopStatsBroadcast(): void {
  if (statsBroadcastTimer) {
    clearInterval(statsBroadcastTimer);
    statsBroadcastTimer = null;
  }
}

// ── Graceful shutdown ──────────────────────────────────────────────────────

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[server] Received ${signal}, starting graceful shutdown...`);

  // Stop the trading loop
  console.log("[server] Stopping trading loop...");
  stopTradingLoop();

  // Stop speed trading
  console.log("[server] Stopping speed trading...");
  stopSpeedTrading();

  // Stop stats broadcast
  stopStatsBroadcast();

  // Flush stats to disk
  console.log("[server] Flushing stats to disk...");
  flushStats();
  saveStore();

  // Close WebSocket connections
  console.log("[server] Closing WebSocket connections...");
  wss.clients.forEach((client) => {
    client.close(1000, "Server shutting down");
  });

  // Close HTTP server
  console.log("[server] Closing HTTP server...");
  server.close((err) => {
    if (err) {
      console.error("[server] Error during shutdown:", err);
      process.exit(1);
    }
    console.log("[server] Shutdown complete");
    process.exit(0);
  });

  // Force exit after timeout
  setTimeout(() => {
    console.error("[server] Forced shutdown after timeout");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
}

// Register signal handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception:", err);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[server] Unhandled rejection at:", promise, "reason:", reason);
});

// ── Start ──────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  console.log(`[server] Admin UI  →  http://localhost:${PORT}/admin`);
  console.log(`[server] Health    →  http://localhost:${PORT}/health`);
  console.log(`[server] Speed Trade API  →  http://localhost:${PORT}/api/speed-trade/status`);
});

// Start auto-broadcast of stats
startStatsBroadcast();

// Start the trading loop (non-blocking)
runTradingLoop().catch((err) => {
  console.error("[bot] Trading loop crashed:", err);
  gracefulShutdown("tradingLoopCrash");
});

// Start speed trading if enabled via environment variable
const ENABLE_SPEED_TRADING = process.env.ENABLE_SPEED_TRADING === "true";
if (ENABLE_SPEED_TRADING) {
  startSpeedTrading().catch((err) => {
    console.error("[bot] Speed trading startup failed:", err);
    // Don't crash the whole server, just log the error
  });
}
