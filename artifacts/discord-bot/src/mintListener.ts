import { ethers } from "ethers";
import { buildMintEmbed } from "./embeds.js";
import type { GuildState } from "./listener.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const BLOCKS_FILE = join(DATA_DIR, "mint-blocks.json");

const CRONOS_RPC = "https://evm.cronos.org";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const POLL_INTERVAL_MS = 15_000;
const MAX_BLOCK_RANGE = 999;
const STARTUP_BLOCK_LOOKBACK = 50;

const ERC721_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function name() view returns (string)",
];

function loadLastBlock(contractAddress: string): number | null {
  try {
    if (!existsSync(BLOCKS_FILE)) return null;
    const data = JSON.parse(readFileSync(BLOCKS_FILE, "utf-8")) as Record<string, number>;
    return data[contractAddress.toLowerCase()] ?? null;
  } catch {
    return null;
  }
}

function saveLastBlock(contractAddress: string, block: number): void {
  let data: Record<string, number> = {};
  try {
    if (existsSync(BLOCKS_FILE)) {
      data = JSON.parse(readFileSync(BLOCKS_FILE, "utf-8")) as Record<string, number>;
    }
  } catch {}
  data[contractAddress.toLowerCase()] = block;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(BLOCKS_FILE, JSON.stringify(data, null, 2));
}

export function ipfsToHttp(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    return `https://nftstorage.link/ipfs/${uri.slice(7)}`;
  }
  return uri;
}

async function fetchMetadata(uri: string): Promise<Record<string, unknown>> {
  if (uri.startsWith("data:application/json;base64,")) {
    const b64 = uri.split(",")[1] ?? "";
    return JSON.parse(Buffer.from(b64, "base64").toString("utf-8")) as Record<string, unknown>;
  }
  if (uri.startsWith("data:application/json,")) {
    return JSON.parse(decodeURIComponent(uri.split(",").slice(1).join(","))) as Record<string, unknown>;
  }
  const url = ipfsToHttp(uri);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollContract(
  contractAddress: string,
  guilds: GuildState[],
  provider: ethers.JsonRpcProvider,
  lastBlocks: Map<string, number>
): Promise<void> {
  try {
    const currentBlock = await provider.getBlockNumber();

    let lastBlock = lastBlocks.get(contractAddress) ?? null;
    if (lastBlock === null) {
      const saved = loadLastBlock(contractAddress);
      lastBlock = saved ?? currentBlock - STARTUP_BLOCK_LOOKBACK;
      console.log(`[mint] Starting ${contractAddress} from block ${lastBlock} (current: ${currentBlock})`);
    }

    if (currentBlock <= lastBlock) return;

    const contract = new ethers.Contract(contractAddress, ERC721_ABI, provider);
    const transferFilter = contract.filters["Transfer"](ZERO_ADDRESS);

    const fromBlock = lastBlock + 1;
    const toBlock = Math.min(currentBlock, fromBlock + MAX_BLOCK_RANGE);

    const events = await contract.queryFilter(transferFilter, fromBlock, toBlock);

    let collectionName = "";
    if (events.length > 0) {
      try { collectionName = (await contract["name"]()) as string; } catch {}
    }

    for (const event of events) {
      if (!("args" in event)) continue;
      const log = event as ethers.EventLog;
      const to = log.args[1] as string;
      const tokenId = (log.args[2] as bigint).toString();

      let tokenUri: string;
      try {
        tokenUri = (await contract["tokenURI"](tokenId)) as string;
      } catch {
        console.warn(`[mint] No tokenURI for #${tokenId} — skipping`);
        continue;
      }

      let metadata: Record<string, unknown>;
      try {
        metadata = await fetchMetadata(tokenUri);
      } catch (e) {
        console.warn(`[mint] Could not fetch metadata for #${tokenId}:`, e);
        continue;
      }

      const embed = buildMintEmbed({
        tokenId,
        owner: to,
        collectionName,
        metadata,
        txHash: log.transactionHash,
        contractAddress,
      });

      for (const state of guilds) {
        if (!state.mintsChannel) continue;
        try {
          await state.mintsChannel.send({ embeds: [embed] });
          console.log(
            `[mint] [${state.guildId}] Posted mint #${tokenId} → #${state.mintsChannel.name}`
          );
        } catch (err) {
          console.error(`[mint] [${state.guildId}] Error posting mint #${tokenId}:`, err);
        }
      }
    }

    lastBlocks.set(contractAddress, toBlock);
    saveLastBlock(contractAddress, toBlock);
  } catch (err) {
    console.error(`[mint] Poll error for ${contractAddress}:`, err);
  }
}

export async function startMintListener(guildStates: Map<string, GuildState>): Promise<void> {
  console.log("[mint] Mint listener started (multi-guild)");

  const provider = new ethers.JsonRpcProvider(CRONOS_RPC);
  const lastBlocks = new Map<string, number>();

  async function poll(): Promise<void> {
    const contractToGuilds = new Map<string, GuildState[]>();

    for (const state of guildStates.values()) {
      const contract = state.mintContractAddress;
      if (!contract || !state.mintsChannel) continue;
      const list = contractToGuilds.get(contract) ?? [];
      list.push(state);
      contractToGuilds.set(contract, list);
    }

    for (const [contractAddress, guilds] of contractToGuilds) {
      await pollContract(contractAddress, guilds, provider, lastBlocks);
    }
  }

  async function run(): Promise<void> {
    while (true) {
      await poll();
      await sleep(POLL_INTERVAL_MS);
    }
  }

  run().catch((err) => {
    console.error("[mint] Fatal error:", err);
    process.exit(1);
  });
}
