/**
 * ok.js — Health-check script
 *
 * Exits with code 0 if the server is healthy, 1 otherwise.
 * Used by Docker HEALTHCHECK and npm run health-check.
 *
 * Optimized for 5-minute trading interval compatibility:
 * - 5-minute timeout (300000ms) to match POLL_INTERVAL_MS
 * - Connection keep-alive for efficient polling
 * - Response body properly consumed to free resources
 */
"use strict";

const http = require("http");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";

// 5-minute timeout to align with trading interval (POLL_INTERVAL_MS=300000)
const HEALTH_TIMEOUT_MS = 300000;

const options = {
  host: HOST,
  port: PORT,
  path: "/health",
  method: "GET",
  timeout: HEALTH_TIMEOUT_MS,
  headers: {
    "Connection": "keep-alive",
    "Accept": "application/json",
  },
};

const startTime = Date.now();

const req = http.request(options, (res) => {
  const elapsed = Date.now() - startTime;

  // Consume the response body to free resources
  res.resume();

  if (res.statusCode === 200) {
    console.log(`[ok] Server is healthy (HTTP ${res.statusCode}, ${elapsed}ms)`);
    process.exit(0);
  } else {
    console.error(`[ok] Unexpected status: HTTP ${res.statusCode} after ${elapsed}ms`);
    process.exit(1);
  }
});

req.on("error", (err) => {
  const elapsed = Date.now() - startTime;
  console.error(`[ok] Health-check failed after ${elapsed}ms:`, err.message);
  process.exit(1);
});

req.on("timeout", () => {
  const elapsed = Date.now() - startTime;
  console.error(`[ok] Health-check timed out after ${elapsed}ms (limit: ${HEALTH_TIMEOUT_MS}ms)`);
  req.destroy();
  process.exit(1);
});

req.end();
