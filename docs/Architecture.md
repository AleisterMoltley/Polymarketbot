# Architecture

## Overview

Polymarketbot is a TypeScript trading bot for [Polymarket](https://polymarket.com) prediction markets running on Polygon.  It combines:

- A **REST + WebSocket API** (Express / `ws`) for the admin dashboard
- A **trading loop** that polls the Polymarket CLOB for active markets and places orders when a configurable edge threshold is met
- **Multiple trading strategies**: Edge trading, Arbitrage detection, Whale copy trading, AI sentiment analysis
- An optional **paper-trade mode** that simulates orders locally without hitting the blockchain
- A **swap layer** (Paraswap) for MATIC ↔ USDC conversion with slippage protection
- **Position tracking** to prevent duplicate orders
- **Balance checking** before live trades
- **Telegram notifications** for trade alerts, whale activity, and errors
- **Encrypted key support** for secure private key storage
- **Graceful shutdown** handling for clean process termination

---

## Directory Structure

```
├── data/          In-memory store backups (JSON files)
├── docs/          Documentation
│   ├── Architecture.md   This file
│   └── StrategyGuide.md  Trading strategy documentation
├── public/        Static admin UI (served by Express)
├── src/
│   ├── admin/     Admin tabs and trade statistics
│   │   ├── stats.ts   Trade recording and PnL tracking
│   │   └── tabs.ts    Express routes for the admin UI (with auth)
│   ├── bot/       Core bot logic
│   │   ├── trading.ts       Market polling, order placement, position tracking
│   │   ├── arbitrage.ts     Cross-market and binary arbitrage detection
│   │   ├── whaleCopy.ts     Whale wallet monitoring and copy trading
│   │   ├── aiSentiment.ts   AI-powered sentiment analysis
│   │   ├── strategyManager.ts  Unified strategy orchestration
│   │   ├── priceStream.ts   Real-time WebSocket price streaming
│   │   ├── orders.ts        CLOB order placement
│   │   └── swaps.ts         Token swap helper (Paraswap) with slippage protection
│   ├── utils/     Shared helpers
│   │   ├── jsonStore.ts  In-memory key-value store with disk persistence
│   │   ├── wallet.ts     Ethers.js wallet loader with encrypted key support
│   │   ├── crypto.ts     AES-256-GCM encryption for private keys
│   │   └── telegram.ts   Telegram notification service
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

---

## Trading Strategies

The bot implements four complementary strategies managed by `strategyManager.ts`:

### 1. Edge Trading (Default)
The original strategy - buys undervalued outcomes based on probability edge.

### 2. Arbitrage Detection
Identifies risk-free profit opportunities:
- **Binary arbitrage**: When YES + NO < 1.0
- **Cross-market arbitrage**: Price discrepancies between related markets
- **Time-decay arbitrage**: Stale orders near market resolution

### 3. Whale Copy Trading
Monitors and copies trades from profitable "whale" wallets:
- Configurable copy ratio and position limits
- Delay before copying to avoid front-running detection
- Only copies whales with >50% historical win rate

### 4. AI Sentiment Analysis
Analyzes news and social media for trading signals:
- Keyword-based sentiment scoring
- Market-news correlation matching
- Confidence thresholds for trade execution

See [Strategy Guide](./StrategyGuide.md) for detailed configuration.

---

## Security Features

### Private Key Encryption

The bot supports AES-256-GCM encrypted private keys:

```bash
# Encrypt your private key
npx ts-node src/utils/crypto.ts encrypt <your_key> <password>

# Use in .env
PRIVATE_KEY_ENCRYPTED=<encrypted_output>
KEY_PASSWORD=<your_password>
```

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

---

## Notifications

### Telegram Alerts

Configure Telegram for real-time notifications:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

Alerts include:
- Trade executions (paper and live)
- Whale activity detection
- Arbitrage opportunities
- Bot startup/shutdown
- Errors and exceptions

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CLOB_API_URL` | `https://clob.polymarket.com` | Polymarket CLOB base URL |
| `CLOB_API_KEY` | — | CLOB API key |
| `CLOB_API_SECRET` | — | CLOB API secret |
| `CLOB_API_PASSPHRASE` | — | CLOB API passphrase |
| `PRIVATE_KEY` | — | Polygon wallet private key (64 hex chars) |
| `PRIVATE_KEY_ENCRYPTED` | — | AES-256-GCM encrypted private key |
| `KEY_PASSWORD` | — | Decryption password for encrypted key |
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
| `RISK_LEVEL` | `medium` | Risk level: low, medium, high |
| `WHALE_COPY_ENABLED` | `false` | Enable whale copy trading |
| `AI_SENTIMENT_ENABLED` | `false` | Enable AI sentiment analysis |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token for alerts |
| `TELEGRAM_CHAT_ID` | — | Telegram chat ID for alerts |

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Liveness probe |
| `GET /ready` | Readiness probe with stats |
| `GET /api/strategies` | Strategy statistics and annualized returns |
| `GET /admin` | Admin dashboard HTML |
| `GET /admin/stats` | Trade statistics JSON |
| `GET /admin/trades` | Trade history with pagination |
| `GET /admin/store` | Raw store snapshot |

---

## Graceful Shutdown

The bot handles shutdown signals (`SIGTERM`, `SIGINT`) gracefully:

1. Stops the trading loop
2. Stops all strategy scanners
3. Stops WebSocket stats broadcast
4. Sends Telegram shutdown notification
5. Flushes stats and store to disk
6. Closes all WebSocket connections
7. Closes the HTTP server
8. Exits cleanly

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

## Deploying to Railway

The repository includes GitHub Actions for automatic deployment:

1. Add `RAILWAY_TOKEN` to your repository secrets
2. Optionally add `RAILWAY_URL` for post-deployment health checks
3. Push to `main` or `master` branch

See `.github/workflows/deploy.yml` for details.
