import {
  SlashCommandBuilder,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type Client,
  type TextChannel,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
} from "discord.js";
import { ethers } from "ethers";
import {
  getGuildSettings,
  setListingsChannel,
  setMintsChannel,
  setMintContract,
  clearMintContract,
  setCooldown,
  setOnlyCollection,
  clearTrackedCollections,
  addTrackedCollection,
  removeTrackedCollection,
  setBuysChannel,
  setBuyToken,
  setMinBuyCro,
  setBuyImage,
  setBuyEmoji,
  setBuyRates,
  clearBuyConfig,
} from "./settings.js";
import type { GuildState } from "./listener.js";
import { loadSeenIds } from "./seenListings.js";
import { loadSeenBuyTxHashes } from "./seenBuys.js";
import { priceCommand, handlePriceInteraction } from "./priceCommands.js";

export const settingsCommand = new SlashCommandBuilder()
  .setName("settings")
  .setDescription("Configure the MANE NFT Discord bot")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub.setName("status").setDescription("Show current bot settings")
  )
  .addSubcommand((sub) =>
    sub.setName("refresh").setDescription("Re-read settings and reconnect channels — fixes stale bot state without a full restart")
  )
  .addSubcommandGroup((group) =>
    group
      .setName("channel")
      .setDescription("Configure announcement channels")
      .addSubcommand((sub) =>
        sub
          .setName("listings")
          .setDescription("Set the channel for new NFT listing announcements")
          .addChannelOption((opt) =>
            opt
              .setName("channel")
              .setDescription("The text channel to post new listings in")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("mints")
          .setDescription("Set the channel for live NFT mint announcements")
          .addChannelOption((opt) =>
            opt
              .setName("channel")
              .setDescription("The text channel to post new mints in")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("cooldown")
      .setDescription("Set the relist cooldown — how long before the same NFT can be announced again")
      .addIntegerOption((opt) =>
        opt
          .setName("hours")
          .setDescription("Cooldown in hours (0 = no cooldown, default 6)")
          .setMinValue(0)
          .setMaxValue(168)
          .setRequired(true)
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("mint")
      .setDescription("Configure the live mint tracker")
      .addSubcommand((sub) =>
        sub
          .setName("set")
          .setDescription("Set the contract address to watch for live mints")
          .addStringOption((opt) =>
            opt
              .setName("address")
              .setDescription("The NFT contract address on Cronos to track mints for (0x...)")
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub.setName("clear").setDescription("Stop tracking mints (clear the mint contract)")
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("collection")
      .setDescription("Manage tracked NFT collections")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Add an NFT collection contract address to track")
          .addStringOption((opt) =>
            opt
              .setName("address")
              .setDescription("The NFT contract address on Cronos (0x...)")
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Stop tracking an NFT collection")
          .addStringOption((opt) =>
            opt
              .setName("address")
              .setDescription("The NFT contract address to remove")
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub.setName("list").setDescription("List all tracked NFT collections")
      )
      .addSubcommand((sub) =>
        sub
          .setName("set")
          .setDescription("Lock the bot to one collection only — clears any other filters")
          .addStringOption((opt) =>
            opt
              .setName("address")
              .setDescription("The NFT contract address to track exclusively (0x...)")
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("clear")
          .setDescription("Remove all collection filters — bot will announce listings from every collection")
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("buys")
      .setDescription("Configure ERC-20 token buy alerts")
      .addSubcommand((sub) =>
        sub
          .setName("channel")
          .setDescription("Set the channel for token buy alerts")
          .addChannelOption((opt) =>
            opt
              .setName("channel")
              .setDescription("The text channel to post buy alerts in")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("token")
          .setDescription("Set the token and DEX pair to watch for buys")
          .addStringOption((opt) =>
            opt
              .setName("token")
              .setDescription("The ERC-20 token contract address to track (0x...)")
              .setRequired(true)
          )
          .addStringOption((opt) =>
            opt
              .setName("pair")
              .setDescription("The DEX pair contract address (e.g. VVS Finance pair) (0x...)")
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("minbuy")
          .setDescription("Set minimum spend to trigger a buy alert (in the pair's quote token, e.g. CRO)")
          .addNumberOption((opt) =>
            opt
              .setName("amount")
              .setDescription("Minimum amount spent to post an alert (0 = no minimum)")
              .setMinValue(0)
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("image")
          .setDescription("Set a custom image or GIF URL shown in every buy alert (pass 'clear' to remove)")
          .addStringOption((opt) =>
            opt
              .setName("url")
              .setDescription("Public HTTPS URL of the image or GIF, or 'clear' to remove")
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("emoji")
          .setDescription("Set the emoji used for the buy size bubble indicator (default: 🟢)")
          .addStringOption((opt) =>
            opt
              .setName("emoji")
              .setDescription("The emoji to use, e.g. 🚀 💎 🦁")
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("rates")
          .setDescription("Set four spend thresholds that control how many bubbles appear (1–5)")
          .addNumberOption((opt) =>
            opt.setName("t1").setDescription("Threshold for 2 bubbles (e.g. 10)").setMinValue(0).setRequired(true)
          )
          .addNumberOption((opt) =>
            opt.setName("t2").setDescription("Threshold for 3 bubbles (e.g. 50)").setMinValue(0).setRequired(true)
          )
          .addNumberOption((opt) =>
            opt.setName("t3").setDescription("Threshold for 4 bubbles (e.g. 200)").setMinValue(0).setRequired(true)
          )
          .addNumberOption((opt) =>
            opt.setName("t4").setDescription("Threshold for 5 bubbles (e.g. 500)").setMinValue(0).setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub.setName("clear").setDescription("Stop buy tracking and clear all buy alert settings")
      )
  );

export async function registerCommands(client: Client): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) throw new Error("DISCORD_BOT_TOKEN not set");

  const appId = client.application?.id;
  if (!appId) throw new Error("Client application ID not available");

  const rest = new REST().setToken(token);
  const body = [settingsCommand.toJSON(), priceCommand.toJSON()];

  try {
    await rest.put(Routes.applicationCommands(appId), { body });
    console.log("[commands] Slash commands registered globally");
  } catch (err) {
    console.error("[commands] Failed to register slash commands:", err);
  }
}

function ensureGuildState(
  guildId: string,
  guildStates: Map<string, GuildState>
): GuildState {
  let state = guildStates.get(guildId);
  if (!state) {
    const s = getGuildSettings(guildId);
    state = {
      guildId,
      listingsChannel: null,
      mintsChannel: null,
      mintContractAddress: s.mintContractAddress?.toLowerCase() ?? null,
      trackedCollections: new Set(s.trackedCollections.map((a) => a.toLowerCase())),
      relistCooldownMs: (s.cooldownHours ?? 6) * 60 * 60 * 1000,
      seenListingIds: loadSeenIds(guildId),
      recentNfts: new Map(),
      buysChannel: null,
      buyTokenAddress: s.buyTokenAddress ?? null,
      buyPairAddress: s.buyPairAddress ?? null,
      minBuyCro: s.minBuyCro ?? 0,
      buyImageUrl: s.buyImageUrl ?? null,
      buyEmoji: s.buyEmoji ?? "🟢",
      buyRates: s.buyRates ?? [10, 50, 200, 500],
      seenBuyTxHashes: loadSeenBuyTxHashes(guildId),
    };
    guildStates.set(guildId, state);
  }
  return state;
}

export { priceCommand };

export async function handleInteraction(
  interaction: ChatInputCommandInteraction,
  guildStates: Map<string, GuildState>
): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "price") {
    await handlePriceInteraction(interaction, guildStates);
    return;
  }

  if (interaction.commandName !== "settings") return;

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: "⚠️ This command can only be used inside a Discord server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subgroup = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);

  console.log(`[commands] [${guildId}] /${interaction.commandName} ${subgroup ?? ""} ${sub ?? ""}`.trim());

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error(`[commands] [${guildId}] deferReply failed:`, err);
    return;
  }

  const guildState = ensureGuildState(guildId, guildStates);

  try {
    if (!subgroup && sub === "status") {
      await handleStatus(interaction, guildId, guildState);
    } else if (!subgroup && sub === "refresh") {
      await handleRefresh(interaction, guildId, guildState);
    } else if (!subgroup && sub === "cooldown") {
      await handleSetCooldown(interaction, guildId, guildState);
    } else if (subgroup === "channel" && sub === "listings") {
      await handleSetListingsChannel(interaction, guildId, guildState);
    } else if (subgroup === "channel" && sub === "mints") {
      await handleSetMintsChannel(interaction, guildId, guildState);
    } else if (subgroup === "mint" && sub === "set") {
      await handleSetMintContract(interaction, guildId, guildState);
    } else if (subgroup === "mint" && sub === "clear") {
      await handleClearMintContract(interaction, guildId, guildState);
    } else if (subgroup === "collection" && sub === "add") {
      await handleAddCollection(interaction, guildId, guildState);
    } else if (subgroup === "collection" && sub === "remove") {
      await handleRemoveCollection(interaction, guildId, guildState);
    } else if (subgroup === "collection" && sub === "list") {
      await handleListCollections(interaction, guildId);
    } else if (subgroup === "collection" && sub === "set") {
      await handleSetOnlyCollection(interaction, guildId, guildState);
    } else if (subgroup === "collection" && sub === "clear") {
      await handleClearCollections(interaction, guildId, guildState);
    } else if (subgroup === "buys" && sub === "channel") {
      await handleSetBuysChannel(interaction, guildId, guildState);
    } else if (subgroup === "buys" && sub === "token") {
      await handleSetBuyToken(interaction, guildId, guildState);
    } else if (subgroup === "buys" && sub === "minbuy") {
      await handleSetMinBuy(interaction, guildId, guildState);
    } else if (subgroup === "buys" && sub === "image") {
      await handleSetBuyImage(interaction, guildId, guildState);
    } else if (subgroup === "buys" && sub === "emoji") {
      await handleSetBuyEmoji(interaction, guildId, guildState);
    } else if (subgroup === "buys" && sub === "rates") {
      await handleSetBuyRates(interaction, guildId, guildState);
    } else if (subgroup === "buys" && sub === "clear") {
      await handleClearBuys(interaction, guildId, guildState);
    } else {
      await interaction.editReply("Unknown command.");
    }
  } catch (err) {
    console.error("[commands] Error handling interaction:", err);
    await interaction.editReply("An error occurred while processing the command.").catch(() => {});
  }
}

async function handleStatus(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  _guildState: GuildState
): Promise<void> {
  const s = getGuildSettings(guildId);

  const listingsCh = s.channelListingsId ? `<#${s.channelListingsId}>` : "Not set";
  const mintsCh = s.channelMintsId ? `<#${s.channelMintsId}>` : "Not set";
  const mintContract = s.mintContractAddress
    ? `\`${s.mintContractAddress}\``
    : "Not set — use `/settings mint set <address>`";
  const collections =
    s.trackedCollections.length > 0
      ? s.trackedCollections.map((a) => `\`${a}\``).join("\n")
      : "All collections (no filter)";
  const cooldownHours = s.cooldownHours ?? 6;
  const cooldownDisplay = cooldownHours === 0 ? "Disabled" : `${cooldownHours}h`;

  const buysCh = s.channelBuysId ? `<#${s.channelBuysId}>` : "Not set";
  const buyToken = s.buyTokenAddress ? `\`${s.buyTokenAddress}\`` : "Not set";
  const buyPair = s.buyPairAddress ? `\`${s.buyPairAddress}\`` : "Not set";
  const buyMin = s.minBuyCro > 0 ? `${s.minBuyCro}` : "None";
  const buyEmoji = s.buyEmoji ?? "🟢";
  const buyRates = s.buyRates ?? [10, 50, 200, 500];
  const buyRatesDisplay = `${buyRates[0]} / ${buyRates[1]} / ${buyRates[2]} / ${buyRates[3]}`;
  const buyImage = s.buyImageUrl ? s.buyImageUrl : "Not set";

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("⚙️ MANE NFT Bot — Current Settings")
    .addFields(
      { name: "📋 Listings Channel", value: listingsCh, inline: false },
      { name: "🪙 Mints Channel", value: mintsCh, inline: false },
      { name: "🔎 Mint Contract", value: mintContract, inline: false },
      { name: "⏱️ Relist Cooldown", value: cooldownDisplay, inline: false },
      { name: "🎨 Tracked Collections", value: collections, inline: false },
      { name: "\u200b", value: "**— Buy Alert Settings —**", inline: false },
      { name: "💰 Buy Alert Channel", value: buysCh, inline: true },
      { name: "🪙 Buy Token", value: buyToken, inline: true },
      { name: "🔗 DEX Pair", value: buyPair, inline: true },
      { name: "📊 Bubble Emoji", value: buyEmoji, inline: true },
      { name: "📈 Bubble Rates", value: buyRatesDisplay, inline: true },
      { name: "⬇️ Min Spend", value: buyMin, inline: true },
      { name: "🖼️ Buy Image", value: buyImage, inline: false }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleRefresh(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  const s = getGuildSettings(guildId);

  let listingsChannel: TextChannel | null = null;
  let mintsChannel: TextChannel | null = null;
  let buysChannel: TextChannel | null = null;

  if (s.channelListingsId) {
    try {
      const ch = await interaction.client.channels.fetch(s.channelListingsId);
      if (ch && ch.isTextBased()) listingsChannel = ch as TextChannel;
    } catch {}
  }

  if (s.channelMintsId) {
    try {
      const ch = await interaction.client.channels.fetch(s.channelMintsId);
      if (ch && ch.isTextBased()) mintsChannel = ch as TextChannel;
    } catch {}
  }

  if (s.channelBuysId) {
    try {
      const ch = await interaction.client.channels.fetch(s.channelBuysId);
      if (ch && ch.isTextBased()) buysChannel = ch as TextChannel;
    } catch {}
  }

  guildState.listingsChannel = listingsChannel;
  guildState.mintsChannel = mintsChannel;
  guildState.buysChannel = buysChannel;
  guildState.mintContractAddress = s.mintContractAddress?.toLowerCase() ?? null;
  guildState.trackedCollections = new Set(s.trackedCollections.map((a) => a.toLowerCase()));
  guildState.relistCooldownMs = (s.cooldownHours ?? 6) * 60 * 60 * 1000;
  guildState.seenListingIds = loadSeenIds(guildId);
  guildState.buyTokenAddress = s.buyTokenAddress ?? null;
  guildState.buyPairAddress = s.buyPairAddress ?? null;
  guildState.minBuyCro = s.minBuyCro ?? 0;
  guildState.buyImageUrl = s.buyImageUrl ?? null;
  guildState.buyEmoji = s.buyEmoji ?? "🟢";
  guildState.buyRates = s.buyRates ?? [10, 50, 200, 500];

  const lines: string[] = [];
  lines.push(listingsChannel ? `✅ Listings → <#${listingsChannel.id}>` : "⚠️ Listings channel: not set");
  lines.push(mintsChannel ? `✅ Mints → <#${mintsChannel.id}>` : "⚠️ Mints channel: not set");
  lines.push(
    s.mintContractAddress
      ? `✅ Mint contract: \`${s.mintContractAddress}\``
      : "⚠️ Mint contract: not set"
  );
  lines.push(buysChannel ? `✅ Buy alerts → <#${buysChannel.id}>` : "⚠️ Buy alerts channel: not set");
  lines.push(
    s.buyTokenAddress
      ? `✅ Buy token: \`${s.buyTokenAddress}\``
      : "⚠️ Buy token: not set"
  );

  await interaction.editReply(`🔄 **Bot state refreshed.**\n\n${lines.join("\n")}`);
  console.log(`[commands] [${guildId}] State refreshed`);
}

async function handleSetCooldown(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  const hours = interaction.options.getInteger("hours", true);
  setCooldown(guildId, hours);
  guildState.relistCooldownMs = hours * 60 * 60 * 1000;

  const display =
    hours === 0 ? "disabled (all relists will be announced)" : `${hours} hour${hours === 1 ? "" : "s"}`;
  await interaction.editReply(`✅ Relist cooldown set to **${display}**. Takes effect on the next poll.`);
  console.log(`[commands] [${guildId}] Cooldown updated to ${hours}h`);
}

async function handleSetListingsChannel(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  const channel = interaction.options.getChannel("channel", true);
  setListingsChannel(guildId, channel.id);

  try {
    const fetched = await interaction.client.channels.fetch(channel.id);
    if (fetched && fetched.isTextBased()) {
      guildState.listingsChannel = fetched as import("discord.js").TextChannel;
    }
  } catch {}

  await interaction.editReply(
    `✅ Listings channel set to <#${channel.id}>. New NFT listings will be announced there.`
  );
  console.log(`[commands] [${guildId}] Listings channel set to ${channel.id}`);
}

async function handleSetMintsChannel(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  const channel = interaction.options.getChannel("channel", true);
  setMintsChannel(guildId, channel.id);

  try {
    const fetched = await interaction.client.channels.fetch(channel.id);
    if (fetched && fetched.isTextBased()) {
      guildState.mintsChannel = fetched as import("discord.js").TextChannel;
    }
  } catch {}

  await interaction.editReply(
    `✅ Mints channel set to <#${channel.id}>. Live NFT mints will be announced there.\n\n💡 Use \`/settings mint set <address>\` to set which contract to watch.`
  );
  console.log(`[commands] [${guildId}] Mints channel set to ${channel.id}`);
}

async function handleSetMintContract(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  const address = interaction.options.getString("address", true).trim();

  if (!ethers.isAddress(address)) {
    await interaction.editReply(
      `❌ \`${address}\` is not a valid Cronos contract address. Make sure it starts with \`0x\` and is 42 characters long.`
    );
    return;
  }

  const checksummed = ethers.getAddress(address);
  setMintContract(guildId, checksummed);
  guildState.mintContractAddress = checksummed.toLowerCase();

  await interaction.editReply(
    `✅ Mint tracker set to \`${checksummed}\`.${
      guildState.mintsChannel
        ? ""
        : "\n\n💡 Don't forget to set a mints channel with `/settings channel mints`."
    }`
  );
  console.log(`[commands] [${guildId}] Mint contract set to ${checksummed}`);
}

async function handleClearMintContract(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  clearMintContract(guildId);
  guildState.mintContractAddress = null;

  await interaction.editReply("✅ Mint tracker cleared. The bot will no longer watch for new mints.");
  console.log(`[commands] [${guildId}] Mint contract cleared`);
}

async function handleAddCollection(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  const address = interaction.options.getString("address", true).trim();

  if (!ethers.isAddress(address)) {
    await interaction.editReply(
      `❌ \`${address}\` is not a valid Cronos contract address.`
    );
    return;
  }

  const checksummed = ethers.getAddress(address);
  const { added } = addTrackedCollection(guildId, checksummed);

  if (!added) {
    await interaction.editReply(`⚠️ \`${checksummed}\` is already being tracked.`);
    return;
  }

  guildState.trackedCollections.add(checksummed.toLowerCase());

  const settings = getGuildSettings(guildId);
  const listStr = settings.trackedCollections.map((a) => `• \`${a}\``).join("\n");

  await interaction.editReply(
    `✅ Now tracking \`${checksummed}\`.\n\n**All tracked collections:**\n${listStr}`
  );
  console.log(`[commands] [${guildId}] Added collection: ${checksummed}`);
}

async function handleRemoveCollection(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  const address = interaction.options.getString("address", true).trim();

  if (!ethers.isAddress(address)) {
    await interaction.editReply(`❌ \`${address}\` is not a valid contract address.`);
    return;
  }

  const checksummed = ethers.getAddress(address);
  const { removed } = removeTrackedCollection(guildId, checksummed);

  if (!removed) {
    await interaction.editReply(`⚠️ \`${checksummed}\` was not in the tracked list.`);
    return;
  }

  guildState.trackedCollections.delete(checksummed.toLowerCase());

  const settings = getGuildSettings(guildId);
  const listStr =
    settings.trackedCollections.length > 0
      ? settings.trackedCollections.map((a) => `• \`${a}\``).join("\n")
      : "None — all collections will be announced.";

  await interaction.editReply(
    `✅ Removed \`${checksummed}\`.\n\n**Remaining tracked collections:**\n${listStr}`
  );
  console.log(`[commands] [${guildId}] Removed collection: ${checksummed}`);
}

async function handleListCollections(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const settings = getGuildSettings(guildId);

  const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle("🎨 Tracked NFT Collections");

  if (settings.trackedCollections.length === 0) {
    embed.setDescription(
      "No specific collections configured — the bot will announce activity from **all collections** on the marketplace."
    );
  } else {
    embed.setDescription(
      settings.trackedCollections.map((addr, i) => `${i + 1}. \`${addr}\``).join("\n")
    );
    embed.setFooter({ text: `${settings.trackedCollections.length} collection(s) tracked` });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleSetOnlyCollection(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  const address = interaction.options.getString("address", true).trim();

  if (!ethers.isAddress(address)) {
    await interaction.editReply(
      `❌ \`${address}\` is not a valid Cronos contract address.`
    );
    return;
  }

  const checksummed = ethers.getAddress(address);
  setOnlyCollection(guildId, checksummed);

  guildState.trackedCollections.clear();
  guildState.trackedCollections.add(checksummed.toLowerCase());

  await interaction.editReply(
    `✅ Bot is now locked to **one collection only**:\n\`${checksummed}\`\n\nAll listings from other collections will be ignored.`
  );
  console.log(`[commands] [${guildId}] Collection locked to: ${checksummed}`);
}

async function handleClearCollections(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  clearTrackedCollections(guildId);
  guildState.trackedCollections.clear();

  await interaction.editReply(
    `✅ Collection filter cleared. The bot will now announce listings from **all collections** on the marketplace.`
  );
  console.log(`[commands] [${guildId}] Collection filter cleared`);
}

async function handleSetBuysChannel(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  const channel = interaction.options.getChannel("channel", true);
  setBuysChannel(guildId, channel.id);

  try {
    const fetched = await interaction.client.channels.fetch(channel.id);
    if (fetched && fetched.isTextBased()) {
      guildState.buysChannel = fetched as TextChannel;
    }
  } catch {}

  await interaction.editReply(
    `✅ Buy alerts channel set to <#${channel.id}>. Token buy alerts will be posted there.\n\n💡 Use \`/settings buys token\` to set which token and pair to watch.`
  );
  console.log(`[commands] [${guildId}] Buy alerts channel set to ${channel.id}`);
}

async function handleSetBuyToken(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  const tokenRaw = interaction.options.getString("token", true).trim();
  const pairRaw = interaction.options.getString("pair", true).trim();

  if (!ethers.isAddress(tokenRaw)) {
    await interaction.editReply(`❌ \`${tokenRaw}\` is not a valid token contract address.`);
    return;
  }
  if (!ethers.isAddress(pairRaw)) {
    await interaction.editReply(`❌ \`${pairRaw}\` is not a valid pair contract address.`);
    return;
  }

  const tokenAddr = ethers.getAddress(tokenRaw);
  const pairAddr = ethers.getAddress(pairRaw);

  setBuyToken(guildId, tokenAddr, pairAddr);
  guildState.buyTokenAddress = tokenAddr;
  guildState.buyPairAddress = pairAddr;

  await interaction.editReply(
    `✅ Buy tracker configured.\n**Token:** \`${tokenAddr}\`\n**Pair:** \`${pairAddr}\`${
      guildState.buysChannel ? "" : "\n\n💡 Don't forget to set a buy alerts channel with `/settings buys channel`."
    }`
  );
  console.log(`[commands] [${guildId}] Buy token set: ${tokenAddr} / pair: ${pairAddr}`);
}

async function handleSetMinBuy(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  const amount = interaction.options.getNumber("amount", true);
  setMinBuyCro(guildId, amount);
  guildState.minBuyCro = amount;

  const display = amount === 0 ? "disabled (all buys will be announced)" : `${amount}`;
  await interaction.editReply(`✅ Minimum buy amount set to **${display}**. Takes effect on the next poll.`);
  console.log(`[commands] [${guildId}] Min buy amount updated to ${amount}`);
}

async function handleSetBuyImage(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  const url = interaction.options.getString("url", true).trim();

  if (url.toLowerCase() === "clear" || url.toLowerCase() === "remove" || url.toLowerCase() === "none") {
    setBuyImage(guildId, null);
    guildState.buyImageUrl = null;
    await interaction.editReply("✅ Buy alert image removed.");
    console.log(`[commands] [${guildId}] Buy image cleared`);
    return;
  }

  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    await interaction.editReply("❌ URL must start with `https://` or `http://`. Pass `clear` to remove the current image.");
    return;
  }

  setBuyImage(guildId, url);
  guildState.buyImageUrl = url;

  await interaction.editReply(`✅ Buy alert image set.\n\nIt will appear at the bottom of every buy alert embed.\n💡 Pass \`clear\` to this command to remove it later.`);
  console.log(`[commands] [${guildId}] Buy image set to ${url}`);
}

async function handleSetBuyEmoji(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  const emoji = interaction.options.getString("emoji", true).trim();

  setBuyEmoji(guildId, emoji);
  guildState.buyEmoji = emoji;

  const rates = guildState.buyRates ?? [10, 50, 200, 500];
  await interaction.editReply(
    `✅ Buy bubble emoji set to **${emoji}**.\n\nExample sizes: ${emoji} / ${emoji.repeat(2)} / ${emoji.repeat(3)} / ${emoji.repeat(4)} / ${emoji.repeat(5)}\n(Based on your rates: ${rates[0]} / ${rates[1]} / ${rates[2]} / ${rates[3]})`
  );
  console.log(`[commands] [${guildId}] Buy emoji set to ${emoji}`);
}

async function handleSetBuyRates(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  const t1 = interaction.options.getNumber("t1", true);
  const t2 = interaction.options.getNumber("t2", true);
  const t3 = interaction.options.getNumber("t3", true);
  const t4 = interaction.options.getNumber("t4", true);

  if (!(t1 < t2 && t2 < t3 && t3 < t4)) {
    await interaction.editReply("❌ Thresholds must be in ascending order: t1 < t2 < t3 < t4.");
    return;
  }

  const rates: [number, number, number, number] = [t1, t2, t3, t4];
  setBuyRates(guildId, rates);
  guildState.buyRates = rates;

  const emoji = guildState.buyEmoji ?? "🟢";
  await interaction.editReply(
    `✅ Buy bubble rates updated.\n\n` +
    `${emoji} — spend < **${t1}**\n` +
    `${emoji.repeat(2)} — spend ≥ **${t1}**\n` +
    `${emoji.repeat(3)} — spend ≥ **${t2}**\n` +
    `${emoji.repeat(4)} — spend ≥ **${t3}**\n` +
    `${emoji.repeat(5)} — spend ≥ **${t4}**`
  );
  console.log(`[commands] [${guildId}] Buy rates set to ${rates.join(", ")}`);
}

async function handleClearBuys(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildState: GuildState
): Promise<void> {
  clearBuyConfig(guildId);
  guildState.buysChannel = null;
  guildState.buyTokenAddress = null;
  guildState.buyPairAddress = null;
  guildState.minBuyCro = 0;
  guildState.buyImageUrl = null;
  guildState.buyEmoji = "🟢";
  guildState.buyRates = [10, 50, 200, 500];

  await interaction.editReply("✅ Buy alert settings cleared. The bot will no longer watch for token buys.");
  console.log(`[commands] [${guildId}] Buy config cleared`);
}
