import { getGuildSettings } from "./settings.js";

const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex";
const WCRO_ADDRESS = "0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23";

interface DexPairRaw {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative?: string;
  priceUsd?: string;
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  info?: { imageUrl?: string };
}

interface DexResponse {
  pairs: DexPairRaw[] | null;
}

export interface PriceData {
  name: string;
  symbol: string;
  logoUrl: string | null;
  priceUsd: number | null;
  priceCro: number | null;
  change5m: number | null;
  change1h: number | null;
  change6h: number | null;
  change24h: number | null;
  volume24h: number | null;
  liquidityUsd: number | null;
  marketCap: number | null;
  fdv: number | null;
  pairAddress: string;
  dexscreenerUrl: string;
  chartImageUrl: string;
  chartImageValid: boolean;
  tokenAddress: string;
}

let croRateCache: { rate: number; fetchedAt: number } | null = null;
const CRO_RATE_TTL_MS = 5 * 60 * 1000;

async function fetchWithTimeout(
  url: string,
  method: "GET" | "HEAD" = "GET",
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { method, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCroUsdRate(): Promise<number> {
  if (croRateCache && Date.now() - croRateCache.fetchedAt < CRO_RATE_TTL_MS) {
    return croRateCache.rate;
  }
  try {
    const res = await fetchWithTimeout(`${DEXSCREENER_API}/tokens/${WCRO_ADDRESS}`);
    if (!res.ok) return 0;
    const data = (await res.json()) as DexResponse;
    const pairs = data.pairs?.filter((p) => p.chainId === "cronos") ?? [];
    if (!pairs.length) return 0;
    const best = pairs.reduce((a, b) =>
      (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a
    );
    const rate = best.priceUsd ? parseFloat(best.priceUsd) : 0;
    if (rate > 0) croRateCache = { rate, fetchedAt: Date.now() };
    return rate;
  } catch {
    return 0;
  }
}

async function validateChartUrl(url: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, "HEAD", 5000);
    return res.ok;
  } catch {
    return false;
  }
}

async function parsePair(pair: DexPairRaw): Promise<PriceData> {
  const chartImageUrl = `https://dd.dexscreener.com/ds-data/charts/cronos/${pair.pairAddress.toLowerCase()}/1d.png?size=lg&theme=dark`;

  const priceUsd = pair.priceUsd != null ? parseFloat(pair.priceUsd) : null;

  const isNativeCro =
    pair.quoteToken.symbol.toUpperCase() === "CRO" ||
    pair.quoteToken.symbol.toUpperCase() === "WCRO";

  let priceCro: number | null = null;
  if (priceUsd !== null && priceUsd > 0) {
    if (isNativeCro && pair.priceNative != null) {
      priceCro = parseFloat(pair.priceNative);
    } else {
      const croRate = await fetchCroUsdRate();
      if (croRate > 0) priceCro = priceUsd / croRate;
    }
  }

  const chartImageValid = await validateChartUrl(chartImageUrl);

  return {
    name: pair.baseToken.name,
    symbol: pair.baseToken.symbol,
    logoUrl: pair.info?.imageUrl ?? null,
    priceUsd,
    priceCro,
    change5m: pair.priceChange?.m5 ?? null,
    change1h: pair.priceChange?.h1 ?? null,
    change6h: pair.priceChange?.h6 ?? null,
    change24h: pair.priceChange?.h24 ?? null,
    volume24h: pair.volume?.h24 ?? null,
    liquidityUsd: pair.liquidity?.usd ?? null,
    marketCap: pair.marketCap ?? null,
    fdv: pair.fdv ?? null,
    pairAddress: pair.pairAddress,
    dexscreenerUrl: pair.url,
    chartImageUrl,
    chartImageValid,
    tokenAddress: pair.baseToken.address,
  };
}

export async function fetchPriceByPair(pairAddress: string): Promise<PriceData | null> {
  try {
    const res = await fetchWithTimeout(`${DEXSCREENER_API}/pairs/cronos/${pairAddress}`);
    if (!res.ok) return null;
    const data = (await res.json()) as DexResponse;
    const pairs = data.pairs;
    if (!pairs || pairs.length === 0) return null;
    const pair = pairs.find((p) => p.chainId === "cronos") ?? pairs[0];
    if (!pair) return null;
    return parsePair(pair);
  } catch (err) {
    console.error("[price] fetchPriceByPair error:", err);
    return null;
  }
}

export async function fetchPriceByToken(tokenAddress: string): Promise<PriceData | null> {
  try {
    const res = await fetchWithTimeout(`${DEXSCREENER_API}/tokens/${tokenAddress}`);
    if (!res.ok) return null;
    const data = (await res.json()) as DexResponse;
    const pairs = data.pairs;
    if (!pairs || pairs.length === 0) return null;
    const cronosPairs = pairs.filter((p) => p.chainId === "cronos");
    if (cronosPairs.length === 0) return null;
    const best = cronosPairs.reduce((a, b) =>
      (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a
    );
    return parsePair(best);
  } catch (err) {
    console.error("[price] fetchPriceByToken error:", err);
    return null;
  }
}

export async function fetchTokenPrice(
  addressOrSymbol: string,
  guildId?: string
): Promise<PriceData | null> {
  const trimmed = addressOrSymbol.trim();

  if (trimmed.toLowerCase().startsWith("0x")) {
    const pairResult = await fetchPriceByPair(trimmed);
    if (pairResult) return pairResult;
    return fetchPriceByToken(trimmed);
  }

  if (guildId) {
    const settings = getGuildSettings(guildId);
    const symbolUpper = trimmed.toUpperCase();

    if (settings.buyPairAddress) {
      const priceData = await fetchPriceByPair(settings.buyPairAddress);
      if (priceData && priceData.symbol.toUpperCase() === symbolUpper) return priceData;
    }
    if (settings.buyTokenAddress) {
      const priceData = await fetchPriceByToken(settings.buyTokenAddress);
      if (priceData && priceData.symbol.toUpperCase() === symbolUpper) return priceData;
    }
  }

  return null;
}
