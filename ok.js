/**
 * ok.js — Health-check script
 *
 * Exits with code 0 if the server is healthy, 1 otherwise.
 * Used by Docker HEALTHCHECK and npm run health-check.
 */
"use strict";

const http = require("http");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";

const options = {
  host: HOST,
  port: PORT,
  path: "/health",
  method: "GET",
  timeout: 5000,
};

const req = http.request(options, (res) => {
  if (res.statusCode === 200) {
    console.log(`[ok] Server is healthy (HTTP ${res.statusCode})`);
    process.exit(0);
  } else {
    console.error(`[ok] Unexpected status: HTTP ${res.statusCode}`);
    process.exit(1);
  }
});

req.on("error", (err) => {
  console.error("[ok] Health-check failed:", err.message);
  process.exit(1);
});

req.on("timeout", () => {
  console.error("[ok] Health-check timed out");
  req.destroy();
  process.exit(1);
});

req.end();
