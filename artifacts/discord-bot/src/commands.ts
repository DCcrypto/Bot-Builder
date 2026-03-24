import {
  SlashCommandBuilder,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type Client,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
} from "discord.js";
import { ethers } from "ethers";
import {
  getSettings,
  setListingsChannel,
  setCooldown,
  addTrackedCollection,
  removeTrackedCollection,
} from "./settings.js";
import type { ListenerState } from "./listener.js";

export const settingsCommand = new SlashCommandBuilder()
  .setName("settings")
  .setDescription("Configure the MANE NFT Discord bot")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Show current bot settings")
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

export async function handleInteraction(
  interaction: ChatInputCommandInteraction,
  state: ListenerState
): Promise<void> {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "settings") return;

  const subgroup = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (!subgroup && sub === "status") {
      await handleStatus(interaction, state);
    } else if (!subgroup && sub === "cooldown") {
      await handleSetCooldown(interaction, state);
    } else if (subgroup === "channel" && sub === "listings") {
      await handleSetListingsChannel(interaction, state);
    } else if (subgroup === "collection" && sub === "add") {
      await handleAddCollection(interaction, state);
    } else if (subgroup === "collection" && sub === "remove") {
      await handleRemoveCollection(interaction, state);
    } else if (subgroup === "collection" && sub === "list") {
      await handleListCollections(interaction);
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
  state: ListenerState
): Promise<void> {
  const s = getSettings();

  const listingsCh = s.channelListingsId ? `<#${s.channelListingsId}>` : "Not set";
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
      { name: "⏱️ Relist Cooldown", value: cooldownDisplay, inline: false },
      { name: "🎨 Tracked Collections", value: collections, inline: false }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleSetCooldown(
  interaction: ChatInputCommandInteraction,
  state: ListenerState
): Promise<void> {
  const hours = interaction.options.getInteger("hours", true);
  setCooldown(hours);
  state.relistCooldownMs = hours * 60 * 60 * 1000;

  const display = hours === 0 ? "disabled (all relists will be announced)" : `${hours} hour${hours === 1 ? "" : "s"}`;
  await interaction.editReply(`✅ Relist cooldown set to **${display}**. Takes effect on the next poll.`);
  console.log(`[commands] Relist cooldown updated to ${hours}h`);
}

async function handleSetListingsChannel(
  interaction: ChatInputCommandInteraction,
  state: ListenerState
): Promise<void> {
  const channel = interaction.options.getChannel("channel", true);
  const settings = setListingsChannel(channel.id);

  try {
    const fetched = await interaction.client.channels.fetch(channel.id);
    if (fetched && fetched.isTextBased()) {
      state.listingsChannel = fetched as import("discord.js").TextChannel;
    }
  } catch {
    // channel fetch failed, state not updated
  }

  await interaction.editReply(
    `✅ Listings channel set to <#${channel.id}>. New NFT listings will be announced there.`
  );
  console.log(`[commands] Listings channel updated to ${channel.id}`);
}

async function handleAddCollection(
  interaction: ChatInputCommandInteraction,
  state: ListenerState
): Promise<void> {
  const address = interaction.options.getString("address", true).trim();

  if (!ethers.isAddress(address)) {
    await interaction.editReply(
      `❌ \`${address}\` is not a valid Cronos contract address. Make sure it starts with \`0x\` and is 42 characters long.`
    );
    return;
  }

  const checksummed = ethers.getAddress(address);
  const { added } = addTrackedCollection(checksummed);

  if (!added) {
    await interaction.editReply(`⚠️ \`${checksummed}\` is already being tracked.`);
    return;
  }

  state.trackedCollections.add(checksummed.toLowerCase());

  const settings = getSettings();
  const listStr = settings.trackedCollections.map((a) => `• \`${a}\``).join("\n");

  await interaction.editReply(
    `✅ Now tracking collection \`${checksummed}\`.\n\n**All tracked collections:**\n${listStr}`
  );
  console.log(`[commands] Added tracked collection: ${checksummed}`);
}

async function handleRemoveCollection(
  interaction: ChatInputCommandInteraction,
  state: ListenerState
): Promise<void> {
  const address = interaction.options.getString("address", true).trim();

  if (!ethers.isAddress(address)) {
    await interaction.editReply(`❌ \`${address}\` is not a valid contract address.`);
    return;
  }

  const checksummed = ethers.getAddress(address);
  const { removed } = removeTrackedCollection(checksummed);

  if (!removed) {
    await interaction.editReply(`⚠️ \`${checksummed}\` was not in the tracked list.`);
    return;
  }

  state.trackedCollections.delete(checksummed.toLowerCase());

  const settings = getSettings();
  const listStr =
    settings.trackedCollections.length > 0
      ? settings.trackedCollections.map((a) => `• \`${a}\``).join("\n")
      : "None — all collections will be announced.";

  await interaction.editReply(
    `✅ Removed \`${checksummed}\` from tracked collections.\n\n**Remaining tracked collections:**\n${listStr}`
  );
  console.log(`[commands] Removed tracked collection: ${checksummed}`);
}

async function handleListCollections(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const settings = getSettings();

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("🎨 Tracked NFT Collections");

  if (settings.trackedCollections.length === 0) {
    embed.setDescription(
      "No specific collections configured — the bot will announce activity from **all collections** on the marketplace."
    );
  } else {
    embed.setDescription(
      settings.trackedCollections
        .map((addr, i) => `${i + 1}. \`${addr}\``)
        .join("\n")
    );
    embed.setFooter({
      text: `${settings.trackedCollections.length} collection(s) tracked`,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
