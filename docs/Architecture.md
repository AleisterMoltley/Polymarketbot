# Architecture

## Overview

Polymarketbot is a TypeScript trading bot for [Polymarket](https://polymarket.com) prediction markets running on Polygon.  It combines:

- A **REST + WebSocket API** (Express / `ws`) for the admin dashboard
- A **trading loop** that polls the Polymarket CLOB for active markets and places orders when a configurable edge threshold is met
- An optional **paper-trade mode** that simulates orders locally without hitting the blockchain
- A **swap layer** (Paraswap) for MATIC ↔ USDC conversion with slippage protection
- **Position tracking** to prevent duplicate orders
- **Balance checking** before live trades
- **Graceful shutdown** handling for clean process termination
- **Whale tracking** with Kelly Criterion-based position sizing for copy trading

---

## Directory Structure

```
├── data/          In-memory store backups (JSON files, including whale-history.json)
├── docs/          Documentation
├── public/        Static admin UI (served by Express)
├── src/
│   ├── admin/     Admin tabs and trade statistics
│   │   ├── stats.ts   Trade recording and PnL tracking
│   │   └── tabs.ts    Express routes for the admin UI (with auth)
│   ├── bot/       Core bot logic
│   │   ├── trading.ts     Market polling, order placement, position tracking
│   │   ├── swaps.ts       Token swap helper (Paraswap) with slippage protection
│   │   └── whaleTracker.ts  Whale tracking, copy trading, Kelly Criterion
│   ├── utils/     Shared helpers
│   │   ├── jsonStore.ts  In-memory key-value store with disk persistence
│   │   └── wallet.ts     Ethers.js wallet loader with token balance checking
│   └── index.ts   Entry point (HTTP server, WebSocket, bot bootstrap, graceful shutdown)
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

### Whale Tracking Data Flow

```
External: Polymarket Leaderboard API + Polygon Blockchain
         │
         ▼
  src/bot/whaleTracker.ts
         │
         ├─► fetchProfitableWallets()  ──► HTTP GET /leaderboard
         │
         ├─► fetchWalletTradesOnChain() ──► Ethers.js queryFilter (CTF Exchange events)
         │
         ├─► fetchWalletTradesApi()    ──► HTTP GET /trades
         │
         ▼
  Process whale trades
         │
         ├─► shouldCopyTrade() - Evaluate price deviation
         │
         ├─► calculateKellyFraction() - Optimal position sizing
         │
         ▼
  Apply safety delay (WHALE_COPY_DELAY_MS)
         │
         ▼
  handleWhaleCopies() in index.ts
         │
   ┌─────┴──────┐
   │ paper=true │   paper=false
   ▼            ▼
  Log copy   Execute order
         │
         ▼
  data/whale-history.json
```

---

## Trading Strategy

The default strategy is **simple probability arbitrage**:

1. For each active market, the bot retrieves the current YES/NO prices (implied probabilities).
2. **Position check**: Skip outcomes where we already hold a position (prevents duplicates).
3. If `1 − price − MIN_EDGE > 0`, the outcome is considered undervalued.
4. **Balance check**: For live trades, verify sufficient USDC balance before placing order.
5. The position size is proportional to the edge, capped at `MAX_POSITION_SIZE_USDC`.

Configure `MIN_EDGE` (default `0.05`) to control aggressiveness.

---

## Whale Tracking Strategy

The whale tracking module implements **copy trading with risk management**:

### Whale Discovery

1. Fetches profitable wallets from the Polymarket leaderboard API
2. Filters by minimum PnL (`WHALE_MIN_PNL`, default $1000)
3. Filters by minimum win rate (`WHALE_MIN_WIN_RATE`, default 55%)
4. Supports searching for specific profitable traders

### On-Chain Monitoring

1. Uses Ethers.js to connect to Polygon RPC
2. Queries CTF Exchange contract events for trade activity
3. Monitors OrderFilled events to detect whale trades

### Trade Evaluation

Before copying a trade, the bot evaluates:

1. **Price deviation**: If the price has moved more than `WHALE_MAX_PRICE_DEVIATION` (default 2%), the copy is skipped
2. **Kelly Criterion**: Calculates optimal position size based on whale's win rate and current odds

### Kelly Criterion Position Sizing

The Kelly formula determines optimal bet sizing:

```
f* = (bp - q) / b

where:
  f* = fraction of bankroll to bet
  b  = odds received (1/price - 1)
  p  = probability of winning (whale's win rate)
  q  = probability of losing (1 - p)
```

The bot applies:
- **Half-Kelly**: Uses 50% of the calculated Kelly fraction for safety
- **PnL Multiplier**: Slightly increases confidence for more profitable whales (up to 20% boost)
- **Maximum Cap**: Limits position to `WHALE_MAX_KELLY_FRACTION` (default 25% of bankroll)

### Safety Delay

A configurable delay (`WHALE_COPY_DELAY_MS`, default 5 seconds) is applied before executing copy trades to:
- Account for price movements after whale execution
- Reduce front-running risk
- Allow for manual intervention if needed

---

## Security Features

### Admin API Authentication

The admin API endpoints (`/admin/stats`, `/admin/trades`, `/admin/store`) are protected by `ADMIN_SECRET`:

- Set `ADMIN_SECRET` in your `.env` file
- Pass the secret via `X-Admin-Secret` header or `?secret=` query parameter
- The main dashboard page (`/admin`) is accessible without authentication

### Swap Protection

Token swaps include slippage and price impact protection:

- Default max slippage: 2%
- Default max price impact: 5%
- Swaps are rejected if price impact exceeds the threshold

### Whale Trading Safety

Copy trading includes multiple safety mechanisms:

- Price deviation checks before copying
- Kelly Criterion to prevent over-betting
- Configurable safety delay
- Paper trading mode for testing

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CLOB_API_URL` | `https://clob.polymarket.com` | Polymarket CLOB base URL |
| `CLOB_API_KEY` | — | CLOB API key |
| `CLOB_API_SECRET` | — | CLOB API secret |
| `CLOB_API_PASSPHRASE` | — | CLOB API passphrase |
| `PRIVATE_KEY` | — | Polygon wallet private key (64 hex chars) |
| `POLYGON_RPC_URL` | — | Polygon JSON-RPC endpoint |
| `CHAIN_ID` | `137` | Polygon chain ID |
| `PAPER_TRADE` | `true` | Enable paper-trade mode |
| `MAX_POSITION_SIZE_USDC` | `100` | Max USDC per trade |
| `MIN_EDGE` | `0.05` | Minimum edge before entering |
| `POLL_INTERVAL_MS` | `30000` | Market poll interval |
| `PORT` | `3000` | Admin server port |
| `ADMIN_SECRET` | — | Secret for admin API authentication |
| `STATS_BROADCAST_INTERVAL_MS` | `10000` | WebSocket stats broadcast interval |
| `DATA_DIR` | `./data` | Directory for JSON store backups |
| `WHALE_TRACKING_ENABLED` | `false` | Enable whale tracking |
| `WHALE_COPY_DELAY_MS` | `5000` | Delay before copying trades |
| `WHALE_MAX_PRICE_DEVIATION` | `0.02` | Max price deviation (2%) |
| `WHALE_MIN_PNL` | `1000` | Min PnL to track whale |
| `WHALE_MIN_WIN_RATE` | `0.55` | Min win rate to track whale |
| `WHALE_MAX_KELLY_FRACTION` | `0.25` | Max Kelly fraction (25%) |

---

## Graceful Shutdown

The bot handles shutdown signals (`SIGTERM`, `SIGINT`) gracefully:

1. Stops the trading loop
2. Stops whale tracking
3. Stops WebSocket stats broadcast
4. Flushes stats, whale history, and store to disk
5. Closes all WebSocket connections
6. Closes the HTTP server
7. Exits cleanly

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
