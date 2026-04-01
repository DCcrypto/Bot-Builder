import { EmbedBuilder } from "discord.js";
import { ethers } from "ethers";

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
  tokenSymbol: string;
  amountBought: string;
  spentAmount: string;
  spentSymbol: string;
  buyer: string;
  txHash: string;
  bubbles: string;
  imageUrl: string | null;
}

export function buildBuyEmbed(input: BuyEmbedInput): EmbedBuilder {
  const {
    tokenSymbol,
    amountBought,
    spentAmount,
    spentSymbol,
    buyer,
    txHash,
    bubbles,
    imageUrl,
  } = input;

  const txUrl = `https://explorer.cronos.org/tx/${txHash}`;

  const embed = new EmbedBuilder()
    .setColor(BUY_COLOR)
    .setTitle(`${bubbles} New ${tokenSymbol} Buy!`)
    .setURL(txUrl)
    .addFields(
      { name: `${tokenSymbol} Bought`, value: amountBought, inline: true },
      { name: "Spent", value: `${spentAmount} ${spentSymbol}`, inline: true },
      { name: "Buyer", value: `\`${shortenAddr(buyer)}\``, inline: true }
    )
    .setFooter({ text: `Tx: ${shortenAddr(txHash)} · Cronos` })
    .setTimestamp();

  if (imageUrl) embed.setImage(imageUrl);

  return embed;
}
