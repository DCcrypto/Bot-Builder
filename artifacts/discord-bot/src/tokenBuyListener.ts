import { ethers } from "ethers";
import { buildBuyEmbed } from "./embeds.js";
import type { GuildState } from "./listener.js";
import { fetchPriceByPair } from "./priceChecker.js";
import type { PriceData } from "./priceChecker.js";
import { markBuyTxSeen } from "./seenBuys.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const BUY_BLOCKS_FILE = join(DATA_DIR, "buy-blocks.json");

const CRONOS_RPC = "https://evm.cronos.org";
const POLL_INTERVAL_MS = 15_000;
const MAX_BLOCK_RANGE = 999;
const STARTUP_BLOCK_LOOKBACK = 50;
const MAX_CATCHUP_BLOCKS = 5_000;
const PRICE_CACHE_TTL_MS = 60_000;

const priceCache = new Map<string, { data: PriceData; fetchedAt: number }>();

async function getCachedPrice(pairAddress: string): Promise<PriceData | null> {
  const key = pairAddress.toLowerCase();
  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < PRICE_CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const data = await fetchPriceByPair(pairAddress);
    if (data) priceCache.set(key, { data, fetchedAt: Date.now() });
    return data;
  } catch {
    return null;
  }
}

const PAIR_ABI = [
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
}

