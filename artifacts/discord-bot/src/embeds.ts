import { EmbedBuilder } from "discord.js";
import { ethers } from "ethers";
import type { NftMetadata } from "./metadata.js";

const LISTING_COLOR = 0x9b59b6;
const SALE_COLOR = 0x2ecc71;
const CRO_SYMBOL = "CRO";

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatCro(wei: bigint): string {
  const cro = parseFloat(ethers.formatEther(wei));
  return `${cro.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${CRO_SYMBOL}`;
}

export function buildListingEmbed(
  metadata: NftMetadata,
  seller: string,
  price: bigint,
  siteUrl: string,
  txHash: string
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(LISTING_COLOR)
    .setTitle(`🏷️ New Listing — ${metadata.name}`)
    .setDescription(`**${metadata.collectionName}** · Token #${metadata.tokenId}`)
    .addFields(
      { name: "Price", value: formatCro(price), inline: true },
      { name: "Seller", value: formatAddress(seller), inline: true },
      {
        name: "View Listing",
        value: `[Open on MANE NFT](${siteUrl})`,
        inline: false,
      }
    )
    .setFooter({ text: `Tx: ${formatAddress(txHash)} · Cronos` })
    .setTimestamp();

  if (metadata.image) {
    embed.setThumbnail(metadata.image);
  }

  return embed;
}

export function buildSaleEmbed(
  metadata: NftMetadata,
  buyer: string,
  seller: string,
  price: bigint,
  siteUrl: string,
  txHash: string
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(SALE_COLOR)
    .setTitle(`🎉 NFT Sold — ${metadata.name}`)
    .setDescription(`**${metadata.collectionName}** · Token #${metadata.tokenId}`)
    .addFields(
      { name: "Sale Price", value: formatCro(price), inline: true },
      { name: "Buyer", value: formatAddress(buyer), inline: true },
      { name: "Seller", value: formatAddress(seller), inline: true },
      {
        name: "View Item",
        value: `[Open on MANE NFT](${siteUrl})`,
        inline: false,
      }
    )
    .setFooter({ text: `Tx: ${formatAddress(txHash)} · Cronos` })
    .setTimestamp();

  if (metadata.image) {
    embed.setThumbnail(metadata.image);
  }

  return embed;
}
