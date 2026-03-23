import { ethers } from "ethers";
import type { TextChannel } from "discord.js";
import { buildListingEmbed, buildSaleEmbed } from "./embeds.js";
import { config } from "./config.js";
import marketplaceAbi from "./abi/marketplace.json" assert { type: "json" };

export interface ListenerState {
  listingsChannel: TextChannel | null;
  salesChannel: TextChannel | null;
  trackedCollections: Set<string>;
  connected: boolean;
}

export interface ApiListing {
  id: string;
  nftContractAddress: string;
  nftContractName: string | null;
  tokenId: string;
  sellerAddress: string;
  buyerAddress: string | null;
  price: string;
  paymentTokenSymbol: string;
  paymentTokenAddress: string;
  status: "active" | "sold" | string;
  nftName: string | null;
  nftImage: string | null;
  listedAt: string;
  soldAt: string | null;
  listingType: string;
}

function isTrackedCollection(state: ListenerState, nftContract: string): boolean {
  if (state.trackedCollections.size === 0) return true;
  return state.trackedCollections.has(nftContract.toLowerCase());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function fetchListings(): Promise<ApiListing[]> {
  const url = `${config.site.baseUrl}/api/listings`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`API listings returned ${res.status}`);
  return (await res.json()) as ApiListing[];
}

async function lookupSoldListing(
  nftContract: string,
  seller: string
): Promise<ApiListing | null> {
  try {
    const listings = await fetchListings();
    const match = listings.find(
      (l) =>
        l.nftContractAddress.toLowerCase() === nftContract.toLowerCase() &&
        l.sellerAddress.toLowerCase() === seller.toLowerCase() &&
        l.status === "sold"
    );
    return match ?? null;
  } catch {
    return null;
  }
}

export async function startListener(state: ListenerState): Promise<void> {
  console.log("[listener] Starting MANE NFT listener (API + on-chain)");

  const iface = new ethers.Interface(marketplaceAbi as ethers.InterfaceAbi);
  const marketplaceAddress = ethers.getAddress(config.cronos.marketplaceAddress);

  let provider: ethers.JsonRpcProvider | null = null;
  let lastBlock = 0;

  async function connectChain(): Promise<void> {
    provider = new ethers.JsonRpcProvider(config.cronos.rpcUrl);
    const network = await provider.getNetwork();
    console.log(`[listener] Connected to Cronos (chainId: ${network.chainId})`);
    lastBlock = await provider.getBlockNumber();
    state.connected = true;
    console.log(`[listener] On-chain poll starting from block: ${lastBlock}`);
  }

  async function pollSalesOnChain(): Promise<void> {
    if (!provider) return;
    try {
      const currentBlock = await provider.getBlockNumber();
      if (currentBlock <= lastBlock) return;

      const fromBlock = lastBlock + 1;
      const toBlock = Math.min(currentBlock, fromBlock + 1999);

      const logs = await provider.getLogs({
        address: marketplaceAddress,
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (!parsed || parsed.name !== "Sold") continue;

          const buyer       = parsed.args["buyer"] as string;
          const seller      = parsed.args["seller"] as string;
          const nftContract = parsed.args["nftContract"] as string;
          const croAmount   = parsed.args["croAmount"] as bigint;
          const txHash      = log.transactionHash;

          if (!isTrackedCollection(state, nftContract)) {
            console.log(`[listener] Sale skipped — not tracked: ${nftContract}`);
            continue;
          }

          console.log(`[listener] On-chain Sale: seller=${seller} tx=${txHash}`);

          const listing = await lookupSoldListing(nftContract, seller);
          const listingUrl = `${config.site.baseUrl}/marketplace`;

          const embed = buildSaleEmbed({
            nftName:         listing?.nftName ?? null,
            nftImage:        listing?.nftImage ?? null,
            collectionName:  listing?.nftContractName ?? null,
            tokenId:         listing?.tokenId ?? null,
            buyer,
            seller,
            croAmount,
            paymentTokenSymbol: listing?.paymentTokenSymbol ?? "CRO",
            listingUrl,
            txHash,
          });

          const channel = state.salesChannel ?? state.listingsChannel;
          if (channel) {
            await channel.send({ embeds: [embed] });
            console.log(`[listener] Posted sale embed → ${listingUrl}`);
          } else {
            console.warn("[listener] No sales channel set — use /settings channel sales");
          }
        } catch (parseErr) {
          // Log not from this contract's known events — skip
        }
      }

      lastBlock = toBlock;
    } catch (err) {
      console.error("[listener] On-chain poll error:", err);
      provider = null;
      state.connected = false;
    }
  }

  let lastListingAnnouncedAt = new Date().toISOString();
  const announcedListingIds = new Set<string>();

  async function pollNewListings(): Promise<void> {
    try {
      const listings = await fetchListings();
      const now = lastListingAnnouncedAt;

      for (const listing of listings) {
        if (announcedListingIds.has(listing.id)) continue;
        if (listing.status !== "active") continue;
        if (!listing.listedAt || listing.listedAt <= now) continue;

        if (!isTrackedCollection(state, listing.nftContractAddress)) {
          announcedListingIds.add(listing.id);
          continue;
        }

        const listingUrl = `${config.site.baseUrl}/marketplace`;
        const embed = buildListingEmbed({
          nftName:        listing.nftName,
          nftImage:       listing.nftImage,
          collectionName: listing.nftContractName,
          tokenId:        listing.tokenId,
          seller:         listing.sellerAddress,
          price:          listing.price,
          paymentTokenSymbol: listing.paymentTokenSymbol,
          listingUrl,
        });

        const channel = state.listingsChannel ?? state.salesChannel;
        if (channel) {
          await channel.send({ embeds: [embed] });
          console.log(`[listener] Posted listing: ${listing.nftName ?? listing.id} → ${listingUrl}`);
        } else {
          console.warn("[listener] No listings channel set — use /settings channel listings");
        }

        announcedListingIds.add(listing.id);
      }

      const newest = listings
        .filter((l) => l.status === "active" && l.listedAt)
        .map((l) => l.listedAt!)
        .sort()
        .at(-1);
      if (newest && newest > lastListingAnnouncedAt) {
        lastListingAnnouncedAt = newest;
      }
    } catch (err) {
      console.error("[listener] API listings poll error:", err);
    }
  }

  async function run(): Promise<void> {
    try {
      await connectChain();
    } catch (err) {
      console.error("[listener] Initial chain connection failed:", err);
      state.connected = false;
    }

    while (true) {
      if (!provider) {
        try {
          await connectChain();
        } catch (err) {
          console.error("[listener] Reconnect failed:", err);
          await sleep(30_000);
          continue;
        }
      }

      await Promise.allSettled([pollSalesOnChain(), pollNewListings()]);
      await sleep(config.cronos.pollIntervalMs);
    }
  }

  run().catch((err) => {
    console.error("[listener] Fatal error:", err);
    process.exit(1);
  });
}
