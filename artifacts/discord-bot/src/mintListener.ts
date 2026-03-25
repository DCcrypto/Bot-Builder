import type { TextChannel } from "discord.js";
import { ethers } from "ethers";
import { buildMintEmbed } from "./embeds.js";
import type { ListenerState } from "./listener.js";
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
const STARTUP_BLOCK_LOOKBACK = 50; // ~5 min of history on first run

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

function getTrackedContract(state: ListenerState): string | null {
  return state.mintContractAddress ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startMintListener(state: ListenerState): Promise<void> {
  console.log("[mint] Mint listener started — waiting for a single collection to be set");

  const provider = new ethers.JsonRpcProvider(CRONOS_RPC);
  let lastContractAddress: string | null = null;
  let lastBlock: number | null = null;

  async function poll(): Promise<void> {
    const contractAddress = getTrackedContract(state);

    if (!contractAddress) return;

    const channel: TextChannel | null = state.mintsChannel;
    if (!channel) return;

    if (contractAddress !== lastContractAddress) {
      lastContractAddress = contractAddress;
      lastBlock = null;
      console.log(`[mint] Tracking mints for contract: ${contractAddress}`);
    }

    try {
      const currentBlock = await provider.getBlockNumber();

      if (lastBlock === null) {
        const saved = loadLastBlock(contractAddress);
        lastBlock = saved ?? currentBlock - STARTUP_BLOCK_LOOKBACK;
        console.log(`[mint] Starting from block ${lastBlock} (current: ${currentBlock})`);
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

        try {
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

          await channel.send({ embeds: [embed] });
          console.log(`[mint] Posted mint #${tokenId} → #${channel.name} (${channel.id})`);
        } catch (err) {
          console.error(`[mint] Error posting mint #${tokenId}:`, err);
        }
      }

      lastBlock = toBlock;
      saveLastBlock(contractAddress, lastBlock);
    } catch (err) {
      console.error("[mint] Poll error:", err);
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
