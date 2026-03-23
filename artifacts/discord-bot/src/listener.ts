import { ethers } from "ethers";
import type { TextChannel } from "discord.js";
import { fetchNftMetadata } from "./metadata.js";
import { buildListingEmbed, buildSaleEmbed } from "./embeds.js";
import { config } from "./config.js";
import marketplaceAbi from "./abi/marketplace.json" assert { type: "json" };

export interface ListenerState {
  listingsChannel: TextChannel | null;
  salesChannel: TextChannel | null;
  trackedCollections: Set<string>;
  connected: boolean;
}

type DecodedListingEvent = {
  kind: "listing";
  seller: string;
  nftAddress: string;
  tokenId: bigint;
  price: bigint;
};

type DecodedSaleEvent = {
  kind: "sale";
  buyer: string;
  seller: string;
  nftAddress: string;
  tokenId: bigint;
  price: bigint;
};

type DecodedEvent = DecodedListingEvent | DecodedSaleEvent;

const LISTING_EVENT_NAMES = new Set(["ItemListed", "Listed", "NewListing", "ListingCreated"]);
const SALE_EVENT_NAMES = new Set(["ItemBought", "Sold", "Sale", "ListingPurchased"]);

function tryDecodeLog(
  iface: ethers.Interface,
  log: ethers.Log
): DecodedEvent | null {
  try {
    const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
    if (!parsed) return null;

    const name = parsed.name;

    if (LISTING_EVENT_NAMES.has(name)) {
      const seller: string = parsed.args["seller"] as string;
      const nftAddress: string =
        (parsed.args["nftAddress"] as string) ?? (parsed.args["nftContract"] as string) ?? "";
      const tokenId: bigint = parsed.args["tokenId"] as bigint;
      const price: bigint = parsed.args["price"] as bigint;
      return { kind: "listing", seller, nftAddress, tokenId, price };
    }

    if (SALE_EVENT_NAMES.has(name)) {
      const buyer: string = parsed.args["buyer"] as string;
      const seller: string = (parsed.args["seller"] as string) ?? "";
      const nftAddress: string =
        (parsed.args["nftAddress"] as string) ?? (parsed.args["nftContract"] as string) ?? "";
      const tokenId: bigint = parsed.args["tokenId"] as bigint;
      const price: bigint = parsed.args["price"] as bigint;
      return { kind: "sale", buyer, seller, nftAddress, tokenId, price };
    }

    console.log(`[listener] Unhandled event: ${name}`);
    return null;
  } catch {
    return null;
  }
}

function isTrackedCollection(state: ListenerState, nftAddress: string): boolean {
  if (state.trackedCollections.size === 0) return true;
  return state.trackedCollections.has(nftAddress.toLowerCase());
}

export async function startListener(state: ListenerState): Promise<void> {
  console.log("[listener] Connecting to Cronos RPC:", config.cronos.rpcUrl);

  let provider: ethers.JsonRpcProvider | null = null;
  let lastBlock = 0;

  const iface = new ethers.Interface(marketplaceAbi as ethers.InterfaceAbi);
  const marketplaceAddress = ethers.getAddress(config.cronos.marketplaceAddress);

  async function connect(): Promise<void> {
    provider = new ethers.JsonRpcProvider(config.cronos.rpcUrl);
    const network = await provider.getNetwork();
    console.log(`[listener] Connected to Cronos (chainId: ${network.chainId})`);
    const current = await provider.getBlockNumber();
    lastBlock = current;
    state.connected = true;
    console.log(`[listener] Starting from block: ${lastBlock}`);
  }

  async function pollLogs(): Promise<void> {
    if (!provider) return;

    try {
      const currentBlock = await provider.getBlockNumber();
      if (currentBlock <= lastBlock) return;

      const fromBlock = lastBlock + 1;
      const toBlock = Math.min(currentBlock, fromBlock + 499);

      console.log(`[listener] Polling blocks ${fromBlock}–${toBlock}`);

      const logs = await provider.getLogs({
        address: marketplaceAddress,
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        const decoded = tryDecodeLog(iface, log);
        if (!decoded) continue;

        const txHash = log.transactionHash;

        if (decoded.kind === "listing") {
          const nftAddr = decoded.nftAddress || marketplaceAddress;

          if (!isTrackedCollection(state, nftAddr)) {
            console.log(`[listener] Skipping listing — collection not tracked: ${nftAddr}`);
            continue;
          }

          console.log(`[listener] New listing in tx ${txHash}`);
          const metadata = await fetchNftMetadata(provider, nftAddr, decoded.tokenId);
          const embed = buildListingEmbed(
            metadata,
            decoded.seller,
            decoded.price,
            config.site.baseUrl,
            txHash
          );

          const channel = state.listingsChannel ?? state.salesChannel;
          if (channel) {
            await channel.send({ embeds: [embed] });
            console.log(`[listener] Posted listing: ${metadata.name}`);
          } else {
            console.warn("[listener] No listings channel set — use /settings channel listings");
          }
        } else if (decoded.kind === "sale") {
          const nftAddr = decoded.nftAddress || marketplaceAddress;

          if (!isTrackedCollection(state, nftAddr)) {
            console.log(`[listener] Skipping sale — collection not tracked: ${nftAddr}`);
            continue;
          }

          console.log(`[listener] Sale in tx ${txHash}`);
          const metadata = await fetchNftMetadata(provider, nftAddr, decoded.tokenId);
          const embed = buildSaleEmbed(
            metadata,
            decoded.buyer,
            decoded.seller,
            decoded.price,
            config.site.baseUrl,
            txHash
          );

          const channel = state.salesChannel ?? state.listingsChannel;
          if (channel) {
            await channel.send({ embeds: [embed] });
            console.log(`[listener] Posted sale: ${metadata.name}`);
          } else {
            console.warn("[listener] No sales channel set — use /settings channel sales");
          }
        }
      }

      lastBlock = toBlock;
    } catch (err) {
      console.error("[listener] Poll error:", err);
      provider = null;
      state.connected = false;
    }
  }

  async function run(): Promise<void> {
    while (true) {
      if (!provider) {
        try {
          await connect();
        } catch (err) {
          console.error("[listener] Connection failed:", err);
          state.connected = false;
          console.log("[listener] Retrying in 30s...");
          await sleep(30_000);
          continue;
        }
      }

      await pollLogs();
      await sleep(config.cronos.pollIntervalMs);
    }
  }

  run().catch((err) => {
    console.error("[listener] Fatal error:", err);
    process.exit(1);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
