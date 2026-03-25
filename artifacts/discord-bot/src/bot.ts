import { Client, GatewayIntentBits, type TextChannel } from "discord.js";
import { config } from "./config.js";
import { startListener, type GuildState } from "./listener.js";
import { startMintListener } from "./mintListener.js";
import { registerCommands, handleInteraction } from "./commands.js";
import { getGuildSettings, saveGuildSettings } from "./settings.js";
import { loadSeenIds } from "./seenListings.js";

async function fetchTextChannel(
  client: Client,
  id: string
): Promise<TextChannel | null> {
  try {
    const ch = await client.channels.fetch(id);
    if (ch && ch.isTextBased()) return ch as TextChannel;
    console.warn(`[bot] Channel ${id} is not a text channel`);
    return null;
  } catch (err) {
    console.error(`[bot] Could not fetch channel ${id}:`, err);
    return null;
  }
}

function buildGuildState(guildId: string): GuildState {
  const s = getGuildSettings(guildId);
  return {
    guildId,
    listingsChannel: null,
    mintsChannel: null,
    mintContractAddress: s.mintContractAddress ? s.mintContractAddress.toLowerCase() : null,
    trackedCollections: new Set(s.trackedCollections.map((a) => a.toLowerCase())),
    relistCooldownMs: (s.cooldownHours ?? 6) * 60 * 60 * 1000,
    seenListingIds: loadSeenIds(guildId),
    recentNfts: new Map(),
  };
}

async function initGuildState(
  client: Client,
  guildId: string,
  guildName: string
): Promise<GuildState> {
  const state = buildGuildState(guildId);
  const settings = getGuildSettings(guildId);

  if (settings.channelListingsId) {
    state.listingsChannel = await fetchTextChannel(client, settings.channelListingsId);
    if (state.listingsChannel) {
      console.log(`[bot] [${guildName}] Listings: #${state.listingsChannel.name}`);
    }
  }

  if (settings.channelMintsId) {
    state.mintsChannel = await fetchTextChannel(client, settings.channelMintsId);
    if (state.mintsChannel) {
      console.log(`[bot] [${guildName}] Mints: #${state.mintsChannel.name}`);
    }
  }

  if (settings.mintContractAddress) {
    console.log(`[bot] [${guildName}] Mint contract: ${settings.mintContractAddress}`);
  }

  return state;
}

export async function startBot(): Promise<void> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  const guildStates = new Map<string, GuildState>();

  client.once("clientReady", async (c) => {
    console.log(`[bot] Logged in as ${c.user.tag} (Client ID: ${c.user.id})`);
    console.log(
      `[bot] Invite URL: https://discord.com/api/oauth2/authorize?client_id=${c.user.id}&permissions=2048&scope=bot%20applications.commands`
    );
    console.log(`[bot] Active in ${c.guilds.cache.size} guild(s)`);

    for (const [guildId, guild] of c.guilds.cache) {
      const state = await initGuildState(client, guildId, guild.name);
      guildStates.set(guildId, state);
      console.log(`[bot] Initialized: ${guild.name} (${guildId})`);
    }

    await registerCommands(client);
    startListener(guildStates);
    startMintListener(guildStates);
  });

  client.on("guildCreate", async (guild) => {
    console.log(`[bot] Joined new guild: ${guild.name} (${guild.id})`);
    const settings = getGuildSettings(guild.id);
    saveGuildSettings(guild.id, settings);
    const state = await initGuildState(client, guild.id, guild.name);
    guildStates.set(guild.id, state);
  });

  client.on("guildDelete", (guild) => {
    const name = guild.name ?? guild.id;
    console.log(`[bot] Left guild: ${name} (${guild.id})`);
    guildStates.delete(guild.id);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      await handleInteraction(interaction, guildStates);
    } catch (err) {
      console.error("[bot] Unhandled error in interactionCreate:", err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "An unexpected error occurred.", flags: 64 });
        } else if (interaction.deferred) {
          await interaction.editReply("An unexpected error occurred.");
        }
      } catch {}
    }
  });

  client.on("error", (err) => {
    console.error("[bot] Discord client error:", err);
  });

  await client.login(config.discord.token);
}
