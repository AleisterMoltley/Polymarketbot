/**
 * wallet.js — Wallet management helper (CommonJS)
 *
 * Provides a lightweight interface for loading and using an Ethers.js wallet
 * from environment variables. Used by scripts that run outside the compiled
 * TypeScript build (e.g. one-off CLI utilities, Dockerfile HEALTHCHECK).
 */
"use strict";

require("dotenv").config();
const { ethers } = require("ethers");

/**
 * Load an Ethers Wallet from PRIVATE_KEY.
 * Attaches a JSON-RPC provider when POLYGON_RPC_URL is set.
 *
 * @returns {ethers.Wallet}
 */
function loadWallet() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY is not set in the environment.");
  }

  const rpcUrl = process.env.POLYGON_RPC_URL;
  if (rpcUrl) {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    return new ethers.Wallet(privateKey, provider);
  }

  return new ethers.Wallet(privateKey);
}

/**
 * Return the checksummed address of the loaded wallet.
 *
 * @returns {string}
 */
function getAddress() {
  return loadWallet().address;
}

/**
 * Return the native token balance of the wallet.
 *
 * @returns {Promise<string>}
 */
async function getBalance() {
  const wallet = loadWallet();
  if (!wallet.provider) {
    throw new Error("No provider — set POLYGON_RPC_URL.");
  }
  const balance = await wallet.provider.getBalance(wallet.address);
  return ethers.formatEther(balance);
}

module.exports = { loadWallet, getAddress, getBalance };

// ── CLI usage: `node wallet.js` ───────────────────────────────────────────
if (require.main === module) {
  (async () => {
    try {
      const addr = getAddress();
      console.log("Wallet address:", addr);
      const bal = await getBalance();
      console.log("Native balance:", bal);
    } catch (err) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  })();
}
