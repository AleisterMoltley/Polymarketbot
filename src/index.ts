import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";

import { loadStore } from "./utils/jsonStore";
import adminRouter from "./admin/tabs";
import { runTradingLoop } from "./bot/trading";
import { getStats } from "./admin/stats";

// ── Bootstrap ──────────────────────────────────────────────────────────────

loadStore();

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const app = express();
app.use(express.json());

// Static assets (admin SPA / public pages)
app.use(express.static(path.join(__dirname, "..", "public")));

// Admin API tabs
app.use("/admin", adminRouter);

// Simple liveness probe
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
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

// ── Start ──────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  console.log(`[server] Admin UI  →  http://localhost:${PORT}/admin`);
  console.log(`[server] Health    →  http://localhost:${PORT}/health`);
});

// Start the trading loop (non-blocking)
runTradingLoop().catch((err) => {
  console.error("[bot] Trading loop crashed:", err);
  process.exit(1);
});
