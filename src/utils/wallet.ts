import { ethers, JsonRpcProvider, Wallet, Contract } from "ethers";
import { decrypt, isEncryptedKey } from "./crypto";

let _wallet: Wallet | null = null;

// Well-known Polygon token addresses
const TOKEN_ADDRESSES: Record<string, { address: string; decimals: number }> = {
  USDC: { address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", decimals: 6 },
  WETH: { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18 },
  MATIC: { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18 }, // Native token
};

// Minimal ERC20 ABI for balance checking
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

/**
 * Initialise and return the Ethers Wallet derived from PRIVATE_KEY.
 * Supports both raw private keys and encrypted keys.
 * A JSON-RPC provider is attached when POLYGON_RPC_URL is set.
 * 
 * For encrypted keys:
 * - Set PRIVATE_KEY_ENCRYPTED with the encrypted key
 * - Set KEY_PASSWORD or ENCRYPTION_PASSWORD with the decryption password
 */
export function getWallet(): Wallet {
  if (_wallet) return _wallet;

  let privateKey = process.env.PRIVATE_KEY;
  const encryptedKey = process.env.PRIVATE_KEY_ENCRYPTED;
  
  // Handle encrypted key
  if (encryptedKey) {
    const password = process.env.KEY_PASSWORD ?? process.env.ENCRYPTION_PASSWORD;
    if (!password) {
      throw new Error(
        "PRIVATE_KEY_ENCRYPTED is set but KEY_PASSWORD or ENCRYPTION_PASSWORD is missing."
      );
    }
    
    try {
      console.log("[wallet] Decrypting private key...");
      privateKey = decrypt(encryptedKey, password);
      console.log("[wallet] Private key decrypted successfully");
    } catch (err) {
      throw new Error(`Failed to decrypt private key: ${(err as Error).message}`);
    }
  }

  // Check if the provided key is actually encrypted (user mistake)
  if (privateKey && isEncryptedKey(privateKey)) {
    const password = process.env.KEY_PASSWORD ?? process.env.ENCRYPTION_PASSWORD;
    if (password) {
      try {
        console.log("[wallet] PRIVATE_KEY appears to be encrypted, decrypting...");
        privateKey = decrypt(privateKey, password);
        console.log("[wallet] Private key decrypted successfully");
      } catch (err) {
        throw new Error(
          `PRIVATE_KEY appears to be encrypted but decryption failed. ` +
          `Either provide the correct password or use a raw private key.`
        );
      }
    } else {
      throw new Error(
        "PRIVATE_KEY appears to be encrypted. " +
        "Set KEY_PASSWORD to decrypt it, or provide a raw private key."
      );
    }
  }

  if (!privateKey) {
    throw new Error("PRIVATE_KEY or PRIVATE_KEY_ENCRYPTED is not set in environment variables.");
  }

  // Validate private key format
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("PRIVATE_KEY must be a valid 64-character hexadecimal string.");
  }

  const rpcUrl = process.env.POLYGON_RPC_URL;
  if (rpcUrl) {
    const provider = new JsonRpcProvider(rpcUrl);
    _wallet = new Wallet(privateKey, provider);
  } else {
    _wallet = new Wallet(privateKey);
  }

  return _wallet;
}

/** Return the checksummed public address of the loaded wallet. */
export function getAddress(): string {
  return getWallet().address;
}

/** Sign an arbitrary message with the loaded wallet. */
export async function signMessage(message: string): Promise<string> {
  return getWallet().signMessage(message);
}

/** Return the MATIC balance of the wallet (in Ether units). */
export async function getBalance(): Promise<string> {
  const wallet = getWallet();
  if (!wallet.provider) {
    throw new Error("No provider attached to wallet — set POLYGON_RPC_URL.");
  }
  const balance = await wallet.provider.getBalance(wallet.address);
  return ethers.formatEther(balance);
}

/**
 * Return the balance of a specific token (e.g., USDC, WETH) in human-readable units.
 * @param token - The token symbol (e.g., "USDC", "WETH", "MATIC")
 * @returns The balance as a formatted string
 */
export async function getTokenBalance(token: string): Promise<string> {
  const wallet = getWallet();
  if (!wallet.provider) {
    throw new Error("No provider attached to wallet — set POLYGON_RPC_URL.");
  }

  const upperToken = token.toUpperCase();

  // For native MATIC, use getBalance
  if (upperToken === "MATIC") {
    return getBalance();
  }

  const tokenInfo = TOKEN_ADDRESSES[upperToken];
  if (!tokenInfo) {
    throw new Error(`Unknown token: ${token}. Supported: ${Object.keys(TOKEN_ADDRESSES).join(", ")}`);
  }

  const contract = new Contract(tokenInfo.address, ERC20_ABI, wallet.provider);
  const balance = await contract.balanceOf(wallet.address);
  return ethers.formatUnits(balance, tokenInfo.decimals);
}

/**
 * Validate that the wallet has sufficient balance for a trade.
 * @param token - The token symbol (e.g., "USDC")
 * @param amount - The required amount in human-readable units
 * @returns true if balance is sufficient
 */
export async function hasEnoughBalance(token: string, amount: number): Promise<boolean> {
  try {
    const balance = await getTokenBalance(token);
    return parseFloat(balance) >= amount;
  } catch {
    return false;
  }
}
