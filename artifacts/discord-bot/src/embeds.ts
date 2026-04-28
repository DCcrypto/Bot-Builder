import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { ethers } from "ethers";
import type { PriceData } from "./priceChecker.js";

const LISTING_COLOR = 0x9b59b6;
const SALE_COLOR = 0x2ecc71;
const MINT_COLOR = 0xffd700;
const BUY_COLOR = 0x00e676;

function ipfsToHttp(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    return `https://nftstorage.link/ipfs/${uri.slice(7)}`;
  }
  return uri;
}

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

function buildDescription(
  collectionName: string | null,
  tokenId: string | null
): string | null {
  if (collectionName && tokenId) return `**${collectionName}** · Token #${tokenId}`;
  if (collectionName) return collectionName;
  return null;
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
  const description = buildDescription(collectionName, tokenId);

  const embed = new EmbedBuilder()
    .setColor(LISTING_COLOR)
    .setTitle(title)
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
      }
    )
    .setTimestamp();

  if (description) embed.setDescription(description);
  if (nftImage) embed.setImage(nftImage);

  return embed;
}

export interface MintEmbedInput {
  tokenId: string;
  owner: string;
  collectionName: string;
  metadata: Record<string, unknown>;
  txHash: string;
  contractAddress: string;
}

export function buildMintEmbed(input: MintEmbedInput): EmbedBuilder {
  const { tokenId, owner, collectionName, metadata, txHash } = input;

  const rawName = metadata["name"] as string | undefined;
  const nftName = rawName ?? (collectionName ? `${collectionName} #${tokenId}` : `Token #${tokenId}`);

  const rawImage = metadata["image"] as string | undefined;
  const imageUrl = rawImage ? ipfsToHttp(rawImage) : null;

  const rawDesc = metadata["description"] as string | undefined;
  const descText = rawDesc
    ? rawDesc.length > 200 ? rawDesc.slice(0, 197) + "…" : rawDesc
    : collectionName
    ? `**${collectionName}** · Token #${tokenId}`
    : `Token #${tokenId}`;

  const attributes = metadata["attributes"] as
    | Array<{ trait_type?: unknown; value?: unknown }>
    | undefined;

  const embed = new EmbedBuilder()
    .setColor(MINT_COLOR)
    .setTitle(`🪙 New Mint — ${nftName}`)
    .setDescription(descText)
    .addFields(
      { name: "Token ID", value: `#${tokenId}`, inline: true },
      { name: "Minted To", value: `\`${shortenAddr(owner)}\``, inline: true }
    )
    .setFooter({ text: `Tx: ${shortenAddr(txHash)} · Cronos` })
    .setTimestamp();

  if (attributes && attributes.length > 0) {
    const traitFields = attributes.slice(0, 8).map((attr) => ({
      name: String(attr.trait_type ?? "Trait"),
      value: String(attr.value ?? "—"),
      inline: true,
    }));
    embed.addFields(...traitFields);
  }

  if (imageUrl) embed.setImage(imageUrl);

  return embed;
}

const PRICE_COLOR_GREEN = 0x2ecc71;
const PRICE_COLOR_RED = 0xe74c3c;
const PRICE_COLOR_GREY = 0x95a5a6;

function fmtUsd(val: number | null): string {
  if (val === null || isNaN(val)) return "N/A";
  if (val === 0) return "$0.00";
  if (Math.abs(val) < 0.000001) return `$${val.toExponential(4)}`;
  if (Math.abs(val) < 0.0001) return `$${val.toFixed(8)}`;
  if (Math.abs(val) < 0.01) return `$${val.toFixed(6)}`;
  if (Math.abs(val) < 1) return `$${val.toFixed(4)}`;
  return `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function fmtLarge(val: number | null): string {
  if (val === null || isNaN(val)) return "N/A";
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(2)}K`;
  return `$${val.toFixed(2)}`;
}

function fmtChange(val: number | null): string {
  if (val === null || isNaN(val)) return "—";
  const sign = val >= 0 ? "▲" : "▼";
  return `${sign} ${Math.abs(val).toFixed(2)}%`;
}

function fmtNative(val: number | null, symbol: string): string {
  if (val === null || isNaN(val) || val <= 0) return "N/A";
  if (val < 0.000001) return `${val.toExponential(4)} ${symbol}`;
  if (val < 0.01) return `${val.toFixed(8)} ${symbol}`;
  if (val < 1) return `${val.toFixed(6)} ${symbol}`;
  return `${val.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${symbol}`;
}

export interface PriceEmbedResult {
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
}

