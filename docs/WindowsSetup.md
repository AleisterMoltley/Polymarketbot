# Polymarketbot Windows Setup Guide

A comprehensive step-by-step guide to set up and run Polymarketbot on Windows.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Install a Package Manager](#2-install-a-package-manager)
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
16. [Update GitHub with Your Files](#16-update-github-with-your-files)

---

## 1. Prerequisites

Before you begin, ensure you have the following:

- **Windows 10** (version 1809 or later) or **Windows 11**
- **Administrator access** to your PC (required for installing software)
- **Internet connection** (required for downloading packages and API access)
- A **Polymarket account** (you will create one if you don't have it)
- A **Polygon-compatible wallet** (e.g., MetaMask)

---

## 2. Install a Package Manager

A package manager simplifies installing and managing software on Windows. We recommend using **winget** (Windows Package Manager) which is pre-installed on Windows 11 and recent Windows 10 versions.

### Step 2.1: Open PowerShell as Administrator

1. Press `Win + X` to open the Power User menu.
2. Click **"Windows Terminal (Admin)"** or **"PowerShell (Admin)"**.
3. If prompted by User Account Control (UAC), click **"Yes"**.

### Step 2.2: Verify winget is Installed

```powershell
winget --version
```

If winget is installed, you'll see output like `v1.x.xxxxx`.

### Step 2.3: If winget is Not Available

If winget is not installed, you can install it by:

1. Open the Microsoft Store app.
2. Search for **"App Installer"**.
3. Install or update the **App Installer** package.

Alternatively, download the latest release from:
[https://github.com/microsoft/winget-cli/releases](https://github.com/microsoft/winget-cli/releases)

### Alternative: Install Chocolatey

If you prefer Chocolatey as your package manager:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
```

Verify the installation:

```powershell
choco --version
```

---

## 3. Install Node.js 25+

This project requires Node.js version 25 or higher.

### Step 3.1: Install Node.js Using winget

```powershell
winget install OpenJS.NodeJS
```

If Node.js 25 is not yet available via winget, you can download it directly or use nvm-windows.

### Alternative: Install Node.js Using nvm-windows

nvm-windows (Node Version Manager for Windows) allows you to manage multiple Node.js versions.

#### Step 3.1a: Install nvm-windows

```powershell
winget install CoreyButler.NVMforWindows
```

Or download manually from:
[https://github.com/coreybutler/nvm-windows/releases](https://github.com/coreybutler/nvm-windows/releases)

#### Step 3.1b: Close and Reopen PowerShell

After installing nvm-windows, close PowerShell and reopen it as Administrator for the changes to take effect.

#### Step 3.1c: Install Node.js 25

```powershell
nvm install 25
nvm use 25
```

### Alternative: Direct Download

1. Visit [https://nodejs.org/en/download](https://nodejs.org/en/download).
2. Download the Windows Installer (.msi) for Node.js 25.x (Current).
3. Run the installer and follow the prompts.
4. Select the default options and ensure "Add to PATH" is checked.

### Step 3.2: Verify Node.js Installation

Open a **new** PowerShell or Command Prompt window:

```powershell
node --version
```

You should see output like `v25.x.x`.

### Step 3.3: Verify npm Installation

npm (Node Package Manager) is installed automatically with Node.js.

```powershell
npm --version
```

You should see output like `10.x.x` or higher.

---

## 4. Install Git

Git is required to clone the repository.

### Step 4.1: Check if Git is Already Installed

```powershell
git --version
```

If Git is installed, you'll see output like `git version 2.x.x.windows.x`. If not, continue to the next step.

### Step 4.2: Install Git Using winget

```powershell
winget install Git.Git
```

### Alternative: Install Git Using Chocolatey

```powershell
choco install git -y
```

### Alternative: Direct Download

1. Visit [https://git-scm.com/download/win](https://git-scm.com/download/win).
2. Download the installer for Windows.
3. Run the installer and follow the prompts.
4. Recommended: Accept the default settings during installation.

### Step 4.3: Restart PowerShell

Close and reopen PowerShell to ensure Git is in your PATH.

### Step 4.4: Verify Git Installation

```powershell
git --version
```

### Step 4.5: Configure Git (First-Time Setup)

Set your name and email for Git commits:

```powershell
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

---

## 5. Clone the Repository

### Step 5.1: Choose a Directory

Navigate to the directory where you want to store the project. For example, to use your user directory:

```powershell
cd $HOME
```

Or create a dedicated projects folder:

```powershell
mkdir Projects
cd Projects
```

### Step 5.2: Clone the Repository

```powershell
git clone https://github.com/AleisterMoltley/Polymarketbot.git
```

### Step 5.3: Navigate to the Project Directory

```powershell
cd Polymarketbot
```

### Step 5.4: Verify the Clone

```powershell
dir
```

You should see files like `package.json`, `tsconfig.json`, `src/`, `docs/`, etc.

---

## 6. Install Project Dependencies

### Step 6.1: Install npm Dependencies

From the project root directory, run:

```powershell
npm install
```

This command:
- Reads `package.json` to determine required packages
- Downloads and installs all dependencies into the `node_modules/` folder
- May take 1-3 minutes depending on your internet speed

### Step 6.2: Verify Installation

Check that there are no critical errors. Warnings are generally acceptable.

You can verify the TypeScript compiler is available:

```powershell
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

**Using PowerShell:**

```powershell
Copy-Item .env.example .env
```

**Using Command Prompt:**

```cmd
copy .env.example .env
```

### Step 10.2: Open the Environment File for Editing

**Using Notepad:**

```powershell
notepad .env
```

**Using Visual Studio Code (if installed):**

```powershell
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

- In Notepad: Press `Ctrl + S` to save, then `Alt + F4` to close.
- In VS Code: Press `Ctrl + S` to save, then close the file.

### Step 10.5: Verify the Environment File is Not Tracked by Git

The `.env` file should already be listed in `.gitignore`. Verify:

```powershell
Get-Content .gitignore | Select-String ".env"
```

You should see `.env` listed. This ensures your credentials are never committed to Git.

---

## 11. Run the Bot in Development Mode

Development mode uses `ts-node` for hot reloading and easier debugging.

### Step 11.1: Start the Bot

From the project root directory:

```powershell
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

The bot runs in the foreground. Keep the PowerShell window open while the bot is running.

### Step 11.4: Stop the Bot

Press `Ctrl + C` in PowerShell to stop the bot gracefully.

---

## 12. Run the Bot in Production Mode

Production mode compiles TypeScript to JavaScript for better performance.

### Step 12.1: Build the Project

```powershell
npm run build
```

This compiles TypeScript files from `src/` into JavaScript files in `dist/`.

### Step 12.2: Start the Bot

```powershell
npm start
```

### Step 12.3: Run in Background (Optional)

To keep the bot running after closing PowerShell, use a process manager like `pm2`:

#### Install pm2 globally:

```powershell
npm install -g pm2
```

#### Start the bot with pm2:

```powershell
pm2 start dist/index.js --name polymarketbot
```

#### Useful pm2 commands:

```powershell
pm2 status              # Check bot status
pm2 logs polymarketbot  # View logs
pm2 stop polymarketbot  # Stop the bot
pm2 restart polymarketbot  # Restart the bot
pm2 delete polymarketbot   # Remove from pm2
```

### Step 12.4: Run as a Windows Service (Alternative)

For a more robust solution on Windows, you can use **NSSM** (Non-Sucking Service Manager):

#### Install NSSM:

```powershell
winget install NSSM.NSSM
```

Or download from: [https://nssm.cc/download](https://nssm.cc/download)

#### Create a Windows Service:

```powershell
nssm install polymarketbot "C:\Program Files\nodejs\node.exe" "C:\path\to\Polymarketbot\dist\index.js"
nssm set polymarketbot AppDirectory "C:\path\to\Polymarketbot"
nssm start polymarketbot
```

Replace `C:\path\to\Polymarketbot` with the actual path to your project.

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

### Step 14.1: Install Docker Desktop for Windows

1. Download Docker Desktop for Windows from [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop).
2. Run the downloaded installer.
3. Follow the setup wizard:
   - Enable **WSL 2** when prompted (recommended).
   - If prompted to install WSL 2, follow the instructions.
4. Restart your computer if required.
5. Open Docker Desktop from the Start menu.

### Step 14.2: Verify Docker Installation

```powershell
docker --version
```

You should see output like `Docker version 27.x.x`.

### Step 14.3: Enable WSL 2 Backend (Recommended)

Docker Desktop uses WSL 2 (Windows Subsystem for Linux 2) for better performance:

1. Open Docker Desktop settings.
2. Go to **General**.
3. Ensure **"Use the WSL 2 based engine"** is checked.
4. Click **Apply & Restart**.

### Step 14.4: Build the Docker Image

From the project root directory:

```powershell
npm run docker:build
```

Or manually:

```powershell
docker build -t polymarket-bot .
```

### Step 14.5: Run the Docker Container

```powershell
npm run docker:run
```

Or manually:

```powershell
docker run -p 3000:3000 --env-file .env polymarket-bot
```

### Step 14.6: Access the Admin Dashboard

Navigate to `http://localhost:3000/admin` in your browser.

### Step 14.7: Stop the Docker Container

Find the container ID:

```powershell
docker ps
```

Stop the container:

```powershell
docker stop <container_id>
```

---

## 15. Troubleshooting

### Issue: "node is not recognized as an internal or external command"

**Cause:** Node.js is not installed or not in your PATH.

**Solution:**
1. Verify Node.js is installed by checking Add/Remove Programs.
2. If using nvm-windows, run `nvm use 25` in a new PowerShell window.
3. Close and reopen PowerShell or Command Prompt.
4. Reinstall Node.js following Step 3.

---

### Issue: "npm ERR! ERESOLVE could not resolve"

**Cause:** Dependency version conflicts.

**Solution:**
```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
```

---

### Issue: "Error: Cannot find module 'typescript'"

**Cause:** Dependencies not installed properly.

**Solution:**
```powershell
npm install
```

---

### Issue: "EPERM: operation not permitted"

**Cause:** Windows file permissions or antivirus interference.

**Solution:**
1. Run PowerShell as Administrator.
2. Temporarily disable your antivirus.
3. Ensure the project folder is not in a protected location (e.g., `C:\Program Files`).
4. Delete node_modules and reinstall:
   ```powershell
   Remove-Item -Recurse -Force node_modules
   npm install
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
   ```powershell
   netstat -ano | findstr :3000
   ```
2. The last column shows the PID. To find the process name:
   ```powershell
   tasklist | findstr <PID>
   ```
3. Stop the other process, or change the `PORT` in `.env`:
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
4. Try temporarily disabling Windows Firewall for testing.

---

### Issue: TypeScript compilation errors

**Cause:** Incompatible TypeScript or type definition versions.

**Solution:**
```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
npm install
npm run build
```

---

### Issue: Docker build fails

**Cause:** Docker daemon not running or WSL issues.

**Solution:**
1. Ensure Docker Desktop is running (check the system tray).
2. Restart Docker Desktop.
3. Try clearing Docker cache:
   ```powershell
   docker system prune -a
   ```
4. Rebuild:
   ```powershell
   docker build --no-cache -t polymarket-bot .
   ```

---

### Issue: WSL 2 installation required

**Cause:** Docker Desktop requires WSL 2 on Windows.

**Solution:**
1. Open PowerShell as Administrator.
2. Install WSL:
   ```powershell
   wsl --install
   ```
3. Restart your computer.
4. Open Docker Desktop and enable WSL 2 backend.

---

### Issue: "Fatal error: JavaScript heap out of memory"

**Cause:** Node.js running out of memory during build or execution.

**Solution:**
Set the Node.js memory limit before running commands:

**PowerShell:**
```powershell
$env:NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

**Command Prompt:**
```cmd
set NODE_OPTIONS=--max-old-space-size=4096
npm run build
```

---

### Issue: Long file paths cause errors

**Cause:** Windows has a default path length limit of 260 characters.

**Solution:**
Enable long paths in Windows:

1. Open PowerShell as Administrator.
2. Run:
   ```powershell
   New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
   ```
3. Restart your computer.

---

### Issue: npm commands are slow

**Cause:** Windows Defender scanning node_modules.

**Solution:**
Exclude the project folder from Windows Defender:

1. Open **Windows Security**.
2. Go to **Virus & threat protection** → **Manage settings**.
3. Scroll to **Exclusions** → **Add or remove exclusions**.
4. Add the Polymarketbot folder and `%APPDATA%\npm`.

---

## Additional Resources

- **Polymarket Documentation**: [https://docs.polymarket.com](https://docs.polymarket.com)
- **Node.js Documentation**: [https://nodejs.org/docs](https://nodejs.org/docs)
- **Polygon Documentation**: [https://polygon.technology/developers](https://polygon.technology/developers)
- **Project Architecture**: [Architecture.md](Architecture.md)
- **Mac Setup Guide**: [MacSetup.md](MacSetup.md)

---

## Security Reminders

1. **Never share your private key or API credentials.**
2. **Never commit the `.env` file to Git.**
3. **Use paper trading mode first** to test strategies without risking real funds.
4. **Start with small position sizes** when switching to live trading.
5. **Monitor the bot regularly** to ensure it's functioning correctly.
6. **Keep your dependencies updated** to patch security vulnerabilities.

---

## 16. Update GitHub with Your Files

If you have made changes to the code on your Windows PC and want to save (push) those changes to GitHub, follow the steps below.

### Step 16.1: Open PowerShell and Navigate to Your Project

```powershell
cd $HOME\Polymarketbot
```

> Replace `$HOME\Polymarketbot` with your actual installation path if different.

### Step 16.2: Check What Has Changed

See which files you have modified:

```powershell
git status
```

### Step 16.3: Stage Your Changes

To stage all changed files:

```powershell
git add .
```

To stage only specific files:

```powershell
git add src/bot/trading.ts
```

### Step 16.4: Commit Your Changes

Write a short message describing what you changed:

```powershell
git commit -m "Describe what you changed"
```

### Step 16.5: Push to GitHub

```powershell
git push origin main
```

After this command completes, your files will be updated on GitHub.

> **First-time push:** GitHub may prompt for your username and a [Personal Access Token (PAT)](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens). Use a PAT instead of your GitHub password.

### Important Notes

- **Never commit your `.env` file** — it contains private keys and API secrets. It is already excluded via `.gitignore`.
- If you see `error: failed to push some refs`, run `git pull origin main` first to merge any upstream changes, then push again.

---

## Support

If you encounter issues not covered in this guide:

1. Check the [README.md](../README.md) for additional information.
2. Review the [Architecture.md](Architecture.md) for technical details.
3. Open an issue on the GitHub repository with a detailed description of your problem.
