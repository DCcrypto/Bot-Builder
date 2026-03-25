import { Client, GatewayIntentBits, type TextChannel } from "discord.js";
import { config } from "./config.js";
import { startListener, type ListenerState } from "./listener.js";
import { startMintListener } from "./mintListener.js";
import { registerCommands, handleInteraction } from "./commands.js";
import { getSettings } from "./settings.js";

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

export async function startBot(): Promise<void> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  const state: ListenerState = {
    listingsChannel: null,
    mintsChannel: null,
    mintContractAddress: null,
    trackedCollections: new Set(),
    relistCooldownMs: 6 * 60 * 60 * 1000,
  };

  client.once("clientReady", async (c) => {
    console.log(`[bot] Logged in as ${c.user.tag} (Client ID: ${c.user.id})`);
    console.log(`[bot] Invite URL: https://discord.com/api/oauth2/authorize?client_id=${c.user.id}&permissions=2048&scope=bot%20applications.commands`);

    const settings = getSettings();

    if (settings.channelListingsId) {
      state.listingsChannel = await fetchTextChannel(client, settings.channelListingsId);
      if (state.listingsChannel) {
        console.log(`[bot] Listings channel: #${state.listingsChannel.name}`);
      }
    } else {
      console.warn("[bot] No listings channel set. Use /settings channel listings to configure.");
    }

    if (settings.channelMintsId) {
      state.mintsChannel = await fetchTextChannel(client, settings.channelMintsId);
      if (state.mintsChannel) {
        console.log(`[bot] Mints channel: #${state.mintsChannel.name}`);
      }
    } else {
      console.warn("[bot] No mints channel set. Use /settings channel mints to configure.");
    }

    if (settings.mintContractAddress) {
      state.mintContractAddress = settings.mintContractAddress.toLowerCase();
      console.log(`[bot] Mint tracker contract: ${settings.mintContractAddress}`);
    } else {
      console.warn("[bot] No mint contract set. Use /settings mint set to configure.");
    }

    state.relistCooldownMs = (settings.cooldownHours ?? 6) * 60 * 60 * 1000;

    for (const addr of settings.trackedCollections) {
      state.trackedCollections.add(addr.toLowerCase());
    }

    if (settings.trackedCollections.length > 0) {
      console.log(`[bot] Tracking ${settings.trackedCollections.length} collection(s)`);
    } else {
      console.log("[bot] Tracking all collections (no filter). Use /settings collection add to filter.");
    }

    await registerCommands(client);
    startListener(state);
    startMintListener(state);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    await handleInteraction(interaction, state);
  });

  client.on("error", (err) => {
    console.error("[bot] Discord client error:", err);
  });

  await client.login(config.discord.token);
}
