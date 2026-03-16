<div align="center">

# 🤖 Polymarketbot

**Automated Trading Bot for [Polymarket](https://polymarket.com) Prediction Markets**

[![Node.js](https://img.shields.io/badge/Node.js-25+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

*A full-featured trading bot with real-time WebSocket price streaming, an elegant dark-mode admin dashboard, and support for both paper trading and live trading with real USDC.*

[Features](#-features) • [Quick Start](#-quick-start) • [Dashboard](#-admin-dashboard) • [Configuration](#-configuration) • [Architecture](#-architecture)

</div>

---

## 📸 Screenshots

### Admin Dashboard
Real-time statistics with WebSocket updates, showing total trades, PnL tracking, and trade mode indicator.

![Dashboard](https://github.com/user-attachments/assets/e4e65c05-8ae3-4747-8225-82790a4a6dc4)

### Trade History
Complete trade history with detailed information including market, side, outcome, price, size, status, mode (paper/live), and PnL.

![Trades](https://github.com/user-attachments/assets/5438a843-df8c-482a-b05a-a41c5a83f99d)

### Live Trading Confirmation
Safety confirmation dialog when switching to live trading mode to prevent accidental real-money trades.

![Live Mode Warning](https://github.com/user-attachments/assets/1defe00e-99b5-41f3-9d4e-a3965409c74e)

---

## ✨ Features

### 🔄 Trading Modes

| Mode | Description |
|------|-------------|
| **📝 Paper Trading** | Risk-free simulation mode — test strategies without using real funds |
| **💰 Live Trading** | Real trading with USDC on Polygon — execute actual orders on Polymarket |

Switch between modes instantly via the dashboard toggle. Live mode requires confirmation to prevent accidental trades.

### 🎯 Core Capabilities

- **🚀 5-Minute Interval Trading** — Optimized polling cycle for consistent market analysis
- **📊 Edge Detection Strategy** — Identifies undervalued outcomes using configurable edge thresholds
- **🔌 WebSocket Price Streaming** — Real-time low-latency prices from Polymarket CLOB
- **⚡ Speed Trading Module** — Last-second lag detection and exploitation for 5-minute markets
- **🛡️ Position Tracking** — Prevents duplicate orders and tracks open positions
- **💱 Token Swaps** — Integrated Paraswap support for USDC/MATIC/WETH swaps on Polygon
- **💳 Wallet Integration** — Ethers.js wallet with balance checking and transaction signing

### 🖥️ Admin Dashboard

- **📈 Real-Time Stats** — Live WebSocket updates every 10 seconds
- **📋 Trade History** — Complete log with filtering by paper/live mode
- **💾 Store Viewer** — Inspect the in-memory JSON store state
- **🌙 Dark Mode UI** — Clean, modern interface built for extended use
- **🔐 API Authentication** — Secure admin endpoints with `ADMIN_SECRET`

### 🐳 Production Ready

- **Docker Support** — Multi-stage build with `node:25-alpine` for minimal image size
- **Health Checks** — Built-in `/health` and `/ready` endpoints
- **Graceful Shutdown** — Clean process termination with data persistence
- **Signal Handling** — Proper handling of SIGTERM, SIGINT, and uncaught exceptions

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 25+** (required for ES2024 features)
- **npm 10+**
- Polymarket CLOB API credentials
- Polygon wallet with USDC (for live trading)

### Installation

```bash
# Clone the repository
git clone https://github.com/AleisterMoltley/Polymarketbot.git
cd Polymarketbot

# Copy environment template
cp .env.example .env

# Install dependencies
npm install

# Start in development mode
npm run dev
```

Open **http://localhost:3000** to access the admin dashboard.

### Upgrade (Mac Terminal)

To upgrade to the latest version of Polymarketbot on macOS:

**Step 1: Navigate to your Polymarketbot directory**

```bash
cd ~/Polymarketbot
```

> **Note:** Replace `~/Polymarketbot` with the actual path where you cloned the repository if different.

**Step 2: Fetch and pull the latest changes**

```bash
git fetch origin
git pull origin main
```

**Step 3: Install any new dependencies**

```bash
npm install
```

**Step 4: Rebuild the project**

```bash
npm run build
```

**Step 5: Restart the bot**

For development mode:
```bash
npm run dev
```

Or for production mode:
```bash
npm start
```

**Docker Upgrade**

If you're using Docker, rebuild the image after pulling:

```bash
git pull origin main
npm run docker:build
npm run docker:run
```

### Docker Deployment

```bash
# Build the image
npm run docker:build

# Run with environment file
npm run docker:run
```

Or manually:

```bash
docker build -t polymarketbot .
docker run -p 3000:3000 --env-file .env polymarketbot
```

---

## 🎛️ Admin Dashboard

Access the dashboard at `http://localhost:3000` after starting the bot.

### Dashboard Tabs

| Tab | Description |
|-----|-------------|
| **Dashboard** | Live stats: total trades, open/filled counts, PnL, paper vs live breakdown |
| **Trades** | Complete trade history table with all details |
| **Store** | JSON snapshot of the in-memory data store |

### Trading Mode Toggle

The header includes a **PAPER/LIVE toggle** that lets you switch trading modes in real-time:

- **Green (PAPER)** — All trades are simulated locally
- **Red (LIVE)** — Real orders are placed on Polymarket using your USDC

⚠️ Switching to LIVE mode shows a confirmation dialog to prevent accidental real-money trades.

---

## ⚙️ Configuration

Copy `.env.example` to `.env` and configure:

### API Credentials

```env
# Polymarket CLOB API
CLOB_API_URL=https://clob.polymarket.com
CLOB_WS_URL=wss://clob.polymarket.com/ws
CLOB_API_KEY=your_api_key
CLOB_API_SECRET=your_api_secret
CLOB_API_PASSPHRASE=your_passphrase
```

### Wallet Configuration

```env
# Polygon Wallet
PRIVATE_KEY=your_64_char_hex_private_key
POLYGON_RPC_URL=https://polygon-rpc.com
CHAIN_ID=137
```

### Trading Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `TRADING_MODE` | `paper` | Initial mode: `paper` or `live` |
| `MIN_EDGE` | `0.05` | Minimum edge (5%) before entering a trade |
| `MAX_POSITION_SIZE_USDC` | `100` | Maximum USDC per trade |
| `POLL_INTERVAL_MS` | `300000` | Market poll interval (5 minutes) |
| `ENABLE_SPEED_TRADING` | `false` | Enable 5-minute speed trading on startup |

### Server Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `ADMIN_SECRET` | — | Secret for admin API authentication |
| `STATS_BROADCAST_INTERVAL_MS` | `10000` | WebSocket stats broadcast interval |
| `DATA_DIR` | `./data` | Directory for JSON store persistence |

---

## 🔄 How the Trading Loop Works

```
┌─────────────────────────────────────────────────────────────────┐
│                     TRADING LOOP (5 min)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                   ┌──────────────────┐
                   │  Fetch Markets   │◄──── Polymarket CLOB API
                   └────────┬─────────┘
                            │
                            ▼
                   ┌──────────────────┐
                   │  Analyze Prices  │     YES/NO implied probabilities
                   └────────┬─────────┘
                            │
                            ▼
                   ┌──────────────────┐
                   │  Detect Edge     │     1 - price - MIN_EDGE > 0?
                   └────────┬─────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
              ▼                           ▼
    ┌─────────────────┐         ┌─────────────────┐
    │  No Edge Found  │         │  Edge Detected  │
    │    (Skip)       │         │  Check Position │
    └─────────────────┘         └────────┬────────┘
                                         │
                          ┌──────────────┴──────────────┐
                          │                             │
                          ▼                             ▼
                ┌──────────────────┐          ┌──────────────────┐
                │ Position Exists  │          │ New Position     │
                │    (Skip)        │          │ Execute Trade    │
                └──────────────────┘          └────────┬─────────┘
                                                       │
                                    ┌──────────────────┴──────────────────┐
                                    │                                     │
                                    ▼                                     ▼
                          ┌─────────────────┐                   ┌─────────────────┐
                          │   PAPER MODE    │                   │   LIVE MODE     │
                          │ Record locally  │                   │ Submit to CLOB  │
                          │ (no blockchain) │                   │ Check balance   │
                          └─────────────────┘                   └─────────────────┘
```

---

## 🏗️ Architecture

### Project Structure

```
polymarketbot/
├── 📁 data/                  # Persistent JSON store backups
├── 📁 docs/                  # Documentation
│   ├── Architecture.md       # Detailed architecture guide
│   ├── MacSetup.md          # macOS installation guide
│   └── WindowsSetup.md      # Windows installation guide
├── 📁 public/               # Static dashboard UI
│   └── index.html           # Admin SPA
├── 📁 src/
│   ├── 📁 admin/            # Admin dashboard backend
│   │   ├── stats.ts         # Trade statistics & PnL tracking
│   │   ├── tabs.ts          # Express routes for admin API
│   │   └── tradingMode.ts   # Paper/Live mode management
│   ├── 📁 bot/              # Core trading logic
│   │   ├── trading.ts       # Main trading loop
│   │   ├── speedTrade.ts    # 5-minute speed trading strategy
│   │   ├── orders.ts        # CLOB order placement
│   │   ├── priceStream.ts   # WebSocket price streaming
│   │   └── swaps.ts         # Paraswap token swaps
│   ├── 📁 utils/            # Shared utilities
│   │   ├── jsonStore.ts     # In-memory KV store with persistence
│   │   └── wallet.ts        # Ethers.js wallet management
│   └── index.ts             # Application entry point
├── 🐳 Dockerfile            # Multi-stage Docker build
├── 📄 .env.example          # Environment template
├── 📄 package.json
└── 📄 tsconfig.json
```

### Key Modules

| Module | Purpose |
|--------|---------|
| `src/index.ts` | HTTP server, WebSocket, bot bootstrap, graceful shutdown |
| `src/bot/trading.ts` | Market polling, edge detection, order execution |
| `src/bot/speedTrade.ts` | Low-latency 5-minute market trading with lag detection |
| `src/bot/priceStream.ts` | Real-time WebSocket price streaming |
| `src/admin/tradingMode.ts` | Paper/Live mode state management |
| `src/utils/wallet.ts` | Polygon wallet with balance checking |

For detailed architecture documentation, see [docs/Architecture.md](docs/Architecture.md).

---

## 📜 Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with ts-node (hot reload) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled production build |
| `npm run docker:build` | Build Docker image |
| `npm run docker:run` | Run Docker container with env file |
| `npm run health-check` | Check server liveness |
| `npm run clean` | Remove `dist/` directory |

---

## 📦 Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| **Node.js** | 25+ | Runtime (ES2024 features) |
| **TypeScript** | ^5.9.3 | Type safety with strict mode |
| **Express** | ^5.2.1 | HTTP server with async support |
| **ethers** | ^6.16.0 | Polygon wallet & transactions |
| **@polymarket/clob-client** | ^5.8.0 | Polymarket CLOB API |
| **ws** | ^8.19.0 | WebSocket for real-time data |
| **axios** | ^1.13.6 | HTTP client for API calls |

---

## 🔒 Security

- **Admin API Authentication** — Protected endpoints require `ADMIN_SECRET`
- **Live Mode Confirmation** — Prevents accidental real-money trades
- **Balance Validation** — Checks USDC balance before live trades
- **Private Key Security** — Never logged or exposed in responses

---

## 📚 Platform Setup Guides

- **macOS**: [docs/MacSetup.md](docs/MacSetup.md)
- **Windows**: [docs/WindowsSetup.md](docs/WindowsSetup.md)
- **Architecture**: [docs/Architecture.md](docs/Architecture.md)

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with ❤️ for the Polymarket Community**

</div>
