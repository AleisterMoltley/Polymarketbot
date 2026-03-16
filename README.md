# Polymarketbot

A paper-trade simulation bot for [Polymarket](https://polymarket.com) prediction markets, **optimized exclusively for 5-minute interval trading in paper mode**.

## ⚡ 5-Minute Optimization

This version of the bot is optimized to:
- **Only support 5-minute trading intervals** (300,000ms) - hardcoded for efficiency
- **Paper mode only** - live trading is disabled to ensure safe testing
- **No extra features** - streamlined for 5-minute paper trading simulation

## Features

- **5-minute interval trading** — locked to 5-minute cycles for consistent testing
- **Paper-trade mode (locked)** — always simulates orders without touching real funds
- **Admin dashboard** — real-time stats via WebSocket, REST API, and a dark-mode UI
- **Docker-ready** — multi-stage Dockerfile with health-check

## How the 5-Minute Trading Loop Works

The bot runs a continuous trading loop that executes every 5 minutes (fixed interval):

1. **Market Polling** — The bot fetches current market data from the Polymarket CLOB API
2. **Price Analysis** — For each active market, it retrieves YES/NO prices (implied probabilities)
3. **Edge Detection** — If `1 - price - MIN_EDGE > 0`, the outcome is considered undervalued
4. **Position Check** — Skips outcomes where a position is already held (prevents duplicates)
5. **Paper Trade Execution** — Records the simulated trade locally without any blockchain interaction
6. **Wait** — Sleeps for 5 minutes before the next iteration

This cycle repeats continuously, allowing you to test trading strategies in a risk-free environment.

## Quick Start

```bash
cp .env.example .env        # fill in your credentials
npm install
npm run dev                 # start with ts-node
```

Open [http://localhost:3000/admin](http://localhost:3000/admin) for the admin dashboard.

## Project Structure

```
├── data/          In-memory store backups
├── docs/          Documentation (see Architecture.md)
├── public/        Static admin UI
├── src/
│   ├── admin/     Stats tracking and admin routes
│   ├── bot/       Trading loop and order helpers
│   ├── utils/     Wallet and JSON-store utilities
│   └── index.ts   Entry point
├── wallet.js      CommonJS wallet helper
├── ok.js          Health-check script
├── Dockerfile
└── .env.example
```

For a full architecture overview and strategy description see [docs/Architecture.md](docs/Architecture.md).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start with ts-node (development) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled build |
| `npm run health-check` | Check server liveness |

## Configuration

Copy `.env.example` to `.env` and fill in:

- `CLOB_API_KEY` / `CLOB_API_SECRET` / `CLOB_API_PASSPHRASE` — Polymarket credentials
- `PAPER_TRADE=true` — paper mode is always enabled (locked in this version)
- `POLL_INTERVAL_MS=300000` — this setting is ignored; 5-minute interval is hardcoded
- `MIN_EDGE=0.05` — minimum edge threshold before entering a trade (default: 5%)
- `MAX_POSITION_SIZE_USDC=100` — maximum simulated position size per trade

See [docs/Architecture.md](docs/Architecture.md) for all variables.

## Upgrade Notes

- Updated to Express 5.x; verify middleware and routing for compatibility in src/admin/ and other routes.
