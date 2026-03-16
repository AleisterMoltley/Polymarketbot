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
  initTradingMode, 
  getTradingMode, 
  getTradingModeState, 
  setTradingMode, 
  toggleTradingMode,
  type TradingMode
} from "./admin/tradingMode";
import { 
  startSpeedTrading, 
  stopSpeedTrading, 
  isSpeedTradingRunning, 
  getSpeedTradeState,
  getSpeedTradeHistory
} from "./bot/speedTrade";
import {
  initTradingHours,
  getTradingHoursState,
  setTradingHours,
  toggleTradingHours,
  isTradingAllowed,
  getTradingHoursStatus
} from "./utils/tradingHours";
import {
  initMarketFilters,
  getFilterConfig,
  setFilterConfig,
  resetFilterConfig,
  getFilterStats,
  type MarketFilterConfig
} from "./utils/marketFilters";

// ── Bootstrap ──────────────────────────────────────────────────────────────

// Initialize JSON store with error handling
const storeLoaded = loadStore();
if (!storeLoaded) {
  console.warn("[server] ⚠️ Store initialization had issues - check logs above");
}

// Initialize modules with error handling to prevent crash on startup
try {
  initTradingMode();
} catch (err) {
  console.error("[server] Failed to initialize trading mode:", err);
  console.warn("[server] Using default trading mode settings");
}

try {
  initTradingHours();
} catch (err) {
  console.error("[server] Failed to initialize trading hours:", err);
  console.warn("[server] Using default trading hours settings");
}

try {
  initMarketFilters();
} catch (err) {
  console.error("[server] Failed to initialize market filters:", err);
  console.warn("[server] Using default market filter settings");
}

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

// ── Trading Mode API endpoints ─────────────────────────────────────────────

// Get current trading mode
app.get("/api/trading-mode", (_req, res) => {
  res.json(getTradingModeState());
});