export function buildPriceEmbed(data: PriceData): PriceEmbedResult {
  const change24h = data.change24h;
  const color =
    change24h === null ? PRICE_COLOR_GREY
    : change24h > 0 ? PRICE_COLOR_GREEN
    : change24h < 0 ? PRICE_COLOR_RED
    : PRICE_COLOR_GREY;

  const displayName =
    data.name && data.name !== data.symbol
      ? `${data.name} (${data.symbol})`
      : data.symbol;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`📊 ${displayName} — Price`)
    .addFields(
      { name: "💵 Price (USD)", value: fmtUsd(data.priceUsd), inline: true },
      { name: "🔗 Price (CRO)", value: fmtNative(data.priceCro, "CRO"), inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "5m", value: fmtChange(data.change5m), inline: true },
      { name: "1h", value: fmtChange(data.change1h), inline: true },
      { name: "6h", value: fmtChange(data.change6h), inline: true },
      { name: "24h", value: fmtChange(data.change24h), inline: true },
      { name: "📦 24h Volume", value: fmtLarge(data.volume24h), inline: true },
      { name: "💧 Liquidity", value: fmtLarge(data.liquidityUsd), inline: true },
      { name: "📈 Market Cap", value: fmtLarge(data.marketCap), inline: true },
      { name: "🏷️ FDV", value: fmtLarge(data.fdv), inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
    )
    .setFooter({ text: `Cronos · Pair: ${data.pairAddress.slice(0, 10)}...` })
    .setTimestamp();

  if (data.chartImageValid) embed.setImage(data.chartImageUrl);
  if (data.logoUrl) embed.setThumbnail(data.logoUrl);

  const cronosExplorerUrl = `https://explorer.cronos.org/address/${data.tokenAddress}`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("View on DexScreener")
      .setURL(data.dexscreenerUrl)
      .setStyle(ButtonStyle.Link)
      .setEmoji("📈"),
    new ButtonBuilder()
      .setLabel("Cronos Explorer")
      .setURL(cronosExplorerUrl)
      .setStyle(ButtonStyle.Link)
      .setEmoji("🔍")
  );

  return { embed, components: [row] };
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
  const description = buildDescription(collectionName, tokenId);

  const priceLabel =
    paymentTokenSymbol === "CRO" || paymentTokenSymbol === ""
      ? "Sale Price"
      : `Sale Price (CRO value)`;

  const embed = new EmbedBuilder()
    .setColor(SALE_COLOR)
    .setTitle(title)
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
      }
    )
    .setFooter({ text: `Tx: ${shortenAddr(txHash)} · Cronos` })
    .setTimestamp();

  if (description) embed.setDescription(description);
  if (nftImage) embed.setImage(nftImage);

  return embed;
}

export interface BuyEmbedInput {
  tokenName: string;
  tokenSymbol: string;
  amountBought: string;
  spentAmount: string;
  spentSymbol: string;
  buyer: string;
  txHash: string;
  bubbles: string;
  imageUrl: string | null;
  change24h?: number | null;
  chartImageUrl?: string | null;
  chartImageValid?: boolean;
}

export function buildBuyEmbed(input: BuyEmbedInput): EmbedBuilder {
  const {
    tokenName,
    tokenSymbol,
    amountBought,
    spentAmount,
    spentSymbol,
    buyer,
    txHash,
    bubbles,
    imageUrl,
    change24h,
    chartImageUrl,
    chartImageValid,
  } = input;

  const txUrl = `https://explorer.cronos.org/tx/${txHash}`;
  const displayName = tokenName && tokenName !== tokenSymbol ? `${tokenName} (${tokenSymbol})` : tokenSymbol;

  const embed = new EmbedBuilder()
    .setColor(BUY_COLOR)
    .setTitle(`${bubbles} New ${displayName} Buy!`)
    .setURL(txUrl)
    .addFields(
      { name: `${tokenSymbol} Bought`, value: amountBought, inline: true },
      { name: "Spent", value: `${spentAmount} ${spentSymbol}`, inline: true },
      { name: "Buyer", value: `\`${shortenAddr(buyer)}\``, inline: true }
    )
    .setFooter({ text: `Tx: ${shortenAddr(txHash)} · Cronos` })
    .setTimestamp();

  if (change24h !== undefined && change24h !== null) {
    embed.addFields({ name: "24h", value: fmtChange(change24h), inline: true });
  }

  if (chartImageValid && chartImageUrl) {
    embed.setImage(chartImageUrl);
    if (imageUrl) embed.setThumbnail(imageUrl);
  } else if (imageUrl) {
    embed.setImage(imageUrl);
  }

  return embed;
}
