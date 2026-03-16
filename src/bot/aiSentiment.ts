import axios from "axios";
import { getItem, setItem } from "../utils/jsonStore";
import { alertTrade, type TradeAlertData } from "../utils/telegram";
import type { Market } from "./trading";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SentimentSignal {
  id: string;
  market: string;
  sentiment: "bullish" | "bearish" | "neutral";
  confidence: number; // 0-1
  sources: string[];
  keywords: string[];
  timestamp: number;
  processed: boolean;
}

export interface SentimentConfig {
  enabled: boolean;
  minConfidence: number; // Minimum confidence to act (0-1)
  maxPositionSize: number;
  keywords: string[]; // Additional keywords to track
  sources: string[]; // Data sources to analyze
}

interface NewsItem {
  title: string;
  description: string;
  source: string;
  publishedAt: string;
  url: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const SIGNALS_KEY = "sentimentSignals";
const CONFIG_KEY = "sentimentConfig";

// Sentiment keywords (bullish/bearish indicators)
const BULLISH_KEYWORDS = [
  "surge", "soar", "jump", "rally", "gain", "win", "victory", "success",
  "leading", "ahead", "favorite", "likely", "expected", "confirmed",
  "breakthrough", "positive", "optimistic", "bullish", "strong",
];

const BEARISH_KEYWORDS = [
  "drop", "fall", "crash", "plunge", "decline", "lose", "defeat", "failure",
  "trailing", "behind", "underdog", "unlikely", "denied", "rejected",
  "setback", "negative", "pessimistic", "bearish", "weak",
];

// News API (using free tier - consider upgrading for production)
const NEWS_API_URL = "https://newsdata.io/api/1/news";

// ── State ──────────────────────────────────────────────────────────────────

let isRunning = false;
let analysisInterval: NodeJS.Timeout | null = null;

// ── Configuration ──────────────────────────────────────────────────────────

/**
 * Get the AI sentiment analysis configuration.
 */
export function getSentimentConfig(): SentimentConfig {
  return getItem<SentimentConfig>(CONFIG_KEY) ?? {
    enabled: process.env.AI_SENTIMENT_ENABLED === "true",
    minConfidence: parseFloat(process.env.AI_SENTIMENT_MIN_CONFIDENCE ?? "0.7"),
    maxPositionSize: parseFloat(process.env.AI_SENTIMENT_MAX_SIZE ?? "50"),
    keywords: [],
    sources: ["newsdata"],
  };
}

/**
 * Update the sentiment analysis configuration.
 */
export function updateSentimentConfig(config: Partial<SentimentConfig>): void {
  const current = getSentimentConfig();
  setItem(CONFIG_KEY, { ...current, ...config }, true);
  console.log("[aiSentiment] Config updated");
}

// ── Signal Management ──────────────────────────────────────────────────────

/**
 * Get all sentiment signals.
 */
export function getSignals(limit = 100): SentimentSignal[] {
  const signals = getItem<SentimentSignal[]>(SIGNALS_KEY) ?? [];
  return signals.slice(-limit);
}

/**
 * Record a new sentiment signal.
 */
function recordSignal(signal: SentimentSignal): void {
  const signals = getItem<SentimentSignal[]>(SIGNALS_KEY) ?? [];
  signals.push(signal);
  
  // Keep only last 200 signals
  if (signals.length > 200) {
    signals.splice(0, signals.length - 200);
  }
  
  setItem(SIGNALS_KEY, signals, true);
}

/**
 * Mark a signal as processed.
 */
function markSignalProcessed(id: string): void {
  const signals = getItem<SentimentSignal[]>(SIGNALS_KEY) ?? [];
  const signal = signals.find((s) => s.id === id);
  
  if (signal) {
    signal.processed = true;
    setItem(SIGNALS_KEY, signals, true);
  }
}

// ── Text Analysis ──────────────────────────────────────────────────────────

/**
 * Analyze text for sentiment indicators.
 * Returns a sentiment score between -1 (bearish) and 1 (bullish).
 */
export function analyzeTextSentiment(text: string): {
  score: number;
  sentiment: "bullish" | "bearish" | "neutral";
  confidence: number;
  keywords: string[];
} {
  const lowerText = text.toLowerCase();
  const foundKeywords: string[] = [];
  
  let bullishCount = 0;
  let bearishCount = 0;

  // Count bullish keywords
  for (const keyword of BULLISH_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      bullishCount++;
      foundKeywords.push(`+${keyword}`);
    }
  }

  // Count bearish keywords
  for (const keyword of BEARISH_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      bearishCount++;
      foundKeywords.push(`-${keyword}`);
    }
  }

  const total = bullishCount + bearishCount;
  
  if (total === 0) {
    return {
      score: 0,
      sentiment: "neutral",
      confidence: 0.3, // Low confidence when no keywords found
      keywords: [],
    };
  }

  const score = (bullishCount - bearishCount) / total;
  const sentiment = score > 0.2 ? "bullish" : score < -0.2 ? "bearish" : "neutral";
  
  // Confidence increases with more keywords found
  const confidence = Math.min(0.9, 0.4 + (total * 0.1));

  return {
    score,
    sentiment,
    confidence,
    keywords: foundKeywords,
  };
}

