# Polymarketbot

An automated trading bot for [Polymarket](https://polymarket.com) prediction markets on Polygon.

## Features

- **Paper-trade mode** — simulate orders without touching real funds
- **Live trading** — submits real orders to the Polymarket CLOB API
- **Token swaps** — MATIC ↔ USDC via Paraswap
- **Cross-platform arbitrage** — detects and exploits price differences between Polymarket and Kalshi
- **Admin dashboard** — real-time stats via WebSocket, REST API, and a dark-mode UI
- **Docker-ready** — multi-stage Dockerfile with health-check

## Quick Start

```bash
cp .env.example .env        # fill in your credentials
npm install
npm run dev                 # start with ts-node
```

Open [http://localhost:3000/admin](http://localhost:3000/admin) for the admin dashboard.

## Cross-Platform Arbitrage Strategy

The bot includes a sophisticated arbitrage module (`src/bot/arbitrage.ts`) that monitors price discrepancies between Polymarket and Kalshi prediction markets.

### How It Works

1. **Price Monitoring**: The arbitrage module continuously fetches prices from both platforms:
   - Polymarket prices via the CLOB API
   - Kalshi prices via their REST API (requires API key)

2. **Mispricing Detection**: When the same event is priced differently across platforms, the bot identifies arbitrage opportunities. For example:
   - Polymarket YES price: 0.60 (60%)
   - Kalshi YES price: 0.55 (55%)
   - Price difference: 0.05 (5 cents per share)

3. **Automated Execution**: When enabled, the bot can automatically:
   - Buy on the cheaper platform
   - Sell on the more expensive platform
   - Lock in the price difference as profit

### Risk Management

The arbitrage module enforces strict risk limits:

- **Max 5% bankroll per trade** (`ARB_MAX_BANKROLL_PCT=0.05`)
- **Cooldown period** between trades to prevent overtrading
- **Paper trading mode** to test strategies without real money
- **Balance checks** before executing live trades

### Configuration

Add these variables to your `.env` file to enable arbitrage:

```bash
# Enable arbitrage monitoring
ARB_ENABLED=true

# Kalshi API credentials
KALSHI_API_URL=https://trading-api.kalshi.com/trade-api/v2
KALSHI_API_KEY=your_kalshi_api_key_here

# Arbitrage parameters
ARB_MIN_PRICE_DIFF=0.03      # Minimum price difference to trigger (3 cents)
ARB_MAX_BANKROLL_PCT=0.05    # Maximum 5% of bankroll per trade
ARB_COOLDOWN_MS=60000        # 60 second cooldown between trades
ARB_AUTO_EXECUTE=false       # Set to true for automated execution
ARB_POLL_INTERVAL_MS=30000   # Check for opportunities every 30 seconds
```

### API Endpoints

- `GET /arbitrage/stats` — Current arbitrage statistics
- `GET /arbitrage/opportunities` — List of detected opportunities
- `POST /arbitrage/register-pair` — Register a market pair between platforms

### Market Pairing

Since market identifiers differ between platforms, you need to register matching markets:

```bash
curl -X POST http://localhost:3000/arbitrage/register-pair \
  -H "Content-Type: application/json" \
  -d '{"polymarketId": "0x123...", "kalshiTicker": "ELECTION-2024"}'
```

### Example Arbitrage Scenario

```
Polymarket "Will X happen?" YES = $0.60
Kalshi "Will X happen?" YES = $0.55

Strategy: BUY on Kalshi at $0.55, SELL on Polymarket at $0.60
Profit per share: $0.05 (before fees)

With $100 trade size (5% of $2000 bankroll):
- Potential profit: ~$8.33 (before fees)
```

### Important Notes

- **Fees**: Factor in trading fees from both platforms when calculating profitability
- **Liquidity**: Ensure sufficient liquidity exists on both sides
- **Settlement**: Markets must resolve identically on both platforms
- **Regulatory**: Check local regulations regarding prediction market trading

## Project Structure

```
├── data/          In-memory store backups
├── docs/          Documentation (see Architecture.md)
├── public/        Static admin UI
├── src/
│   ├── admin/     Stats tracking and admin routes
│   ├── bot/       Trading loop, arbitrage, and swap helpers
│   │   ├── arbitrage.ts   Cross-platform arbitrage module
│   │   ├── trading.ts     Main trading logic
│   │   ├── orders.ts      Order management
│   │   └── priceStream.ts WebSocket price streaming
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
- `KALSHI_API_KEY` — Kalshi API key (for arbitrage)
- `PAPER_TRADE=true` to run without real orders (default)
- `ARB_ENABLED=true` to enable cross-platform arbitrage monitoring

See [docs/Architecture.md](docs/Architecture.md) for all variables.
