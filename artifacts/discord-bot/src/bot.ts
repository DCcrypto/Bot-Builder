import { Client, GatewayIntentBits, type TextChannel } from "discord.js";
import { config } from "./config.js";
import { startListener, type ListenerState } from "./listener.js";
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
    salesChannel: null,
    trackedCollections: new Set(),
    connected: false,
  };

  client.once("clientReady", async (c) => {
    console.log(`[bot] Logged in as ${c.user.tag}`);

    const settings = getSettings();

    if (settings.channelListingsId) {
      state.listingsChannel = await fetchTextChannel(client, settings.channelListingsId);
      if (state.listingsChannel) {
        console.log(`[bot] Listings channel: #${state.listingsChannel.name}`);
      }
    } else {
      console.warn("[bot] No listings channel set. Use /settings channel listings to configure.");
    }

    if (settings.channelSalesId) {
      if (settings.channelSalesId === settings.channelListingsId) {
        state.salesChannel = state.listingsChannel;
        console.log("[bot] Sales channel: same as listings");
      } else {
        state.salesChannel = await fetchTextChannel(client, settings.channelSalesId);
        if (state.salesChannel) {
          console.log(`[bot] Sales channel: #${state.salesChannel.name}`);
        }
      }
    } else {
      console.warn("[bot] No sales channel set. Use /settings channel sales to configure.");
    }

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
