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
  runArbitrageLoop,
  stopArbitrageLoop,
  getArbitrageStats,
  getOpportunities,
  registerMarketPair,
} from "./bot/arbitrage";

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
    arbitrage: getArbitrageStats(),
  });
});

// Arbitrage endpoints
app.get("/arbitrage/stats", (_req, res) => {
  res.json(getArbitrageStats());
});

app.get("/arbitrage/opportunities", (_req, res) => {
  res.json(getOpportunities());
});

app.post("/arbitrage/register-pair", (req, res) => {
  const { polymarketId, kalshiTicker } = req.body as {
    polymarketId?: string;
    kalshiTicker?: string;
  };
  
  if (!polymarketId || !kalshiTicker) {
    res.status(400).json({ error: "polymarketId and kalshiTicker are required" });
    return;
  }
  
  registerMarketPair(polymarketId, kalshiTicker);
  res.json({ success: true, polymarketId, kalshiTicker });
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

  // Stop the arbitrage loop
  console.log("[server] Stopping arbitrage loop...");
  stopArbitrageLoop();

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
});

// Start auto-broadcast of stats
startStatsBroadcast();

// Start the trading loop (non-blocking)
runTradingLoop().catch((err) => {
  console.error("[bot] Trading loop crashed:", err);
  gracefulShutdown("tradingLoopCrash");
});

// Start the arbitrage loop if enabled (non-blocking, 24/7 operation)
const arbEnabled = process.env.ARB_ENABLED === "true";
if (arbEnabled) {
  runArbitrageLoop().catch((err) => {
    console.error("[bot] Arbitrage loop crashed:", err);
    // Don't shut down the whole server for arbitrage failures
    console.warn("[bot] Arbitrage loop disabled due to crash");
  });
  console.log("[server] Arbitrage loop started for 24/7 cross-platform monitoring");
} else {
  console.log("[server] Arbitrage loop disabled (set ARB_ENABLED=true to enable)");
}
