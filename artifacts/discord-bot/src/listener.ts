import type { TextChannel } from "discord.js";
import { buildListingEmbed } from "./embeds.js";
import { config } from "./config.js";
import { loadSeenIds, markSeen } from "./seenListings.js";

export interface ListenerState {
  listingsChannel: TextChannel | null;
  trackedCollections: Set<string>;
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

export async function startListener(state: ListenerState): Promise<void> {
  console.log("[listener] Starting MANE NFT listener (listings only)");

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
          nftName:            listing.nftName,
          nftImage:           listing.nftImage,
          collectionName:     listing.nftContractName,
          tokenId:            listing.tokenId,
          seller:             listing.sellerAddress,
          price:              listing.price,
          paymentTokenSymbol: listing.paymentTokenSymbol,
          listingUrl,
        });

        const channel = state.listingsChannel;
        if (!channel) {
          // No channel configured yet — skip without marking seen so it's retried once one is set
          console.warn("[listener] No listings channel set — use /settings channel listings");
          continue;
        }

        try {
          await channel.send({ embeds: [embed] });
          console.log(`[listener] Posted listing: ${listing.nftName ?? listing.id}`);
        } catch (sendErr) {
          console.error(`[listener] Failed to post listing embed for ${listing.id}:`, sendErr);
          // Don't mark as seen — retry next poll
          continue;
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
    while (true) {
      await pollNewListings();
      await sleep(config.cronos.pollIntervalMs);
    }
  }

  run().catch((err) => {
    console.error("[listener] Fatal error:", err);
    process.exit(1);
  });
}
