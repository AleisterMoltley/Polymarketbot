/**
 * wallet.js — Simplified Wallet Management for Polymarket on Polygon (CommonJS)
 *
 * Provides a lightweight interface for loading and using an Ethers.js wallet
 * from environment variables. Compatible with ethers ^6.16.0 and Polygon RPC
 * for Polymarket trading. Optimized for 5-minute paper trading with on-demand
 * balance checks (periodic balance polling removed as unused).
 */
"use strict";

require("dotenv").config();
const { ethers } = require("ethers");

// Cached wallet instance
let _wallet = null;

/**
 * Load an Ethers Wallet from PRIVATE_KEY with Polygon RPC provider.
 * Requires both PRIVATE_KEY and POLYGON_RPC_URL environment variables.
 * @returns {ethers.Wallet}
 */
function loadWallet() {
  if (_wallet) return _wallet;

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY environment variable is required");
  }

  const rpcUrl = process.env.POLYGON_RPC_URL;
  if (!rpcUrl) {
    throw new Error("POLYGON_RPC_URL environment variable is required");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  _wallet = new ethers.Wallet(privateKey, provider);
  return _wallet;
}

/**
 * Return the checksummed address of the loaded wallet.
 * @returns {string}
 */
function getAddress() {
  return loadWallet().address;
}

/**
 * Return the native token balance (MATIC) of the wallet in Ether units.
 * @returns {Promise<string>}
 */
async function getBalance() {
  const wallet = loadWallet();
  const balance = await wallet.provider.getBalance(wallet.address);
  return ethers.formatEther(balance);
}

module.exports = {
  loadWallet,
  getAddress,
  getBalance,
};