interface PairInfo {
  token0: string;
  token1: string;
  trackedIsToken0: boolean;
  trackedToken: TokenInfo;
  otherToken: TokenInfo;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadLastBlock(pairAddress: string): number | null {
  try {
    if (!existsSync(BUY_BLOCKS_FILE)) return null;
    const data = JSON.parse(readFileSync(BUY_BLOCKS_FILE, "utf-8")) as Record<string, number>;
    return data[pairAddress.toLowerCase()] ?? null;
  } catch {
    return null;
  }
}

function saveLastBlock(pairAddress: string, block: number): void {
  let data: Record<string, number> = {};
  try {
    if (existsSync(BUY_BLOCKS_FILE)) {
      data = JSON.parse(readFileSync(BUY_BLOCKS_FILE, "utf-8")) as Record<string, number>;
    }
  } catch {}
  data[pairAddress.toLowerCase()] = block;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(BUY_BLOCKS_FILE, JSON.stringify(data, null, 2));
}

function computeBubbles(
  spentRaw: bigint,
  spentDecimals: number,
  rates: [number, number, number, number],
  emoji: string
): string {
  const spent = parseFloat(ethers.formatUnits(spentRaw, spentDecimals));
  let count = 1;
  if (spent >= rates[3]) count = 5;
  else if (spent >= rates[2]) count = 4;
  else if (spent >= rates[1]) count = 3;
  else if (spent >= rates[0]) count = 2;
  return emoji.repeat(count);
}

function formatAmount(raw: bigint, decimals: number): string {
  const val = parseFloat(ethers.formatUnits(raw, decimals));
  if (val >= 1_000_000) return `${(val / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (val >= 1_000) return `${(val / 1_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}K`;
  return val.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

async function fetchTokenInfo(
  address: string,
  provider: ethers.JsonRpcProvider
): Promise<TokenInfo> {
  const contract = new ethers.Contract(address, ERC20_ABI, provider);
  try {
    const [name, symbol, decimals] = await Promise.all([
      contract["name"]() as Promise<string>,
      contract["symbol"]() as Promise<string>,
      contract["decimals"]() as Promise<bigint>,
    ]);
    return { name, symbol, decimals: Number(decimals) };
  } catch {
    return { name: "Unknown", symbol: "???", decimals: 18 };
  }
}

async function fetchPairInfo(
  pairAddress: string,
  tokenAddress: string,
  provider: ethers.JsonRpcProvider
): Promise<PairInfo> {
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
  const [token0, token1] = await Promise.all([
    pair["token0"]() as Promise<string>,
    pair["token1"]() as Promise<string>,
  ]);

  const token0Lower = token0.toLowerCase();
  const token1Lower = token1.toLowerCase();
  const trackedLower = tokenAddress.toLowerCase();
  const trackedIsToken0 = token0Lower === trackedLower;

  const trackedAddr = trackedIsToken0 ? token0 : token1;
  const otherAddr = trackedIsToken0 ? token1 : token0;

  const [trackedToken, otherToken] = await Promise.all([
    fetchTokenInfo(trackedAddr, provider),
    fetchTokenInfo(otherAddr, provider),
  ]);

  return { token0: token0Lower, token1: token1Lower, trackedIsToken0, trackedToken, otherToken };
}

async function pollPair(
  pairAddress: string,
  tokenAddress: string,
  guilds: GuildState[],
  provider: ethers.JsonRpcProvider,
  lastBlocks: Map<string, number>,
  pairInfoCache: Map<string, PairInfo>
): Promise<void> {
  try {
    const currentBlock = await provider.getBlockNumber();
    const pairKey = `${pairAddress.toLowerCase()}:${tokenAddress.toLowerCase()}`;

    let lastBlock = lastBlocks.get(pairKey) ?? null;
    if (lastBlock === null) {
      const saved = loadLastBlock(pairKey);
      const minBlock = currentBlock - MAX_CATCHUP_BLOCKS;
      lastBlock = saved !== null ? Math.max(saved, minBlock) : currentBlock - STARTUP_BLOCK_LOOKBACK;
      if (saved !== null && saved < minBlock) {
        console.log(`[buys] ${pairAddress}: saved block ${saved} too far behind — starting from ${lastBlock} (current: ${currentBlock})`);
      } else {
        console.log(`[buys] Starting ${pairAddress} from block ${lastBlock} (current: ${currentBlock})`);
      }
    }

    if (currentBlock <= lastBlock) return;

    let pairInfo = pairInfoCache.get(pairKey);
    if (!pairInfo) {
      pairInfo = await fetchPairInfo(pairAddress, tokenAddress, provider);
      pairInfoCache.set(pairKey, pairInfo);
      console.log(
        `[buys] Pair ${pairAddress}: ${pairInfo.trackedToken.symbol}/${pairInfo.otherToken.symbol} — tracked is token${pairInfo.trackedIsToken0 ? "0" : "1"}`
      );
    }

    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
    const swapFilter = pair.filters["Swap"]();

    const fromBlock = lastBlock + 1;
    const toBlock = Math.min(currentBlock, fromBlock + MAX_BLOCK_RANGE);

    const events = await pair.queryFilter(swapFilter, fromBlock, toBlock);

    for (const event of events) {
      if (!("args" in event)) continue;
      const log = event as ethers.EventLog;

      const amount0In = log.args[1] as bigint;
      const amount1In = log.args[2] as bigint;
      const amount0Out = log.args[3] as bigint;
      const amount1Out = log.args[4] as bigint;
      const to = log.args[5] as string;
      const txHash = log.transactionHash;

      const isBuy = pairInfo.trackedIsToken0 ? amount0Out > 0n : amount1Out > 0n;
      if (!isBuy) continue;

      const trackedAmountOut = pairInfo.trackedIsToken0 ? amount0Out : amount1Out;
      const otherAmountIn = pairInfo.trackedIsToken0 ? amount1In : amount0In;

      const spentFloat = parseFloat(ethers.formatUnits(otherAmountIn, pairInfo.otherToken.decimals));

      for (const state of guilds) {
        if (!state.buysChannel) continue;
        if (state.seenBuyTxHashes.has(txHash)) continue;

        if (state.minBuyCro > 0 && spentFloat < state.minBuyCro) {
          state.seenBuyTxHashes.add(txHash);
          markBuyTxSeen(state.guildId, [txHash]);
          continue;
        }

        const bubbles = computeBubbles(
          otherAmountIn,
          pairInfo.otherToken.decimals,
          state.buyRates,
          state.buyEmoji
        );

        const priceData = await getCachedPrice(pairAddress);

        let amountBoughtUsd: number | null = null;
        if (priceData?.priceUsd != null && priceData.priceUsd > 0) {
          const rawTokens = parseFloat(ethers.formatUnits(trackedAmountOut, pairInfo.trackedToken.decimals));
          amountBoughtUsd = rawTokens * priceData.priceUsd;
        }

        const embed = buildBuyEmbed({
          tokenName: pairInfo.trackedToken.name,
          tokenSymbol: pairInfo.trackedToken.symbol,
          amountBought: formatAmount(trackedAmountOut, pairInfo.trackedToken.decimals),
          spentAmount: formatAmount(otherAmountIn, pairInfo.otherToken.decimals),
          spentSymbol: pairInfo.otherToken.symbol,
          buyer: to,
          txHash,
          bubbles,
          imageUrl: state.buyImageUrl,
          amountBoughtUsd,
          change24h: priceData?.change24h ?? null,
          chartImageUrl: priceData?.chartImageUrl ?? null,
          chartImageValid: priceData?.chartImageValid ?? false,
        });

        try {
          await state.buysChannel.send({ embeds: [embed] });
          console.log(
            `[buys] [${state.guildId}] Posted buy: ${formatAmount(trackedAmountOut, pairInfo.trackedToken.decimals)} ${pairInfo.trackedToken.symbol} tx=${txHash.slice(0, 10)}...`
          );
        } catch (err) {
          console.error(`[buys] [${state.guildId}] Error posting buy tx ${txHash}:`, err);
          continue;
        }

        state.seenBuyTxHashes.add(txHash);
        markBuyTxSeen(state.guildId, [txHash]);
      }
    }

    lastBlocks.set(pairKey, toBlock);
    saveLastBlock(pairKey, toBlock);
  } catch (err) {
    console.error(`[buys] Poll error for ${pairAddress}:`, err);
  }
}

export async function startTokenBuyListener(guildStates: Map<string, GuildState>): Promise<void> {
  console.log("[buys] Token buy listener started (multi-guild)");

  const provider = new ethers.JsonRpcProvider(CRONOS_RPC);
  const lastBlocks = new Map<string, number>();
  const pairInfoCache = new Map<string, PairInfo>();

  async function poll(): Promise<void> {
    const pairToGuilds = new Map<string, { pairAddress: string; tokenAddress: string; guilds: GuildState[] }>();

    for (const state of guildStates.values()) {
      if (!state.buysChannel || !state.buyPairAddress || !state.buyTokenAddress) continue;
      const key = `${state.buyPairAddress.toLowerCase()}:${state.buyTokenAddress.toLowerCase()}`;
      const existing = pairToGuilds.get(key);
      if (existing) {
        existing.guilds.push(state);
      } else {
        pairToGuilds.set(key, {
          pairAddress: state.buyPairAddress,
          tokenAddress: state.buyTokenAddress,
          guilds: [state],
        });
      }
    }

    for (const [, { pairAddress, tokenAddress, guilds }] of pairToGuilds) {
      await pollPair(pairAddress, tokenAddress, guilds, provider, lastBlocks, pairInfoCache);
    }
  }

  async function run(): Promise<void> {
    while (true) {
      try {
        await poll();
      } catch (err) {
        console.error("[buys] Unexpected poll error (will retry):", err);
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  run().catch((err) => {
    console.error("[buys] Run loop exited unexpectedly:", err);
  });
}
