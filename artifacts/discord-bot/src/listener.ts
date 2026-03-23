import { ethers } from "ethers";
import type { TextChannel } from "discord.js";
import { buildListingEmbed, buildSaleEmbed } from "./embeds.js";
import { config } from "./config.js";
import { loadSeenIds, markSeen } from "./seenListings.js";
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

async function lookupListingBySellerAndContract(
  nftContract: string,
  seller: string
): Promise<ApiListing | null> {
  try {
    const listings = await fetchListings();
    // Find a listing matching seller + nftContract, preferring sold status
    // but accepting active too since the API may not have updated yet
    const matches = listings.filter(
      (l) =>
        l.nftContractAddress.toLowerCase() === nftContract.toLowerCase() &&
        l.sellerAddress.toLowerCase() === seller.toLowerCase()
    );
    const sold = matches.find((l) => l.status === "sold");
    return sold ?? matches[0] ?? null;
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

  const seenSaleTxHashes = new Set<string>();

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
        // Separate parse errors (expected) from post errors (bugs)
        let parsed;
        try {
          parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        } catch {
          continue; // log from a different event, skip
        }
        if (!parsed || parsed.name !== "Sold") continue;

        const txHash = log.transactionHash;
        if (seenSaleTxHashes.has(txHash)) continue;

        const buyer       = parsed.args["buyer"] as string;
        const seller      = parsed.args["seller"] as string;
        const nftContract = parsed.args["nftContract"] as string;
        const croAmount   = parsed.args["croAmount"] as bigint;

        if (!isTrackedCollection(state, nftContract)) {
          console.log(`[listener] Sale skipped — not tracked: ${nftContract}`);
          seenSaleTxHashes.add(txHash);
          continue;
        }

        console.log(`[listener] On-chain Sale: seller=${seller} tx=${txHash}`);

        try {
          const listing = await lookupListingBySellerAndContract(nftContract, seller);
          const listingUrl = `${config.site.baseUrl}/marketplace`;

          const embed = buildSaleEmbed({
            nftName:            listing?.nftName ?? null,
            nftImage:           listing?.nftImage ?? null,
            collectionName:     listing?.nftContractName ?? null,
            tokenId:            listing?.tokenId ?? null,
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
            console.log(`[listener] Posted sale: ${listing?.nftName ?? `tx ${txHash.slice(0, 10)}`}`);
          } else {
            console.warn("[listener] No sales channel configured — use /settings channel sales");
          }
        } catch (postErr) {
          console.error(`[listener] Failed to post sale embed for tx ${txHash}:`, postErr);
        }

        seenSaleTxHashes.add(txHash);
      }

      lastBlock = toBlock;
    } catch (err) {
      console.error("[listener] On-chain poll error:", err);
      provider = null;
      state.connected = false;
    }
  }

  const announcedListingIds: Set<string> = loadSeenIds();
  let seeded = false;

  async function pollNewListings(): Promise<void> {
    try {
      const listings = await fetchListings();

      if (!seeded) {
        const allIds = listings.map((l) => l.id);
        const newIds = allIds.filter((id) => !announcedListingIds.has(id));
        if (newIds.length > 0) {
          newIds.forEach((id) => announcedListingIds.add(id));
          markSeen(allIds);
          console.log(`[listener] Seeded ${allIds.length} existing listings — will only announce new ones going forward`);
        }
        seeded = true;
        return;
      }

      for (const listing of listings) {
        if (announcedListingIds.has(listing.id)) continue;

        // Mark non-active listings and untracked collections as seen without posting
        if (listing.status !== "active" || !isTrackedCollection(state, listing.nftContractAddress)) {
          announcedListingIds.add(listing.id);
          markSeen([listing.id]);
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
          try {
            await channel.send({ embeds: [embed] });
            console.log(`[listener] Posted listing: ${listing.nftName ?? listing.id}`);
          } catch (sendErr) {
            console.error(`[listener] Failed to post listing embed for ${listing.id}:`, sendErr);
            // Don't mark as seen — retry next poll
            continue;
          }
        } else {
          console.warn("[listener] No listings channel set — use /settings channel listings");
        }

        // Persist immediately so a crash/restart can't re-announce
        announcedListingIds.add(listing.id);
        markSeen([listing.id]);
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
