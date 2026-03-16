# Polymarketbot

An automated trading bot for [Polymarket](https://polymarket.com) prediction markets on Polygon.

## Features

- **Paper-trade mode** — simulate orders without touching real funds
- **Live trading** — submits real orders to the Polymarket CLOB API
- **Token swaps** — MATIC ↔ USDC via Paraswap
- **Admin dashboard** — real-time stats via WebSocket, REST API, and a dark-mode UI
- **Docker-ready** — multi-stage Dockerfile with health-check

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
│   ├── bot/       Trading loop and swap helpers
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

- `PRIVATE_KEY` — your Polygon wallet private key
- `CLOB_API_KEY` / `CLOB_API_SECRET` / `CLOB_API_PASSPHRASE` — Polymarket credentials
- `PAPER_TRADE=true` to run without real orders (default)

See [docs/Architecture.md](docs/Architecture.md) for all variables.
