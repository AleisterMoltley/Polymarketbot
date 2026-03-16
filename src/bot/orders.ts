import { ClobClient, Side, Chain, ClobSigner } from "@polymarket/clob-client";
import { getWallet } from "../utils/wallet";
import type { Wallet } from "ethers";

/**
 * Adapter to make ethers v6 Wallet compatible with ClobClient's expected signer.
 * ClobClient expects `_signTypedData` (ethers v5 style) but ethers v6 uses `signTypedData`.
 */
function createClobSigner(wallet: Wallet): ClobSigner {
  return {
    _signTypedData: (
      domain: Record<string, unknown>,
      types: Record<string, Array<{ name: string; type: string }>>,
      value: Record<string, unknown>
    ): Promise<string> => {
      return wallet.signTypedData(
        domain as Parameters<Wallet["signTypedData"]>[0],
        types as Parameters<Wallet["signTypedData"]>[1],
        value as Parameters<Wallet["signTypedData"]>[2]
      );
    },
    getAddress: (): Promise<string> => {
      return Promise.resolve(wallet.address);
    },
  };
}

let _client: ClobClient | null = null;

/**
 * Initialize and return the ClobClient instance.
 * Uses CLOB_API credentials from environment variables.
 */
function getClient(): ClobClient {
  if (_client) return _client;

  const host = process.env.CLOB_API_URL ?? "https://clob.polymarket.com";
  const chainId = parseInt(process.env.CHAIN_ID ?? "137", 10) as Chain;

  const apiKey = process.env.CLOB_API_KEY;
  const apiSecret = process.env.CLOB_API_SECRET;
  const passphrase = process.env.CLOB_API_PASSPHRASE;

  if (!apiKey || !apiSecret || !passphrase) {
    throw new Error(
      "CLOB_API_KEY, CLOB_API_SECRET, and CLOB_API_PASSPHRASE must be set in environment variables."
    );
  }

  const wallet = getWallet();
  const signer = createClobSigner(wallet);

  _client = new ClobClient(
    host,
    chainId,
    signer,
    {
      key: apiKey,
      secret: apiSecret,
      passphrase: passphrase,
    }
  );

  return _client;
}

/**
 * Place an order on the Polymarket CLOB.
 *
 * @param tokenId - The token ID for the conditional token asset
 * @param price - The order price
 * @param size - The order size in conditional token units
 * @param side - Order side: 'buy' or 'sell'
 * @returns The response from the CLOB API
 */
export async function placeOrder(
  tokenId: string,
  price: number,
  size: number,
  side: "buy" | "sell"
) {
  const client = getClient();
  const orderSide = side === "buy" ? Side.BUY : Side.SELL;

  const order = await client.createAndPostOrder({
    tokenID: tokenId,
    price,
    size,
    side: orderSide,
  });

  return order;
}

/**
 * Get all open orders for the authenticated user.
 *
 * @returns Array of open orders
 */
export async function getOpenOrders() {
  const client = getClient();
  return await client.getOpenOrders();
}
