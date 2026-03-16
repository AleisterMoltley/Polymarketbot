# Architecture

## Overview

Polymarketbot is a TypeScript trading bot for [Polymarket](https://polymarket.com) prediction markets running on Polygon.  It combines:

- A **REST + WebSocket API** (Express / `ws`) for the admin dashboard
- A **trading loop** that polls the Polymarket CLOB for active markets and places orders when a configurable edge threshold is met
- An optional **paper-trade mode** that simulates orders locally without hitting the blockchain
- A **swap layer** (Paraswap) for MATIC ↔ USDC conversion

---

## Directory Structure

```
├── data/          In-memory store backups (JSON files)
├── docs/          Documentation
├── public/        Static admin UI (served by Express)
├── src/
│   ├── admin/     Admin tabs and trade statistics
│   │   ├── stats.ts   Trade recording and PnL tracking
│   │   └── tabs.ts    Express routes for the admin UI
│   ├── bot/       Core bot logic
│   │   ├── trading.ts Market polling and order placement
│   │   └── swaps.ts   Token swap helper (Paraswap)
│   ├── utils/     Shared helpers
│   │   ├── jsonStore.ts  In-memory key-value store with disk persistence
│   │   └── wallet.ts     Ethers.js wallet loader
│   └── index.ts   Entry point (HTTP server, WebSocket, bot bootstrap)
├── wallet.js      CommonJS wallet helper (used by scripts outside the build)
├── ok.js          Health-check script (Docker HEALTHCHECK)
├── Dockerfile     Multi-stage container build
├── .env.example   All supported environment variables
└── tsconfig.json  TypeScript config (target: es2020, module: commonjs)
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
  Edge check (price < 1 - MIN_EDGE)
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

The default strategy is **simple probability arbitrage**:

1. For each active market, the bot retrieves the current YES/NO prices (implied probabilities).
2. If `1 − price − MIN_EDGE > 0`, the outcome is considered undervalued.
3. The position size is proportional to the edge, capped at `MAX_POSITION_SIZE_USDC`.

Configure `MIN_EDGE` (default `0.05`) to control aggressiveness.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CLOB_API_URL` | `https://clob.polymarket.com` | Polymarket CLOB base URL |
| `CLOB_API_KEY` | — | CLOB API key |
| `CLOB_API_SECRET` | — | CLOB API secret |
| `CLOB_API_PASSPHRASE` | — | CLOB API passphrase |
| `PRIVATE_KEY` | — | Polygon wallet private key |
| `POLYGON_RPC_URL` | — | Polygon JSON-RPC endpoint |
| `CHAIN_ID` | `137` | Polygon chain ID |
| `PAPER_TRADE` | `true` | Enable paper-trade mode |
| `MAX_POSITION_SIZE_USDC` | `100` | Max USDC per trade |
| `MIN_EDGE` | `0.05` | Minimum edge before entering |
| `POLL_INTERVAL_MS` | `30000` | Market poll interval |
| `PORT` | `3000` | Admin server port |
| `DATA_DIR` | `./data` | Directory for JSON store backups |

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
