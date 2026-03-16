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
 *
 * Node 24+ / http compatibility:
 * - Uses AbortController for clean request termination
 * - Explicit socket cleanup on completion
 * - Handles newer http module behaviors
 */
"use strict";

const http = require("http");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";

// 5-minute timeout to align with trading interval (POLL_INTERVAL_MS=300000)
const HEALTH_TIMEOUT_MS = 300000;

// AbortController for clean request termination (stable in Node 15+)
const controller = new AbortController();
const { signal } = controller;

// Timeout to abort the request if it takes too long
const timeoutId = setTimeout(() => {
  controller.abort();
}, HEALTH_TIMEOUT_MS);

const options = {
  host: HOST,
  port: PORT,
  path: "/health",
  method: "GET",
  timeout: HEALTH_TIMEOUT_MS,
  signal,
  headers: {
    "Connection": "keep-alive",
    "Accept": "application/json",
  },
};

const startTime = Date.now();

/**
 * Cleanup function to ensure resources are freed
 * @param {http.ClientRequest} [request] - The request object to clean up
 */
function cleanup(request) {
  clearTimeout(timeoutId);
  if (request && request.socket) {
    request.socket.destroy();
  }
}

const req = http.request(options, (res) => {
  const elapsed = Date.now() - startTime;

  // Consume the response body to free resources
  res.resume();

  res.on("end", () => {
    cleanup(req);

    if (res.statusCode === 200) {
      console.log(`[ok] Server is healthy (HTTP ${res.statusCode}, ${elapsed}ms)`);
      process.exit(0);
    } else {
      console.error(`[ok] Unexpected status: HTTP ${res.statusCode} after ${elapsed}ms`);
      process.exit(1);
    }
  });

  res.on("error", (err) => {
    cleanup(req);
    console.error(`[ok] Response error after ${elapsed}ms:`, err.message);
    process.exit(1);
  });
});

req.on("error", (err) => {
  const elapsed = Date.now() - startTime;
  cleanup(req);

  // Check if error is due to abort (handle both err.name and err.code for Node version compatibility)
  if (err.name === "AbortError" || err.code === "ABORT_ERR" || signal.aborted) {
    console.error(`[ok] Health-check timed out after ${elapsed}ms (limit: ${HEALTH_TIMEOUT_MS}ms)`);
  } else {
    console.error(`[ok] Health-check failed after ${elapsed}ms:`, err.message);
  }
  process.exit(1);
});

req.on("timeout", () => {
  const elapsed = Date.now() - startTime;
  console.error(`[ok] Health-check timed out after ${elapsed}ms (limit: ${HEALTH_TIMEOUT_MS}ms)`);
  cleanup(req);
  process.exit(1);
});

// Handle socket close events for proper cleanup
req.on("close", () => {
  clearTimeout(timeoutId);
});

req.end();