/**
 * Match a news item to a market based on keyword overlap.
 */
function matchNewsToMarket(news: NewsItem, market: Market): number {
  const newsText = `${news.title} ${news.description}`.toLowerCase();
  const marketQuestion = market.question.toLowerCase();
  
  // Extract key terms from market question
  const marketTerms = marketQuestion
    .split(/\s+/)
    .filter((term) => term.length > 3)
    .map((term) => term.replace(/[^a-z0-9]/g, ""));

  // Count matching terms
  let matches = 0;
  for (const term of marketTerms) {
    if (term && newsText.includes(term)) {
      matches++;
    }
  }

  // Return match score (0-1)
  return marketTerms.length > 0 ? matches / marketTerms.length : 0;
}

// ── News Fetching ──────────────────────────────────────────────────────────

/**
 * Fetch relevant news articles.
 * Uses NewsData.io API (free tier: 200 requests/day).
 */
async function fetchNews(keywords: string[]): Promise<NewsItem[]> {
  const apiKey = process.env.NEWS_API_KEY;
  
  if (!apiKey) {
    console.log("[aiSentiment] NEWS_API_KEY not configured, using simulated data");
    return [];
  }

  try {
    const query = keywords.join(" OR ");
    const { data } = await axios.get(NEWS_API_URL, {
      params: {
        apikey: apiKey,
        q: query,
        language: "en",
        category: "politics,business,world",
      },
      timeout: 10000,
    });

    if (!data.results) {
      return [];
    }

    return data.results.map((item: Record<string, unknown>) => ({
      title: item.title as string ?? "",
      description: item.description as string ?? "",
      source: item.source_id as string ?? "unknown",
      publishedAt: item.pubDate as string ?? "",
      url: item.link as string ?? "",
    }));
  } catch (err) {
    console.error("[aiSentiment] Failed to fetch news:", (err as Error).message);
    return [];
  }
}

// ── Sentiment Analysis ─────────────────────────────────────────────────────

/**
 * Analyze sentiment for a specific market.
 */
export async function analyzeMarketSentiment(
  market: Market
): Promise<SentimentSignal | null> {
  const config = getSentimentConfig();
  
  if (!config.enabled) {
    return null;
  }

  // Extract keywords from market question
  const marketKeywords = market.question
    .split(/\s+/)
    .filter((word) => word.length > 4)
    .slice(0, 5);

  // Fetch relevant news
  const news = await fetchNews(marketKeywords);
  
  if (news.length === 0) {
    // Analyze market question itself as fallback
    const questionAnalysis = analyzeTextSentiment(market.question);
    
    if (questionAnalysis.confidence < config.minConfidence) {
      return null;
    }

    const signal: SentimentSignal = {
      id: `sent-${market.conditionId}-${Date.now()}`,
      market: market.conditionId,
      sentiment: questionAnalysis.sentiment,
      confidence: questionAnalysis.confidence,
      sources: ["market-question"],
      keywords: questionAnalysis.keywords,
      timestamp: Date.now(),
      processed: false,
    };

    return signal;
  }

  // Aggregate sentiment from multiple news sources
  let totalScore = 0;
  const allKeywords: string[] = [];
  const sources: string[] = [];
  let relevantNewsCount = 0;

  for (const item of news) {
    // Check relevance to market
    const relevance = matchNewsToMarket(item, market);
    if (relevance < 0.3) continue;

    relevantNewsCount++;
    const analysis = analyzeTextSentiment(`${item.title} ${item.description}`);
    totalScore += analysis.score * relevance;
    allKeywords.push(...analysis.keywords);
    if (!sources.includes(item.source)) {
      sources.push(item.source);
    }
  }

  if (relevantNewsCount === 0) {
    return null;
  }

  const avgScore = totalScore / relevantNewsCount;
  const sentiment = avgScore > 0.2 ? "bullish" : avgScore < -0.2 ? "bearish" : "neutral";
  const confidence = Math.min(0.9, 0.5 + (relevantNewsCount * 0.05));

  if (confidence < config.minConfidence) {
    return null;
  }

  const signal: SentimentSignal = {
    id: `sent-${market.conditionId}-${Date.now()}`,
    market: market.conditionId,
    sentiment,
    confidence,
    sources,
    keywords: [...new Set(allKeywords)].slice(0, 10),
    timestamp: Date.now(),
    processed: false,
  };

  console.log(
    `[aiSentiment] Signal: ${market.conditionId.slice(0, 12)}... | ` +
    `${sentiment.toUpperCase()} (${(confidence * 100).toFixed(0)}% conf) | ` +
    `Sources: ${sources.length}`
  );

  recordSignal(signal);
  return signal;
}

