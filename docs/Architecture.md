# Architecture

## Overview

Polymarketbot is a TypeScript trading bot for [Polymarket](https://polymarket.com) prediction markets, optimized for 5-minute interval trading loops. It combines:

- A **REST + WebSocket API** (Express / `ws`) for the admin dashboard
- A **trading loop** that polls the Polymarket CLOB at configurable intervals (default: 5 minutes) and places orders when a configurable edge threshold is met
- An optional **paper-trade mode** that simulates orders locally without hitting the blockchain
- **Position tracking** to prevent duplicate orders
- **Balance checking** before live trades
- **Graceful shutdown** handling for clean process termination

---

## Directory Structure

```
├── data/          In-memory store backups (JSON files)
├── docs/          Documentation
├── public/        Static admin UI (served by Express)
├── src/
│   ├── admin/     Admin tabs and trade statistics
│   │   ├── stats.ts   Trade recording and PnL tracking
│   │   └── tabs.ts    Express routes for the admin UI (with auth)
│   ├── bot/       Core bot logic
│   │   ├── trading.ts Market polling, order placement, position tracking
│   │   ├── speedTrade.ts 5-minute interval trading with lag detection
│   │   ├── orders.ts  CLOB API order placement
│   │   └── priceStream.ts WebSocket price streaming
│   ├── utils/     Shared helpers
│   │   ├── jsonStore.ts  In-memory key-value store with disk persistence
│   │   └── wallet.ts     Ethers.js wallet loader with token balance checking
│   └── index.ts   Entry point (HTTP server, WebSocket, bot bootstrap, graceful shutdown)
├── wallet.js      CommonJS wallet helper (used by scripts outside the build)
├── ok.js          Health-check script (Docker HEALTHCHECK)
├── Dockerfile     Multi-stage container build
├── .env.example   All supported environment variables
└── tsconfig.json  TypeScript config (target: es2022, module: commonjs)
```

---

## Data Flow

```
External: Polymarket CLOB API
         │
         ▼
  src/bot/trading.ts  ──fetchMarkets()──► HTTP GET /markets
         │
         │  evaluateAndTrade()
         ▼
  Position check ─► Skip if already holding
         │
  Edge check (price < 1 - MIN_EDGE)
         │
  Balance check (USDC available >= size)
         │
   ┌─────┴──────┐
   │ paper=true │   paper=false
   ▼            ▼
  Record     submitOrder() ──► CLOB POST /order
  locally         │
                  ▼
            src/admin/stats.ts  ─► recordTrade()
                  │
                  ▼
            src/utils/jsonStore.ts ─► data/*.json
```

---

## Trading Strategy

The default strategy is **simple probability arbitrage** optimized for 5-minute intervals:

1. For each active market, the bot retrieves the current YES/NO prices (implied probabilities).
2. **Position check**: Skip outcomes where we already hold a position (prevents duplicates).
3. If `1 − price − MIN_EDGE > 0`, the outcome is considered undervalued.
4. **Balance check**: For live trades, verify sufficient USDC balance before placing order.
5. The position size is proportional to the edge, capped at `MAX_POSITION_SIZE_USDC`.

Configure `MIN_EDGE` (default `0.05`) to control aggressiveness.

---

## Security Features

### Admin API Authentication

The admin API endpoints (`/admin/stats`, `/admin/trades`, `/admin/store`) are protected by `ADMIN_SECRET`:

- Set `ADMIN_SECRET` in your `.env` file
- Pass the secret via `X-Admin-Secret` header or `?secret=` query parameter
- The main dashboard page (`/admin`) is accessible without authentication

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CLOB_API_URL` | `https://clob.polymarket.com` | Polymarket CLOB base URL |
| `CLOB_WS_URL` | `wss://clob.polymarket.com/ws` | Polymarket WebSocket URL |
| `CLOB_API_KEY` | — | CLOB API key |
| `CLOB_API_SECRET` | — | CLOB API secret |
| `CLOB_API_PASSPHRASE` | — | CLOB API passphrase |
| `PRIVATE_KEY` | — | Polygon wallet private key (64 hex chars) |
| `POLYGON_RPC_URL` | — | Polygon JSON-RPC endpoint |
| `CHAIN_ID` | `137` | Polygon chain ID |
| `PAPER_TRADE` | `true` | Enable paper-trade mode |
| `MAX_POSITION_SIZE_USDC` | `100` | Max USDC per trade |
| `MIN_EDGE` | `0.05` | Minimum edge before entering |
| `POLL_INTERVAL_MS` | `300000` | Market poll interval (5 minutes default) |
| `PORT` | `3000` | Admin server port |
| `ADMIN_SECRET` | — | Secret for admin API authentication |
| `STATS_BROADCAST_INTERVAL_MS` | `10000` | WebSocket stats broadcast interval |
| `DATA_DIR` | `./data` | Directory for JSON store backups |
| `ENABLE_SPEED_TRADING` | `false` | Enable 5-minute interval speed trading |

---

## Graceful Shutdown

The bot handles shutdown signals (`SIGTERM`, `SIGINT`) gracefully:

1. Stops the trading loop
2. Stops WebSocket stats broadcast
3. Flushes stats and store to disk
4. Closes all WebSocket connections
5. Closes the HTTP server
6. Exits cleanly

This ensures no data loss when stopping the bot or during container restarts.

---

## Running Locally

```bash
cp .env.example .env
# Edit .env with your credentials
npm install
npm run dev          # ts-node (hot reload)
# or
npm run build && npm start
```

## Running with Docker

```bash
docker build -t polymarketbot .
docker run -p 3000:3000 --env-file .env polymarketbot
```
