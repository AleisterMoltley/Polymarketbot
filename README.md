# Polymarketbot

An automated trading bot for [Polymarket](https://polymarket.com) prediction markets on Polygon.

## Features

- **Paper-trade mode** — simulate orders without touching real funds
- **Live trading** — submits real orders to the Polymarket CLOB API
- **Risk Management** — stop-loss, take-profit, position sizing (2% risk per trade), bankroll tracking
- **Backtesting** — simulate strategies on historical data with full PNL analysis
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
├── data/          In-memory store backups, backtest results
├── docs/          Documentation (see Architecture.md)
├── public/        Static admin UI
├── src/
│   ├── admin/     Stats tracking and admin routes
│   ├── backtest/  Backtesting engine and reporting
│   ├── bot/       Trading loop and swap helpers
│   ├── utils/     Wallet, JSON-store, and risk management utilities
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
| `npm run backtest` | Run backtesting on historical data |
| `npm run health-check` | Check server liveness |

## Risk Management

The bot implements several risk management features to **minimize losses and maximize gains**:

### 🛡️ Stop-Loss Protection

Every position is opened with a configurable stop-loss level (default: 10% below entry). When the price hits the stop-loss, the position is automatically closed to limit losses.

**How it minimizes losses:**
- Limits downside to a known amount per trade
- Prevents emotional decision-making during drawdowns
- Protects against catastrophic single-trade losses

### 📏 Position Sizing (2% Risk Rule)

Instead of betting a fixed amount, the bot calculates position size based on:
```
Position Size = (Bankroll × Risk Per Trade) / (Entry Price - Stop-Loss Price)
```

**Default: 2% risk per trade** — meaning if a stop-loss is hit, you lose at most 2% of your bankroll.

**How it maximizes gains:**
- Allows larger positions when risk/reward is favorable (tight stop-loss)
- Scales position size with your bankroll (compound growth)
- Keeps you in the game during losing streaks

### 💰 Bankroll Tracking

The bot maintains an in-memory store that tracks:
- Initial capital
- Current capital
- High water mark (for drawdown calculation)
- Maximum drawdown percentage

**How it protects capital:**
- Automatically pauses trading when drawdown exceeds threshold (default: 20%)
- Tracks performance over time
- Enables proper position sizing based on current equity

### 🎯 Take-Profit Levels

Optional take-profit targets (default: 30% above entry) automatically lock in gains when hit.

**How it maximizes gains:**
- Removes the temptation to hold too long
- Captures profits at predetermined levels
- Maintains favorable risk/reward ratios (default 3:1)

## Backtesting

Run historical simulations to validate strategy performance before risking real capital.

### Running a Backtest

```bash
# Run with default data (paper-trade-history-march11.json)
npm run backtest

# Run with custom data file
npm run backtest -- path/to/trades.json
```

### Backtest Configuration

Configure via environment variables:

| Variable | Default | Description |
|---|---|---|
| `BACKTEST_INITIAL_CAPITAL` | `1000` | Starting capital in USDC |
| `BACKTEST_RISK_PER_TRADE` | `0.02` | Risk percentage per trade |
| `BACKTEST_STOP_LOSS` | `0.10` | Stop-loss percentage |
| `BACKTEST_TAKE_PROFIT` | `0.30` | Take-profit percentage |
| `BACKTEST_SLIPPAGE` | `0.005` | Simulated slippage |

### Backtest Report

The backtest generates a comprehensive report including:

- **Performance Summary** — Total return, trading period, end capital
- **Trade Statistics** — Win rate, total PNL, gross profit/loss
- **Risk Metrics** — Profit factor, max drawdown, Sharpe ratio, expectancy
- **Trade Breakdown** — By exit reason (stop-loss, take-profit, market close)

### Sample Output

```
═══════════════════════════════════════════════════════════════
                    BACKTEST REPORT                            
═══════════════════════════════════════════════════════════════

📊 CONFIGURATION
───────────────────────────────────────────────────────────────
  Initial Capital:     $1,000
  Risk Per Trade:      2.0%
  Stop-Loss:           10.0%
  Take-Profit:         30.0%

📈 PERFORMANCE SUMMARY
───────────────────────────────────────────────────────────────
  Total Return:        +12.69%
  End Capital:         $1,126.90

🎯 RISK METRICS
───────────────────────────────────────────────────────────────
  Win Rate:            65.0%
  Profit Factor:       2.15
  Max Drawdown:        $45.00 (4.2%)
  Sharpe Ratio:        1.85
```

## Configuration

Copy `.env.example` to `.env` and fill in:

### Trading Credentials
- `PRIVATE_KEY` — your Polygon wallet private key
- `CLOB_API_KEY` / `CLOB_API_SECRET` / `CLOB_API_PASSPHRASE` — Polymarket credentials

### Risk Management
- `PAPER_TRADE=true` — run without real orders (default)
- `RISK_PER_TRADE=0.02` — risk percentage per trade (default: 2%)
- `STOP_LOSS_PERCENT=0.10` — stop-loss percentage (default: 10%)
- `TAKE_PROFIT_PERCENT=0.30` — take-profit percentage (default: 30%)
- `INITIAL_BANKROLL=1000` — starting bankroll in USDC
- `MAX_DRAWDOWN_PERCENT=20` — halt trading if drawdown exceeds this (default: 20%)

See [docs/Architecture.md](docs/Architecture.md) for all variables.
