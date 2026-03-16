import axios from "axios";
import { ethers } from "ethers";
import { getWallet } from "../utils/wallet";

/** Supported token symbols on Polygon. */
export type TokenSymbol = "MATIC" | "USDC" | "WETH";

/** Minimal representation of a swap quote. */
export interface SwapQuote {
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  amountIn: string;
  amountOut: string;
  priceImpact: number;
  route: string;
}

// Well-known Polygon token addresses
const TOKEN_ADDRESSES: Record<TokenSymbol, string> = {
  MATIC: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
};

const PARASWAP_API = "https://apiv5.paraswap.io";

/**
 * Fetch a swap quote from Paraswap for the given token pair and amount.
 * Amount should be provided in human-readable units (e.g. "10" for 10 USDC).
 */
export async function getSwapQuote(
  tokenIn: TokenSymbol,
  tokenOut: TokenSymbol,
  amountIn: string
): Promise<SwapQuote> {
  const decimals: Record<TokenSymbol, number> = { MATIC: 18, USDC: 6, WETH: 18 };
  const srcDecimals = decimals[tokenIn];
  const destDecimals = decimals[tokenOut];

  const amountInWei = ethers.parseUnits(amountIn, srcDecimals).toString();

  const { data } = await axios.get(`${PARASWAP_API}/prices`, {
    params: {
      srcToken: TOKEN_ADDRESSES[tokenIn],
      destToken: TOKEN_ADDRESSES[tokenOut],
      amount: amountInWei,
      srcDecimals,
      destDecimals,
      network: 137,
    },
    timeout: 10_000,
  });

  const priceRoute = data.priceRoute;
  const amountOut = ethers.formatUnits(priceRoute.destAmount, destDecimals);

  return {
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    priceImpact: priceRoute.percentChange ?? 0,
    route: priceRoute.bestRoute?.[0]?.swaps?.[0]?.swapExchanges?.[0]?.exchange ?? "unknown",
  };
}

/**
 * Execute a swap on Paraswap.
 * Builds the transaction data via the Paraswap transactions endpoint and
 * broadcasts it using the loaded wallet.
 *
 * @returns the transaction hash
 */
export async function executeSwap(
  tokenIn: TokenSymbol,
  tokenOut: TokenSymbol,
  amountIn: string
): Promise<string> {
  const wallet = getWallet();

  const quote = await getSwapQuote(tokenIn, tokenOut, amountIn);
  console.log(
    `[swaps] Quote: ${quote.amountIn} ${tokenIn} → ${quote.amountOut} ${tokenOut} (impact: ${quote.priceImpact}%)`
  );

  const decimals: Record<TokenSymbol, number> = { MATIC: 18, USDC: 6, WETH: 18 };
  const srcDecimals = decimals[tokenIn];
  const destDecimals = decimals[tokenOut];

  const amountInWei = ethers.parseUnits(amountIn, srcDecimals).toString();

  // Re-fetch price route to get the full object needed for transaction building
  const { data: priceData } = await axios.get(`${PARASWAP_API}/prices`, {
    params: {
      srcToken: TOKEN_ADDRESSES[tokenIn],
      destToken: TOKEN_ADDRESSES[tokenOut],
      amount: amountInWei,
      srcDecimals,
      destDecimals,
      network: 137,
    },
    timeout: 10_000,
  });

  const { data: txData } = await axios.post(
    `${PARASWAP_API}/transactions/137`,
    {
      srcToken: TOKEN_ADDRESSES[tokenIn],
      destToken: TOKEN_ADDRESSES[tokenOut],
      srcAmount: amountInWei,
      destAmount: priceData.priceRoute.destAmount,
      priceRoute: priceData.priceRoute,
      userAddress: wallet.address,
      partner: "polymarketbot",
    },
    { timeout: 10_000 }
  );

  const tx = await wallet.sendTransaction({
    to: txData.to,
    data: txData.data,
    value: txData.value ? BigInt(txData.value) : undefined,
    gasLimit: txData.gas ? BigInt(txData.gas) : undefined,
  });

  console.log(`[swaps] Transaction sent: ${tx.hash}`);
  await tx.wait();
  console.log(`[swaps] Transaction confirmed: ${tx.hash}`);
  return tx.hash;
}
