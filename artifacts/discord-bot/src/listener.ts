import { ethers } from "ethers";
import type { TextChannel } from "discord.js";
import { fetchNftMetadata, fetchListingNftInfo } from "./metadata.js";
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
  listingId: string;
  seller: string;
  nftContract: string;
  tokenId: bigint;
  price: bigint;
};

type DecodedSaleEvent = {
  kind: "sale";
  listingId: string;
  buyer: string;
  seller: string;
  price: bigint;
};

type DecodedEvent = DecodedListingEvent | DecodedSaleEvent;

function tryDecodeLog(
  iface: ethers.Interface,
  log: ethers.Log
): DecodedEvent | null {
  try {
    const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
    if (!parsed) return null;

    if (parsed.name === "Listed") {
      return {
        kind: "listing",
        listingId: (parsed.args["listingId"] as bigint).toString(),
        seller: parsed.args["seller"] as string,
        nftContract: parsed.args["nftContract"] as string,
        tokenId: parsed.args["tokenId"] as bigint,
        price: parsed.args["price"] as bigint,
      };
    }

    if (parsed.name === "Sold") {
      return {
        kind: "sale",
        listingId: (parsed.args["listingId"] as bigint).toString(),
        buyer: parsed.args["buyer"] as string,
        seller: parsed.args["seller"] as string,
        price: parsed.args["price"] as bigint,
      };
    }

    if (parsed.name === "Cancelled") {
      console.log(
        `[listener] Listing ${(parsed.args["listingId"] as bigint).toString()} cancelled by ${parsed.args["seller"] as string}`
      );
    }

    return null;
  } catch {
    return null;
  }
}

function isTrackedCollection(state: ListenerState, nftContract: string): boolean {
  if (state.trackedCollections.size === 0) return true;
  return state.trackedCollections.has(nftContract.toLowerCase());
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
          if (!isTrackedCollection(state, decoded.nftContract)) {
            console.log(`[listener] Skipping — collection not tracked: ${decoded.nftContract}`);
            continue;
          }

          console.log(`[listener] Listed: listingId=${decoded.listingId} tx=${txHash}`);

          const metadata = await fetchNftMetadata(provider, decoded.nftContract, decoded.tokenId);
          const listingUrl = `${config.site.baseUrl}/listings/${decoded.listingId}`;
          const embed = buildListingEmbed(metadata, decoded.seller, decoded.price, listingUrl, txHash);

          const channel = state.listingsChannel ?? state.salesChannel;
          if (channel) {
            await channel.send({ embeds: [embed] });
            console.log(`[listener] Posted listing: ${metadata.name} → ${listingUrl}`);
          } else {
            console.warn("[listener] No listings channel — use /settings channel listings");
          }
        } else if (decoded.kind === "sale") {
          console.log(`[listener] Sold: listingId=${decoded.listingId} tx=${txHash}`);

          const listingUrl = `${config.site.baseUrl}/listings/${decoded.listingId}`;

          const nftInfo = await fetchListingNftInfo(decoded.listingId);
          let metadata = null;
          if (nftInfo && isTrackedCollection(state, nftInfo.nftContract)) {
            metadata = await fetchNftMetadata(provider, nftInfo.nftContract, nftInfo.tokenId);
          } else if (nftInfo && state.trackedCollections.size > 0) {
            console.log(`[listener] Skipping sale — collection not tracked: ${nftInfo.nftContract}`);
            continue;
          } else if (nftInfo) {
            metadata = await fetchNftMetadata(provider, nftInfo.nftContract, nftInfo.tokenId);
          }

          const embed = buildSaleEmbed(
            metadata,
            decoded.buyer,
            decoded.seller,
            decoded.price,
            decoded.listingId,
            listingUrl,
            txHash
          );

          const channel = state.salesChannel ?? state.listingsChannel;
          if (channel) {
            await channel.send({ embeds: [embed] });
            console.log(`[listener] Posted sale: listing #${decoded.listingId} → ${listingUrl}`);
          } else {
            console.warn("[listener] No sales channel — use /settings channel sales");
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
