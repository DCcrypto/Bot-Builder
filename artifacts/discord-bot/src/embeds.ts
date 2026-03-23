import { EmbedBuilder } from "discord.js";
import { ethers } from "ethers";

const LISTING_COLOR = 0x9b59b6;
const SALE_COLOR = 0x2ecc71;

function shortenAddr(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatPrice(price: string | bigint, symbol: string): string {
  if (typeof price === "bigint") {
    const val = parseFloat(ethers.formatEther(price));
    return `${val.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${symbol}`;
  }
  const val = parseFloat(price);
  return `${val.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${symbol}`;
}

export interface ListingEmbedInput {
  nftName: string | null;
  nftImage: string | null;
  collectionName: string | null;
  tokenId: string | null;
  seller: string;
  price: string;
  paymentTokenSymbol: string;
  listingUrl: string;
}

export function buildListingEmbed(input: ListingEmbedInput): EmbedBuilder {
  const {
    nftName,
    nftImage,
    collectionName,
    tokenId,
    seller,
    price,
    paymentTokenSymbol,
    listingUrl,
  } = input;

  const title = nftName ? `🏷️ New Listing — ${nftName}` : "🏷️ New Listing";
  const description =
    collectionName && tokenId
      ? `**${collectionName}** · Token #${tokenId}`
      : collectionName ?? "";

  const embed = new EmbedBuilder()
    .setColor(LISTING_COLOR)
    .setTitle(title)
    .setDescription(description)
    .setURL(listingUrl)
    .addFields(
      {
        name: "Price",
        value: formatPrice(price, paymentTokenSymbol),
        inline: true,
      },
      {
        name: "Seller",
        value: `\`${shortenAddr(seller)}\``,
        inline: true,
      },
      {
        name: "View Listing",
        value: `[Open on MANE NFT](${listingUrl})`,
        inline: false,
      }
    )
    .setTimestamp();

  if (nftImage) embed.setImage(nftImage);

  return embed;
}

export interface SaleEmbedInput {
  nftName: string | null;
  nftImage: string | null;
  collectionName: string | null;
  tokenId: string | null;
  buyer: string;
  seller: string;
  croAmount: bigint;
  paymentTokenSymbol: string;
  listingUrl: string;
  txHash: string;
}

export function buildSaleEmbed(input: SaleEmbedInput): EmbedBuilder {
  const {
    nftName,
    nftImage,
    collectionName,
    tokenId,
    buyer,
    seller,
    croAmount,
    paymentTokenSymbol,
    listingUrl,
    txHash,
  } = input;

  const title = nftName ? `🎉 NFT Sold — ${nftName}` : "🎉 NFT Sold";
  const description =
    collectionName && tokenId
      ? `**${collectionName}** · Token #${tokenId}`
      : collectionName ?? "";

  const priceLabel = paymentTokenSymbol === "CRO" || paymentTokenSymbol === ""
    ? "Sale Price"
    : `Sale Price (CRO value)`;

  const embed = new EmbedBuilder()
    .setColor(SALE_COLOR)
    .setTitle(title)
    .setDescription(description)
    .setURL(listingUrl)
    .addFields(
      {
        name: priceLabel,
        value: formatPrice(croAmount, "CRO"),
        inline: true,
      },
      {
        name: "Buyer",
        value: `\`${shortenAddr(buyer)}\``,
        inline: true,
      },
      {
        name: "Seller",
        value: `\`${shortenAddr(seller)}\``,
        inline: true,
      },
      {
        name: "View Item",
        value: `[Open on MANE NFT](${listingUrl})`,
        inline: false,
      }
    )
    .setFooter({ text: `Tx: ${shortenAddr(txHash)} · Cronos` })
    .setTimestamp();

  if (nftImage) embed.setImage(nftImage);

  return embed;
}
