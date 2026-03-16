# Polymarketbot Mac Setup Guide

A comprehensive step-by-step guide to set up and run Polymarketbot on macOS.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Install Homebrew](#2-install-homebrew)
3. [Install Node.js 25+](#3-install-nodejs-25)
4. [Install Git](#4-install-git)
5. [Clone the Repository](#5-clone-the-repository)
6. [Install Project Dependencies](#6-install-project-dependencies)
7. [Create a Polymarket Account](#7-create-a-polymarket-account)
8. [Obtain Polymarket CLOB API Credentials](#8-obtain-polymarket-clob-api-credentials)
9. [Set Up a Polygon Wallet](#9-set-up-a-polygon-wallet)
10. [Configure Environment Variables](#10-configure-environment-variables)
11. [Run the Bot in Development Mode](#11-run-the-bot-in-development-mode)
12. [Run the Bot in Production Mode](#12-run-the-bot-in-production-mode)
13. [Access the Admin Dashboard](#13-access-the-admin-dashboard)
14. [Optional: Docker Setup](#14-optional-docker-setup)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Prerequisites

Before you begin, ensure you have the following:

- **macOS** (Monterey 12.0 or later recommended)
- **Administrator access** to your Mac (required for installing software)
- **Internet connection** (required for downloading packages and API access)
- A **Polymarket account** (you will create one if you don't have it)
- A **Polygon-compatible wallet** (e.g., MetaMask)

---

## 2. Install Homebrew

Homebrew is the package manager for macOS. It simplifies installing software.

### Step 2.1: Open Terminal

1. Press `Cmd + Space` to open Spotlight Search.
2. Type `Terminal` and press `Enter`.

### Step 2.2: Install Homebrew

Copy and paste the following command into Terminal and press `Enter`:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Step 2.3: Follow the Installation Prompts

- You will be asked to enter your Mac password (it won't be visible as you type).
- Press `Enter` when prompted to continue.
- Wait for the installation to complete (this may take several minutes).

### Step 2.4: Add Homebrew to Your PATH

After installation, Homebrew will display instructions to add it to your PATH. Run the commands it suggests. Typically, for Apple Silicon Macs (M1/M2/M3/M4):

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

For Intel Macs, the commands may differ slightly. Follow the instructions shown in your Terminal.

### Step 2.5: Verify Homebrew Installation

```bash
brew --version
```

You should see output like `Homebrew 4.x.x`.

---

## 3. Install Node.js 25+

This project requires Node.js version 25 or higher.

### Step 3.1: Install Node.js Using Homebrew

```bash
brew install node@25
```

If Node.js 25 is not yet available via Homebrew (it's the latest version), you can use `nvm` (Node Version Manager) instead.

### Alternative: Install Node.js Using nvm

#### Step 3.1a: Install nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```

#### Step 3.1b: Reload Your Shell Configuration

Close and reopen Terminal, or run:

```bash
source ~/.zshrc
```

#### Step 3.1c: Install Node.js 25

```bash
nvm install 25
nvm use 25
nvm alias default 25
```

### Step 3.2: Verify Node.js Installation

```bash
node --version
```

You should see output like `v25.x.x`.

### Step 3.3: Verify npm Installation

npm (Node Package Manager) is installed automatically with Node.js.

```bash
npm --version
```

You should see output like `10.x.x` or higher.

---

## 4. Install Git

Git is required to clone the repository.

### Step 4.1: Check if Git is Already Installed

```bash
git --version
```

If Git is installed, you'll see output like `git version 2.x.x`. If not, continue to the next step.

### Step 4.2: Install Git Using Homebrew

```bash
brew install git
```

### Step 4.3: Verify Git Installation

```bash
git --version
```

### Step 4.4: Configure Git (First-Time Setup)

Set your name and email for Git commits:

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

---

## 5. Clone the Repository

### Step 5.1: Choose a Directory

Navigate to the directory where you want to store the project. For example, to use your home directory:

```bash
cd ~
```

Or create a dedicated projects folder:

```bash
mkdir -p ~/Projects
cd ~/Projects
```

### Step 5.2: Clone the Repository

```bash
git clone https://github.com/AleisterMoltley/Polymarketbot.git
```

### Step 5.3: Navigate to the Project Directory

```bash
cd Polymarketbot
```

### Step 5.4: Verify the Clone

```bash
ls -la
```

You should see files like `package.json`, `tsconfig.json`, `src/`, `docs/`, etc.

---

## 6. Install Project Dependencies

### Step 6.1: Install npm Dependencies

From the project root directory, run:

```bash
npm install
```

This command:
- Reads `package.json` to determine required packages
- Downloads and installs all dependencies into the `node_modules/` folder
- May take 1-3 minutes depending on your internet speed

### Step 6.2: Verify Installation

Check that there are no critical errors. Warnings are generally acceptable.

You can verify the TypeScript compiler is available:

```bash
npx tsc --version
```

You should see output like `Version 5.9.3`.

---

## 7. Create a Polymarket Account

### Step 7.1: Visit Polymarket

1. Open your web browser.
2. Navigate to [https://polymarket.com](https://polymarket.com).

### Step 7.2: Sign Up

1. Click **"Sign Up"** or **"Get Started"**.
2. Connect your wallet (e.g., MetaMask) or create an account using email.
3. Follow the on-screen instructions to complete registration.

### Step 7.3: Complete KYC (If Required)

- Some features may require identity verification (KYC).
- Follow Polymarket's instructions if prompted.

### Step 7.4: Fund Your Account (Optional for Paper Trading)

- For paper trading (simulation), you don't need real funds.
- For live trading, you'll need to deposit USDC on the Polygon network.

---

## 8. Obtain Polymarket CLOB API Credentials

The bot requires API credentials to communicate with Polymarket's Central Limit Order Book (CLOB).

### Step 8.1: Access the CLOB API Portal

1. Log in to your Polymarket account.
2. Navigate to the API settings. This is typically found in:
   - **Settings** → **API** or
   - **Developer** → **API Keys**

### Step 8.2: Generate API Keys

1. Click **"Create New API Key"** or similar.
2. You will receive:
   - **API Key**: A public identifier for your application.
   - **API Secret**: A private key (keep this secure!).
   - **API Passphrase**: An additional authentication token.

### Step 8.3: Save Your Credentials Securely

- Store these credentials in a secure location (e.g., a password manager).
- **Never share these credentials publicly or commit them to Git.**

---

## 9. Set Up a Polygon Wallet

The bot interacts with the Polygon blockchain. You need a wallet with a private key.

### Step 9.1: Option A - Use MetaMask

If you already have MetaMask:

1. Open MetaMask.
2. Click on the account icon (top-right).
3. Click **"Account Details"**.
4. Click **"Show Private Key"** (you'll need to enter your password).
5. Copy the private key (64 hexadecimal characters).

### Step 9.2: Option B - Create a New Wallet

For enhanced security, consider creating a dedicated wallet for the bot:

1. Install MetaMask as a browser extension from [https://metamask.io](https://metamask.io).
2. Create a new wallet and securely back up your recovery phrase.
3. Export the private key as described above.

### Step 9.3: Configure Polygon Network in MetaMask

1. Open MetaMask.
2. Click the network dropdown (top-center).
3. Click **"Add Network"** → **"Add a network manually"**.
4. Enter the following details:

   | Field | Value |
   |-------|-------|
   | Network Name | Polygon Mainnet |
   | New RPC URL | `https://polygon-rpc.com` |
   | Chain ID | `137` |
   | Currency Symbol | `MATIC` |
   | Block Explorer URL | `https://polygonscan.com` |

5. Click **"Save"**.

### Step 9.4: Secure Your Private Key

- **Never share your private key with anyone.**
- **Never commit your private key to Git.**
- Consider using a separate wallet with limited funds for bot operations.

---

## 10. Configure Environment Variables

### Step 10.1: Create the Environment File

From the project root directory, copy the example environment file:

```bash
cp .env.example .env
```

### Step 10.2: Open the Environment File for Editing

Use your preferred text editor. For example, with nano:

```bash
nano .env
```

Or with Visual Studio Code (if installed):

```bash
code .env
```

### Step 10.3: Fill In Your Credentials

Edit the `.env` file with your actual values:

```bash
# Polymarket CLOB API credentials
CLOB_API_URL=https://clob.polymarket.com
CLOB_WS_URL=wss://clob.polymarket.com/ws
CLOB_API_KEY=your_actual_api_key_here
CLOB_API_SECRET=your_actual_api_secret_here
CLOB_API_PASSPHRASE=your_actual_passphrase_here

# Wallet / Polygon
PRIVATE_KEY=your_64_character_hex_private_key_here
POLYGON_RPC_URL=https://polygon-rpc.com
CHAIN_ID=137

# Bot settings
TRADING_MODE=paper
MAX_POSITION_SIZE_USDC=100
MIN_EDGE=0.05

# Trading loop interval (5 minutes = 300000ms)
POLL_INTERVAL_MS=300000

# Admin / API server
PORT=3000
ADMIN_SECRET=your_secure_admin_secret_here

# WebSocket broadcast interval (ms)
STATS_BROADCAST_INTERVAL_MS=10000

# Data paths
DATA_DIR=./data

# Speed trading settings
ENABLE_SPEED_TRADING=false
MIN_BALANCE_USDC=10
LAG_THRESHOLD=0.02
MAX_SPREAD=0.05
THROTTLE_MS=5000
PRICE_HISTORY_SIZE=20
LAST_SECOND_WINDOW_MS=10000
CLOSE_DETECTION_WINDOW_MS=60000
```

### Step 10.4: Save and Close the File

- In nano: Press `Ctrl + X`, then `Y`, then `Enter`.
- In VS Code: Press `Cmd + S`, then close the file.

### Step 10.5: Verify the Environment File is Not Tracked by Git

The `.env` file should already be listed in `.gitignore`. Verify:

```bash
cat .gitignore | grep .env
```

You should see `.env` listed. This ensures your credentials are never committed to Git.

---

## 11. Run the Bot in Development Mode

Development mode uses `ts-node` for hot reloading and easier debugging.

### Step 11.1: Start the Bot

From the project root directory:

```bash
npm run dev
```

### Step 11.2: Expected Output

You should see output similar to:

```
[INFO] Loading configuration...
[INFO] Connecting to Polymarket CLOB...
[INFO] Starting admin server on port 3000...
[INFO] Paper trading mode enabled
[INFO] Trading loop started (5-minute intervals)
```

### Step 11.3: Keep the Terminal Open

The bot runs in the foreground. Keep the Terminal window open while the bot is running.

### Step 11.4: Stop the Bot

Press `Ctrl + C` in the Terminal to stop the bot gracefully.

---

## 12. Run the Bot in Production Mode

Production mode compiles TypeScript to JavaScript for better performance.

### Step 12.1: Build the Project

```bash
npm run build
```

This compiles TypeScript files from `src/` into JavaScript files in `dist/`.

### Step 12.2: Start the Bot

```bash
npm start
```

### Step 12.3: Run in Background (Optional)

To keep the bot running after closing Terminal, use a process manager like `pm2`:

#### Install pm2 globally:

```bash
npm install -g pm2
```

#### Start the bot with pm2:

```bash
pm2 start dist/index.js --name polymarketbot
```

#### Useful pm2 commands:

```bash
pm2 status              # Check bot status
pm2 logs polymarketbot  # View logs
pm2 stop polymarketbot  # Stop the bot
pm2 restart polymarketbot  # Restart the bot
pm2 delete polymarketbot   # Remove from pm2
```

---

## 13. Access the Admin Dashboard

### Step 13.1: Open Your Browser

Navigate to:

```
http://localhost:3000/admin
```

### Step 13.2: Dashboard Features

The admin dashboard provides:
- **Real-time trading statistics** via WebSocket
- **Trade history** and PnL (Profit and Loss) tracking
- **Trading mode toggle** (Paper/Live)
- **System status** information

### Step 13.3: Admin API Authentication

To access protected API endpoints, you need to provide your `ADMIN_SECRET`:

- Via header: `X-Admin-Secret: your_admin_secret`
- Via query parameter: `?secret=your_admin_secret`

---

## 14. Optional: Docker Setup

Docker provides a containerized environment for running the bot.

### Step 14.1: Install Docker Desktop

1. Download Docker Desktop for Mac from [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop).
2. Open the downloaded `.dmg` file.
3. Drag Docker to the Applications folder.
4. Open Docker from Applications.
5. Follow the setup wizard and grant necessary permissions.

### Step 14.2: Verify Docker Installation

```bash
docker --version
```

You should see output like `Docker version 27.x.x`.

### Step 14.3: Build the Docker Image

From the project root directory:

```bash
npm run docker:build
```

Or manually:

```bash
docker build -t polymarket-bot .
```

### Step 14.4: Run the Docker Container

```bash
npm run docker:run
```

Or manually:

```bash
docker run -p 3000:3000 --env-file .env polymarket-bot
```

### Step 14.5: Access the Admin Dashboard

Navigate to `http://localhost:3000/admin` in your browser.

### Step 14.6: Stop the Docker Container

Find the container ID:

```bash
docker ps
```

Stop the container:

```bash
docker stop <container_id>
```

---

## 15. Troubleshooting

### Issue: "Command not found: node"

**Cause:** Node.js is not installed or not in your PATH.

**Solution:**
1. Verify Node.js is installed: `which node`
2. If using nvm, ensure it's loaded: `source ~/.zshrc`
3. Reinstall Node.js following Step 3.

---

### Issue: "npm ERR! ERESOLVE could not resolve"

**Cause:** Dependency version conflicts.

**Solution:**
```bash
rm -rf node_modules package-lock.json
npm install
```

---

### Issue: "Error: Cannot find module 'typescript'"

**Cause:** Dependencies not installed properly.

**Solution:**
```bash
npm install
```

---

### Issue: "EACCES: permission denied"

**Cause:** npm trying to write to a directory without proper permissions.

**Solution:**
```bash
sudo chown -R $(whoami) ~/.npm
```

---

### Issue: "Error: Invalid API credentials"

**Cause:** Incorrect CLOB API credentials in `.env`.

**Solution:**
1. Verify your API key, secret, and passphrase are correct.
2. Ensure there are no extra spaces or quotes around the values.
3. Check that the credentials haven't expired.

---

### Issue: "Error: Invalid private key"

**Cause:** The private key format is incorrect.

**Solution:**
1. Ensure the private key is exactly 64 hexadecimal characters.
2. Remove any `0x` prefix if present.
3. Verify there are no spaces or newlines in the key.

---

### Issue: Port 3000 is already in use

**Cause:** Another application is using port 3000.

**Solution:**
1. Find the process using port 3000:
   ```bash
   lsof -i :3000
   ```
2. Stop the other process, or change the `PORT` in `.env`:
   ```bash
   PORT=3001
   ```

---

### Issue: "Error: ENOTFOUND" or network errors

**Cause:** Network connectivity issues.

**Solution:**
1. Check your internet connection.
2. Verify the Polymarket API URLs are correct.
3. Check if a VPN or firewall is blocking connections.

---

### Issue: TypeScript compilation errors

**Cause:** Incompatible TypeScript or type definition versions.

**Solution:**
```bash
rm -rf node_modules package-lock.json dist
npm install
npm run build
```

---

### Issue: Docker build fails

**Cause:** Docker daemon not running or build context issues.

**Solution:**
1. Ensure Docker Desktop is running.
2. Try clearing Docker cache:
   ```bash
   docker system prune -a
   ```
3. Rebuild:
   ```bash
   docker build --no-cache -t polymarket-bot .
   ```

---

### Issue: "Fatal error: JavaScript heap out of memory"

**Cause:** Node.js running out of memory during build or execution.

**Solution:**
Increase Node.js memory limit:
```bash
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

---

## Additional Resources

- **Polymarket Documentation**: [https://docs.polymarket.com](https://docs.polymarket.com)
- **Node.js Documentation**: [https://nodejs.org/docs](https://nodejs.org/docs)
- **Polygon Documentation**: [https://polygon.technology/developers](https://polygon.technology/developers)
- **Project Architecture**: [Architecture.md](Architecture.md)

---

## Security Reminders

1. **Never share your private key or API credentials.**
2. **Never commit the `.env` file to Git.**
3. **Use paper trading mode first** to test strategies without risking real funds.
4. **Start with small position sizes** when switching to live trading.
5. **Monitor the bot regularly** to ensure it's functioning correctly.
6. **Keep your dependencies updated** to patch security vulnerabilities.

---

## Support

If you encounter issues not covered in this guide:

1. Check the [README.md](../README.md) for additional information.
2. Review the [Architecture.md](Architecture.md) for technical details.
3. Open an issue on the GitHub repository with a detailed description of your problem.