/**
 * Execute a trade based on sentiment signal.
 */
export async function executeSentimentTrade(
  signal: SentimentSignal,
  market: Market,
  placeTrade: (market: string, side: "BUY" | "SELL", outcome: string, price: number, size: number) => Promise<void>
): Promise<boolean> {
  const config = getSentimentConfig();

  if (signal.processed) {
    console.log(`[aiSentiment] Signal ${signal.id} already processed`);
    return false;
  }

  if (signal.sentiment === "neutral") {
    console.log(`[aiSentiment] Skipping neutral signal`);
    return false;
  }

  // Determine which outcome to buy based on sentiment
  // Bullish = buy YES (outcome 0), Bearish = buy NO (outcome 1)
  const outcomeIndex = signal.sentiment === "bullish" ? 0 : 1;
  const outcome = market.outcomes[outcomeIndex] ?? "YES";
  const price = market.prices[outcomeIndex] ?? 0.5;

  // Size proportional to confidence
  const size = Math.min(
    config.maxPositionSize,
    config.maxPositionSize * signal.confidence
  );

  if (size < 1) {
    console.log(`[aiSentiment] Trade size too small: $${size.toFixed(2)}`);
    return false;
  }

  console.log(
    `[aiSentiment] Executing ${signal.sentiment} trade: ` +
    `BUY $${size.toFixed(2)} of ${outcome} @ ${price.toFixed(4)}`
  );

  try {
    await placeTrade(signal.market, "BUY", outcome, price, size);
    markSignalProcessed(signal.id);

    // Send alert
    const alertData: TradeAlertData = {
      market: signal.market,
      side: "BUY",
      outcome,
      price,
      size,
      paper: process.env.PAPER_TRADE === "true",
      strategy: `AI Sentiment (${signal.sentiment})`,
    };
    alertTrade(alertData).catch(console.error);

    return true;
  } catch (err) {
    console.error(`[aiSentiment] Trade failed:`, err);
    return false;
  }
}

// ── Analysis Loop ──────────────────────────────────────────────────────────

/**
 * Run sentiment analysis on all markets.
 */
export async function analyzeAllMarkets(
  markets: Market[]
): Promise<SentimentSignal[]> {
  const config = getSentimentConfig();
  
  if (!config.enabled) {
    return [];
  }

  const signals: SentimentSignal[] = [];
  
  // Analyze top markets (limit to avoid API rate limits)
  const marketsToAnalyze = markets.slice(0, 20);

  for (const market of marketsToAnalyze) {
    try {
      const signal = await analyzeMarketSentiment(market);
      if (signal && signal.sentiment !== "neutral") {
        signals.push(signal);
      }
    } catch (err) {
      console.error(`[aiSentiment] Analysis failed for ${market.conditionId}:`, err);
    }

    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return signals;
}

/**
 * Start the sentiment analysis loop.
 */
export function startSentimentAnalysis(
  fetchMarkets: () => Promise<Market[]>,
  intervalMs = 300000 // 5 minutes default
): void {
  if (isRunning) return;
  isRunning = true;

  console.log(`[aiSentiment] Starting analysis (interval=${intervalMs}ms)`);

  const analyze = async () => {
    if (!isRunning) return;
    try {
      const markets = await fetchMarkets();
      const signals = await analyzeAllMarkets(markets);
      if (signals.length > 0) {
        console.log(`[aiSentiment] Generated ${signals.length} actionable signals`);
      }
    } catch (err) {
      console.error("[aiSentiment] Analysis loop error:", err);
    }
  };

  analyze();
  analysisInterval = setInterval(analyze, intervalMs);
}

/**
 * Stop the sentiment analysis loop.
 */
export function stopSentimentAnalysis(): void {
  if (!isRunning) return;
  isRunning = false;

  if (analysisInterval) {
    clearInterval(analysisInterval);
    analysisInterval = null;
  }

  console.log("[aiSentiment] Analysis stopped");
}

/**
 * Check if sentiment analysis is running.
 */
export function isSentimentAnalysisRunning(): boolean {
  return isRunning;
}

// ── Statistics ─────────────────────────────────────────────────────────────

/**
 * Get sentiment analysis statistics.
 */
export function getSentimentStats(): {
  totalSignals: number;
  bullishSignals: number;
  bearishSignals: number;
  neutralSignals: number;
  processedSignals: number;
  avgConfidence: number;
} {
  const signals = getSignals(1000);
  const bullish = signals.filter((s) => s.sentiment === "bullish");
  const bearish = signals.filter((s) => s.sentiment === "bearish");
  const neutral = signals.filter((s) => s.sentiment === "neutral");
  const processed = signals.filter((s) => s.processed);

  const avgConfidence = signals.length > 0
    ? signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length
    : 0;

  return {
    totalSignals: signals.length,
    bullishSignals: bullish.length,
    bearishSignals: bearish.length,
    neutralSignals: neutral.length,
    processedSignals: processed.length,
    avgConfidence,
  };
}
