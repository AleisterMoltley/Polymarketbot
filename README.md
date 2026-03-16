# Polymarketbot

An automated trading bot for [Polymarket](https://polymarket.com) prediction markets on Polygon.

## Features

- **Paper-trade mode** — simulate orders without touching real funds
- **Live trading** — submits real orders to the Polymarket CLOB API
- **Token swaps** — MATIC ↔ USDC via Paraswap
- **Admin dashboard** — real-time stats via WebSocket, REST API, and a dark-mode UI
- **Docker-ready** — multi-stage Dockerfile with health-check
- **Whale tracking** — copy trades from profitable wallets with Kelly Criterion risk management

## Quick Start

```bash
cp .env.example .env        # fill in your credentials
npm install
npm run dev                 # start with ts-node
```

Open [http://localhost:3000/admin](http://localhost:3000/admin) for the admin dashboard.

## Project Structure

```
├── data/          In-memory store backups (including whale-history.json)
├── docs/          Documentation (see Architecture.md)
├── public/        Static admin UI
├── src/
│   ├── admin/     Stats tracking and admin routes
│   ├── bot/       Trading loop, swap helpers, and whale tracker
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

## Whale Tracking & Profit Optimization

The bot includes a whale tracking module that monitors profitable wallets on Polymarket and copies their trades with intelligent risk management.

### Enabling Whale Tracking

Set the following in your `.env` file:

```bash
WHALE_TRACKING_ENABLED=true
```

### Configuration Options

| Variable | Default | Description |
|---|---|---|
| `WHALE_TRACKING_ENABLED` | `false` | Enable/disable whale tracking |
| `WHALE_COPY_DELAY_MS` | `5000` | Safety delay (ms) before copying a trade |
| `WHALE_MAX_PRICE_DEVIATION` | `0.02` | Max price change (2%) before skipping copy |
| `WHALE_MIN_PNL` | `1000` | Min total PnL ($) to qualify as whale |
| `WHALE_MIN_WIN_RATE` | `0.55` | Min win rate (55%) to track a wallet |
| `WHALE_MAX_KELLY_FRACTION` | `0.25` | Max position size (25% of bankroll) |

### How It Works

1. **Whale Discovery**: The bot fetches profitable wallets from Polymarket's leaderboard API and tracks their trading activity.

2. **On-Chain Monitoring**: Uses Ethers.js to query the Polygon blockchain for real-time trade events on the Polymarket CTF Exchange contract.

3. **Trade Evaluation**: When a whale makes a trade, the bot evaluates whether to copy it based on:
   - Current market price deviation from the whale's execution price
   - Whale's historical win rate and total PnL
   - Kelly Criterion optimal position sizing

4. **Safety Delay**: A configurable delay (default 5 seconds) is applied before executing copy trades to account for price movements and reduce front-running risk.

5. **Kelly Criterion Position Sizing**: Position sizes are calculated using the Kelly formula:
   ```
   f* = (bp - q) / b
   ```
   Where:
   - `f*` = fraction of bankroll to bet
   - `b` = odds received (1/price - 1)
   - `p` = estimated win probability (whale's win rate)
   - `q` = 1 - p

   The bot uses half-Kelly (50% of optimal) for additional safety and caps positions at `WHALE_MAX_KELLY_FRACTION`.

### Whale History

All whale tracking data is logged to `data/whale-history.json`, including:
- Tracked whale wallets and their stats
- Observed whale trades
- Copied trades with execution details and PnL

### API Endpoints

The `/ready` endpoint now includes whale tracking statistics:

```json
{
  "status": "ready",
  "stats": { ... },
  "whaleStats": {
    "totalWhales": 10,
    "totalTrades": 150,
    "totalCopiedTrades": 25,
    "pendingCopies": 0,
    "executedCopies": 23,
    "totalCopiedPnl": 125.50
  }
}
```

### Best Practices for Profit Optimization

1. **Start with Paper Trading**: Always test with `PAPER_TRADE=true` first to validate the strategy.

2. **Conservative Kelly Fraction**: Keep `WHALE_MAX_KELLY_FRACTION` at 0.25 or lower to limit drawdowns.

3. **Higher Win Rate Threshold**: Consider increasing `WHALE_MIN_WIN_RATE` to 0.60+ for more selective whale following.

4. **Monitor Price Deviation**: If you're missing good trades, increase `WHALE_MAX_PRICE_DEVIATION`. If you're getting bad fills, decrease it.

5. **Adjust Copy Delay**: Shorter delays may get better prices but increase risk. Longer delays are safer but may miss opportunities.

6. **Review Whale History**: Regularly check `data/whale-history.json` to identify which whales are most profitable and adjust tracking accordingly.
