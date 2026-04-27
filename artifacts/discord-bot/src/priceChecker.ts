const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex";

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
  priceNative: number | null;
  nativeSymbol: string;
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
  tokenAddress: string;
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parsePair(pair: DexPairRaw): PriceData {
  const chartImageUrl = `https://dd.dexscreener.com/ds-data/charts/cronos/${pair.pairAddress.toLowerCase()}/1d.png?size=lg&theme=dark`;
  return {
    name: pair.baseToken.name,
    symbol: pair.baseToken.symbol,
    logoUrl: pair.info?.imageUrl ?? null,
    priceUsd: pair.priceUsd != null ? parseFloat(pair.priceUsd) : null,
    priceNative: pair.priceNative != null ? parseFloat(pair.priceNative) : null,
    nativeSymbol: pair.quoteToken.symbol,
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

export async function fetchTokenPrice(addressOrPair: string): Promise<PriceData | null> {
  if (!addressOrPair.toLowerCase().startsWith("0x")) return null;
  const pairResult = await fetchPriceByPair(addressOrPair);
  if (pairResult) return pairResult;
  return fetchPriceByToken(addressOrPair);
}