// Set trading mode
app.post("/api/trading-mode", (req, res) => {
  try {
    const { mode } = req.body as { mode?: string };
    
    if (!mode || (mode !== "paper" && mode !== "live")) {
      res.status(400).json({ 
        success: false, 
        error: 'Invalid mode. Must be "paper" or "live".' 
      });
      return;
    }
    
    const newState = setTradingMode(mode as TradingMode, "dashboard");
    
    // Broadcast mode change to all connected clients
    broadcast("tradingMode", newState);
    
    res.json({ 
      success: true, 
      message: `Trading mode changed to ${mode}`,
      state: newState 
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

// Toggle trading mode
app.post("/api/trading-mode/toggle", (_req, res) => {
  try {
    const newState = toggleTradingMode("dashboard");
    
    // Broadcast mode change to all connected clients
    broadcast("tradingMode", newState);
    
    res.json({ 
      success: true, 
      message: `Trading mode toggled to ${newState.mode}`,
      state: newState 
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

// ── Trading Hours API endpoints ────────────────────────────────────────────

// Get current trading hours state
app.get("/api/trading-hours", (_req, res) => {
  res.json({
    ...getTradingHoursState(),
    tradingAllowed: isTradingAllowed(),
    statusMessage: getTradingHoursStatus()
  });
});

// Set trading hours configuration
app.post("/api/trading-hours", (req, res) => {
  try {
    const { enabled, startHour, endHour } = req.body as { 
      enabled?: boolean; 
      startHour?: number; 
      endHour?: number; 
    };
    
    // Validate input types before passing to setTradingHours
    if (enabled !== undefined && typeof enabled !== "boolean") {
      res.status(400).json({ success: false, error: "Invalid enabled: must be a boolean" });
      return;
    }
    if (startHour !== undefined && (typeof startHour !== "number" || !Number.isInteger(startHour))) {
      res.status(400).json({ success: false, error: "Invalid startHour: must be an integer" });
      return;
    }
    if (endHour !== undefined && (typeof endHour !== "number" || !Number.isInteger(endHour))) {
      res.status(400).json({ success: false, error: "Invalid endHour: must be an integer" });
      return;
    }
    
    const newState = setTradingHours({ 
      enabled, 
      startHour, 
      endHour, 
      changedBy: "dashboard" 
    });
    
    // Broadcast trading hours change to all connected clients
    broadcast("tradingHours", {
      ...newState,
      tradingAllowed: isTradingAllowed(),
      statusMessage: getTradingHoursStatus()
    });
    
    res.json({ 
      success: true, 
      message: `Trading hours updated`,
      state: {
        ...newState,
        tradingAllowed: isTradingAllowed(),
        statusMessage: getTradingHoursStatus()
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ success: false, error: message });
  }
});

// Toggle trading hours restriction on/off
app.post("/api/trading-hours/toggle", (_req, res) => {
  try {
    const newState = toggleTradingHours("dashboard");
    
    // Broadcast trading hours change to all connected clients
    broadcast("tradingHours", {
      ...newState,
      tradingAllowed: isTradingAllowed(),
      statusMessage: getTradingHoursStatus()
    });
    
    res.json({ 
      success: true, 
      message: `Trading hours restriction ${newState.enabled ? 'enabled' : 'disabled'}`,
      state: {
        ...newState,
        tradingAllowed: isTradingAllowed(),
        statusMessage: getTradingHoursStatus()
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

// ── Market Filters API endpoints ───────────────────────────────────────────

// Get current market filter configuration and stats
app.get("/api/market-filters", (_req, res) => {
  res.json(getFilterStats());
});

// Update market filter configuration
app.post("/api/market-filters", (req, res) => {
  try {
    const updates = req.body as Partial<MarketFilterConfig>;
    const newConfig = setFilterConfig(updates, "api");
    
    // Broadcast filter config change to all connected clients
    broadcast("marketFilters", getFilterStats());
    
    res.json({ 
      success: true, 
      message: "Market filters updated",
      config: newConfig 
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ success: false, error: message });
  }
});

// Reset market filters to defaults
app.post("/api/market-filters/reset", (_req, res) => {
  try {
    const defaultConfig = resetFilterConfig();
    
    // Broadcast filter config change to all connected clients
    broadcast("marketFilters", getFilterStats());
    
    res.json({ 
      success: true, 
      message: "Market filters reset to defaults",
      config: defaultConfig 
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

// ── HTTP + WebSocket server ────────────────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws: WebSocket) => {
  console.log("[ws] Client connected");

  // Send current stats, trading mode, trading hours, and market filters immediately on connection
  ws.send(JSON.stringify({ event: "stats", data: getStats() }));
  ws.send(JSON.stringify({ event: "tradingMode", data: getTradingModeState() }));
  ws.send(JSON.stringify({ event: "tradingHours", data: {
    ...getTradingHoursState(),
    tradingAllowed: isTradingAllowed(),
    statusMessage: getTradingHoursStatus()
  }}));
  ws.send(JSON.stringify({ event: "marketFilters", data: getFilterStats() }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { command?: string };
      if (msg.command === "stats") {
        ws.send(JSON.stringify({ event: "stats", data: getStats() }));
      }
      if (msg.command === "tradingMode") {
        ws.send(JSON.stringify({ event: "tradingMode", data: getTradingModeState() }));
      }
      if (msg.command === "tradingHours") {
        ws.send(JSON.stringify({ event: "tradingHours", data: {
          ...getTradingHoursState(),
          tradingAllowed: isTradingAllowed(),
          statusMessage: getTradingHoursStatus()
        }}));
      }
      if (msg.command === "marketFilters") {
        ws.send(JSON.stringify({ event: "marketFilters", data: getFilterStats() }));
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

  // Stop the trading loop first to prevent new trades
  console.log("[server] Stopping trading loop...");
  stopTradingLoop();

  // Stop speed trading
  console.log("[server] Stopping speed trading...");
  stopSpeedTrading();

  // Stop stats broadcast
  stopStatsBroadcast();

  // Persist all state to disk
  console.log("[server] Persisting stats and positions to disk...");
  flushStats();
  const storeSaved = saveStore();
  if (storeSaved) {
    console.log("[server] ✅ All positions and state persisted successfully");
  } else {
    console.error("[server] ⚠️ Failed to persist state - data may be lost!");
  }

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

// Counter for consecutive trading loop failures
let tradingLoopFailures = 0;
const MAX_TRADING_LOOP_FAILURES = 5;
const TRADING_LOOP_RESTART_DELAY_MS = parseInt(process.env.TRADING_LOOP_RESTART_DELAY_MS ?? "30000", 10);

/** Start the trading loop with automatic restart on failure */
function startTradingLoopWithRestart(): void {
  if (isShuttingDown) return;
  
  runTradingLoop()
    .then(() => {
      // Trading loop completed normally (shouldn't happen unless stopped)
      tradingLoopFailures = 0;
    })
    .catch((err) => {
      tradingLoopFailures++;
      console.error(`[bot] Trading loop error (failure ${tradingLoopFailures}/${MAX_TRADING_LOOP_FAILURES}):`, err);
      
      if (tradingLoopFailures >= MAX_TRADING_LOOP_FAILURES) {
        console.error("[bot] Too many consecutive trading loop failures, initiating shutdown...");
        gracefulShutdown("tradingLoopMaxFailures");
        return;
      }
      
      // Attempt to restart after a delay
      console.log(`[bot] Restarting trading loop in ${TRADING_LOOP_RESTART_DELAY_MS / 1000} seconds...`);
      setTimeout(() => {
        startTradingLoopWithRestart();
      }, TRADING_LOOP_RESTART_DELAY_MS);
    });
}

// Start the trading loop with automatic restart capability
startTradingLoopWithRestart();

// Start speed trading if enabled via environment variable
const ENABLE_SPEED_TRADING = process.env.ENABLE_SPEED_TRADING === "true";
if (ENABLE_SPEED_TRADING) {
  startSpeedTrading().catch((err) => {
    console.error("[bot] Speed trading startup failed:", err);
    // Don't crash the whole server, just log the error
  });
}
