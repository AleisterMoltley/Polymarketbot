import { ethers, JsonRpcProvider, Wallet } from "ethers";

let _wallet: Wallet | null = null;

/**
 * Initialise and return the Ethers Wallet derived from PRIVATE_KEY.
 * A JSON-RPC provider is attached when POLYGON_RPC_URL is set.
 */
export function getWallet(): Wallet {
  if (_wallet) return _wallet;

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY is not set in environment variables.");
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
 * Automatically swap USDC to MATIC on Polygon.
 * @param amountUSDC - The amount of USDC to swap (e.g., 100 for 100 USDC)
 * @returns The transaction hash of the swap
 */
export async function autoSwapUSDCtoMATIC(amountUSDC: number): Promise<string> {
  const { executeSwap } = await import("../bot/swaps");
  console.log(`[wallet] Initiating swap of ${amountUSDC} USDC to MATIC...`);
  const txHash = await executeSwap("USDC", "MATIC", amountUSDC.toString());
  console.log(`[wallet] Swap complete. Transaction hash: ${txHash}`);
  return txHash;
}
