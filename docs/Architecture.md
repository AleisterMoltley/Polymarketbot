# Architecture

## Overview

Polymarketbot is a TypeScript trading bot for [Polymarket](https://polymarket.com) prediction markets running on Polygon.  It combines:

- A **REST + WebSocket API** (Express / `ws`) for the admin dashboard
- A **trading loop** that polls the Polymarket CLOB for active markets and places orders when a configurable edge threshold is met
- An optional **paper-trade mode** that simulates orders locally without hitting the blockchain
- A **swap layer** (Paraswap) for MATIC ↔ USDC conversion with slippage protection
- **Risk management** with stop-loss, take-profit, position sizing, and bankroll tracking
- **Backtesting** engine for strategy validation on historical data
- **Position tracking** to prevent duplicate orders
- **Balance checking** before live trades
- **Graceful shutdown** handling for clean process termination

---

## Directory Structure

```
├── data/          In-memory store backups (JSON files), backtest results
├── docs/          Documentation
├── public/        Static admin UI (served by Express)
├── src/
│   ├── admin/     Admin tabs and trade statistics
│   │   ├── stats.ts   Trade recording and PnL tracking
│   │   └── tabs.ts    Express routes for the admin UI (with auth)
│   ├── backtest/  Backtesting engine
│   │   └── backtest.ts  Historical simulation and PNL analysis
│   ├── bot/       Core bot logic
│   │   ├── trading.ts   Market polling, order placement, stop-loss monitoring
│   │   ├── orders.ts    CLOB client order handling
│   │   ├── priceStream.ts  Real-time WebSocket price streaming
│   │   └── swaps.ts     Token swap helper (Paraswap) with slippage protection
│   ├── utils/     Shared helpers
│   │   ├── jsonStore.ts  In-memory key-value store with disk persistence
│   │   ├── risk.ts       Risk management (stop-loss, position sizing, bankroll)
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
         │  checkStopLossAndTakeProfit()
         ▼
  Risk Position check ─► Trigger stop-loss/take-profit if needed
         │
         │  evaluateAndTrade()
         ▼
  Position check ─► Skip if already holding
         │
  Edge check (price < 1 - MIN_EDGE)
         │
  Risk validation (drawdown check, position size limits)
         │
  Position sizing (2% risk rule)
         │
  Balance check (USDC available >= size)
         │
   ┌─────┴──────┐
   │ paper=true │   paper=false
   ▼            ▼
  Record     submitOrder() ──► CLOB POST /order
  locally         │
         │        ▼
         │  src/utils/risk.ts ─► addRiskPosition()
         ▼
    src/admin/stats.ts  ─► recordTrade()
              │
              ▼
        src/utils/jsonStore.ts ─► data/*.json
```

---

## Risk Management

### Position Sizing (2% Risk Rule)

Instead of using a fixed position size, the bot calculates optimal size based on risk:

```
Position Size = (Bankroll × Risk Per Trade) / (Entry Price - Stop-Loss Price)
```

This ensures:
- Maximum loss per trade is limited to 2% of bankroll (configurable)
- Larger positions when stop-loss is tight (favorable risk/reward)
- Smaller positions when stop-loss is wide (protects capital)

### Stop-Loss Monitoring

Every position is tracked with a stop-loss level:
- Default: 10% below entry price
- Checked on every trading loop tick
- Automatically closes position when triggered

### Take-Profit Levels

Optional take-profit targets:
- Default: 30% above entry (3:1 risk/reward ratio)
- Locks in gains automatically
- Removes emotional decision-making

### Bankroll Tracking

The in-memory store tracks:
- `initialCapital` — starting equity
- `currentCapital` — real-time equity
- `highWaterMark` — peak equity (for drawdown calculation)

Trading is paused when drawdown exceeds threshold (default: 20%).

---

## Backtesting

The backtesting module (`src/backtest/backtest.ts`) enables:

1. **Loading historical data** from JSON files or Polymarket API
2. **Simulating trades** with risk management rules applied
3. **Calculating comprehensive statistics**:
   - Win rate, profit factor, expectancy
   - Max drawdown and Sharpe ratio
   - Trade breakdown by exit reason

Run with: `npm run backtest [data-file]`

---

## Trading Strategy

The default strategy is **simple probability arbitrage** with risk management:

1. For each active market, the bot retrieves the current YES/NO prices (implied probabilities).
2. **Stop-loss/Take-profit check**: Close any positions that hit their exit levels.
3. **Position check**: Skip outcomes where we already hold a position (prevents duplicates).
4. If `1 − price − MIN_EDGE > 0`, the outcome is considered undervalued.
5. **Risk validation**: Check current drawdown against maximum allowed.
6. **Position sizing**: Calculate size using 2% risk rule.
7. **Balance check**: For live trades, verify sufficient USDC balance before placing order.

Configure `MIN_EDGE` (default `0.05`) to control aggressiveness.

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
| `RISK_PER_TRADE` | `0.02` | Risk percentage per trade (2%) |
| `STOP_LOSS_PERCENT` | `0.10` | Stop-loss percentage (10%) |
| `TAKE_PROFIT_PERCENT` | `0.30` | Take-profit percentage (30%) |
| `INITIAL_BANKROLL` | `1000` | Starting bankroll in USDC |
| `MAX_DRAWDOWN_PERCENT` | `20` | Max drawdown before halting (20%) |

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

## Running Backtests

```bash
npm run backtest                    # Use default data file
npm run backtest -- custom-data.json  # Use custom data file
```

## Running with Docker

```bash
docker build -t polymarketbot .
docker run -p 3000:3000 --env-file .env polymarketbot
```
