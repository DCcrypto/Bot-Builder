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
} from "./settings.js";
import type { GuildState } from "./listener.js";
import { loadSeenIds } from "./seenListings.js";

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
  );

export async function registerCommands(client: Client): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) throw new Error("DISCORD_BOT_TOKEN not set");

  const appId = client.application?.id;
  if (!appId) throw new Error("Client application ID not available");

  const rest = new REST().setToken(token);
  const body = [settingsCommand.toJSON()];

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
    };
    guildStates.set(guildId, state);
  }
  return state;
}

export async function handleInteraction(
  interaction: ChatInputCommandInteraction,
  guildStates: Map<string, GuildState>
): Promise<void> {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "settings") return;

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

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("⚙️ MANE NFT Bot — Current Settings")
    .addFields(
      { name: "📋 Listings Channel", value: listingsCh, inline: false },
      { name: "🪙 Mints Channel", value: mintsCh, inline: false },
      { name: "🔎 Mint Contract", value: mintContract, inline: false },
      { name: "⏱️ Relist Cooldown", value: cooldownDisplay, inline: false },
      { name: "🎨 Tracked Collections", value: collections, inline: false }
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

  guildState.listingsChannel = listingsChannel;
  guildState.mintsChannel = mintsChannel;
  guildState.mintContractAddress = s.mintContractAddress?.toLowerCase() ?? null;
  guildState.trackedCollections = new Set(s.trackedCollections.map((a) => a.toLowerCase()));
  guildState.relistCooldownMs = (s.cooldownHours ?? 6) * 60 * 60 * 1000;
  guildState.seenListingIds = loadSeenIds(guildId);

  const lines: string[] = [];
  lines.push(listingsChannel ? `✅ Listings → <#${listingsChannel.id}>` : "⚠️ Listings channel: not set");
  lines.push(mintsChannel ? `✅ Mints → <#${mintsChannel.id}>` : "⚠️ Mints channel: not set");
  lines.push(
    s.mintContractAddress
      ? `✅ Mint contract: \`${s.mintContractAddress}\``
      : "⚠️ Mint contract: not set"
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
