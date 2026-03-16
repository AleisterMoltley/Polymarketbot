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

/** Options for executing a swap. */
export interface SwapOptions {
  /** Maximum allowed slippage as a decimal (e.g., 0.02 for 2%). Default: 0.02 */
  maxSlippage?: number;
  /** Maximum allowed price impact as a decimal. Default: 0.05 (5%) */
  maxPriceImpact?: number;
}

// Well-known Polygon token addresses
const TOKEN_ADDRESSES: Record<TokenSymbol, string> = {
  MATIC: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
};

const PARASWAP_API = "https://apiv5.paraswap.io";

// Default configuration
const DEFAULT_MAX_SLIPPAGE = 0.02; // 2%
const DEFAULT_MAX_PRICE_IMPACT = 0.05; // 5%
const BASIS_POINTS_DIVISOR = 10000;

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
 * Execute a swap on Paraswap with slippage protection.
 * Builds the transaction data via the Paraswap transactions endpoint and
 * broadcasts it using the loaded wallet.
 *
 * @param tokenIn - The source token symbol
 * @param tokenOut - The destination token symbol
 * @param amountIn - The amount to swap (in human-readable units)
 * @param options - Optional swap configuration (slippage, price impact limits)
 * @returns the transaction hash
 * @throws Error if price impact exceeds maxPriceImpact
 */
export async function executeSwap(
  tokenIn: TokenSymbol,
  tokenOut: TokenSymbol,
  amountIn: string,
  options: SwapOptions = {}
): Promise<string> {
  const { 
    maxSlippage = DEFAULT_MAX_SLIPPAGE, 
    maxPriceImpact = DEFAULT_MAX_PRICE_IMPACT 
  } = options;
  
  const wallet = getWallet();

  const quote = await getSwapQuote(tokenIn, tokenOut, amountIn);
  console.log(
    `[swaps] Quote: ${quote.amountIn} ${tokenIn} → ${quote.amountOut} ${tokenOut} (impact: ${quote.priceImpact}%)`
  );

  // Validate price impact
  const priceImpactDecimal = Math.abs(quote.priceImpact) / 100;
  if (priceImpactDecimal > maxPriceImpact) {
    throw new Error(
      `Price impact ${quote.priceImpact.toFixed(2)}% exceeds maximum allowed ${(maxPriceImpact * 100).toFixed(2)}%`
    );
  }

  const decimals: Record<TokenSymbol, number> = { MATIC: 18, USDC: 6, WETH: 18 };
  const srcDecimals = decimals[tokenIn];
  const destDecimals = decimals[tokenOut];

  const amountInWei = ethers.parseUnits(amountIn, srcDecimals).toString();

  // Fetch fresh price route for transaction building
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

  // Calculate minimum amount out with slippage tolerance
  const destAmount = BigInt(priceData.priceRoute.destAmount);
  const slippageBps = BigInt(Math.floor(maxSlippage * BASIS_POINTS_DIVISOR));
  const minDestAmount = destAmount - (destAmount * slippageBps) / BigInt(BASIS_POINTS_DIVISOR);

  console.log(
    `[swaps] Min output: ${ethers.formatUnits(minDestAmount, destDecimals)} ${tokenOut} (with ${(maxSlippage * 100).toFixed(1)}% slippage tolerance)`
  );

  const { data: txData } = await axios.post(
    `${PARASWAP_API}/transactions/137`,
    {
      srcToken: TOKEN_ADDRESSES[tokenIn],
      destToken: TOKEN_ADDRESSES[tokenOut],
      srcAmount: amountInWei,
      destAmount: minDestAmount.toString(), // Use minimum amount for slippage protection
      priceRoute: priceData.priceRoute,
      userAddress: wallet.address,
      partner: "polymarketbot",
      slippage: Math.floor(maxSlippage * BASIS_POINTS_DIVISOR), // Slippage in basis points
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
