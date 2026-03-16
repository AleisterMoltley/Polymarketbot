/**
 * wallet.js — Simplified Wallet Management for Polymarket on Polygon (CommonJS)
 *
 * Provides a lightweight interface for loading and using an Ethers.js wallet
 * from environment variables. Compatible only with Polygon RPC for Polymarket
 * trading. Includes periodic balance checks for trading decisions.
 */
"use strict";

require("dotenv").config();
const { ethers } = require("ethers");

// 5-minute interval for balance checks (in milliseconds)
const BALANCE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Cached wallet instance
let _wallet = null;

// Balance check state (singleton: only one balance check loop runs at a time)
let _balanceCheckInterval = null;
let _lastBalance = null;
let _balanceCallback = null;

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

/**
 * Start periodic balance checks every 5 minutes for trading decisions.
 * This is a singleton; only one balance check loop runs at a time.
 * @param {Function} callback - Called with (balance, address) after each check.
 *                              Called with (null, null, error) on failure.
 * @returns {boolean} true if checks were started, false if already running
 */
function startBalanceChecks(callback) {
  if (_balanceCheckInterval) return false;

  _balanceCallback = callback;

  const checkBalance = async () => {
    try {
      const balance = await getBalance();
      const address = getAddress();
      _lastBalance = balance;
      if (_balanceCallback) {
        _balanceCallback(balance, address);
      }
    } catch (error) {
      if (_balanceCallback) {
        _balanceCallback(null, null, error);
      }
    }
  };

  // Run immediately, then every 5 minutes
  // Any errors from checkBalance are passed to the callback; the empty catch
  // prevents unhandled promise rejection warnings in the console
  checkBalance().catch(() => {});
  _balanceCheckInterval = setInterval(checkBalance, BALANCE_CHECK_INTERVAL_MS);
  return true;
}

/**
 * Stop periodic balance checks.
 * @returns {void}
 */
function stopBalanceChecks() {
  if (_balanceCheckInterval) {
    clearInterval(_balanceCheckInterval);
    _balanceCheckInterval = null;
    _balanceCallback = null;
  }
}

/**
 * Get the last checked balance (from periodic checks).
 * @returns {string|null}
 */
function getLastBalance() {
  return _lastBalance;
}

module.exports = {
  loadWallet,
  getAddress,
  getBalance,
  startBalanceChecks,
  stopBalanceChecks,
  getLastBalance,
};
