import type { TextChannel } from "discord.js";
import { buildListingEmbed } from "./embeds.js";
import { config } from "./config.js";
import { markSeen } from "./seenListings.js";

export interface GuildState {
  guildId: string;
  listingsChannel: TextChannel | null;
  mintsChannel: TextChannel | null;
  mintContractAddress: string | null;
  trackedCollections: Set<string>;
  relistCooldownMs: number;
  seenListingIds: Set<string>;
  recentNfts: Map<string, number>;
  buysChannel: TextChannel | null;
  buyTokenAddress: string | null;
  buyPairAddress: string | null;
  minBuyCro: number;
  buyImageUrl: string | null;
  buyEmoji: string;
  buyRates: [number, number, number, number];
  seenBuyTxHashes: Set<string>;
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

function isTrackedCollection(state: GuildState, nftContract: string): boolean {
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

const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export async function startListener(guildStates: Map<string, GuildState>): Promise<void> {
  console.log("[listener] Starting MANE NFT listener (multi-guild)");

  function nftKey(listing: ApiListing): string {
    return `${listing.nftContractAddress.toLowerCase()}:${listing.tokenId}`;
  }

  async function pollNewListings(): Promise<void> {
    if (guildStates.size === 0) return;

    let listings: ApiListing[];
    try {
      listings = await fetchListings();
    } catch (err) {
      console.error("[listener] API listings poll error:", err);
      return;
    }

    for (const [guildId, state] of guildStates) {
      if (!state.listingsChannel) continue;

      const newlySeen: string[] = [];

      for (const listing of listings) {
        if (state.seenListingIds.has(listing.id)) continue;

        if (listing.status === "sold" || !isTrackedCollection(state, listing.nftContractAddress)) {
          state.seenListingIds.add(listing.id);
          newlySeen.push(listing.id);
          continue;
        }

        if (listing.status !== "active") continue;

        const cooldownMs = state.relistCooldownMs ?? DEFAULT_COOLDOWN_MS;
        if (cooldownMs > 0) {
          const key = nftKey(listing);
          const lastAt = state.recentNfts.get(key);
          if (lastAt !== undefined && Date.now() - lastAt < cooldownMs) {
            console.log(`[listener] [${guildId}] Cooldown skip: ${listing.nftName ?? listing.id}`);
            state.seenListingIds.add(listing.id);
            newlySeen.push(listing.id);
            continue;
          }
        }

        const listingUrl = `${config.site.baseUrl}/marketplace`;
        const embed = buildListingEmbed({
          nftName: listing.nftName,
          nftImage: listing.nftImage,
          collectionName: listing.nftContractName,
          tokenId: listing.tokenId,
          seller: listing.sellerAddress,
          price: listing.price,
          paymentTokenSymbol: listing.paymentTokenSymbol,
          listingUrl,
        });

        try {
          await state.listingsChannel.send({ embeds: [embed] });
          console.log(
            `[listener] [${guildId}] Posted: ${listing.nftName ?? listing.id} → #${state.listingsChannel.name}`
          );
        } catch (sendErr) {
          console.error(`[listener] [${guildId}] Failed to post listing ${listing.id}:`, sendErr);
          continue;
        }

        state.seenListingIds.add(listing.id);
        newlySeen.push(listing.id);
        if (cooldownMs > 0) {
          state.recentNfts.set(nftKey(listing), Date.now());
        }
      }

      if (newlySeen.length > 0) {
        markSeen(guildId, newlySeen);
      }
    }
  }

  async function run(): Promise<void> {
    while (true) {
      try {
        await pollNewListings();
      } catch (err) {
        console.error("[listener] Unexpected poll error (will retry):", err);
      }
      await sleep(config.cronos.pollIntervalMs);
    }
  }

  run().catch((err) => {
    console.error("[listener] Run loop exited unexpectedly:", err);
  });
}
