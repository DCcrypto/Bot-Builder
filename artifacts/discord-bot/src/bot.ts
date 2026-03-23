import { Client, GatewayIntentBits, type TextChannel } from "discord.js";
import { config } from "./config.js";
import { startListener } from "./listener.js";

export async function startBot(): Promise<void> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once("ready", async (c) => {
    console.log(`[bot] Logged in as ${c.user.tag}`);

    let listingsChannel: TextChannel | null = null;
    let salesChannel: TextChannel | null = null;

    if (config.discord.channelListingsId) {
      try {
        const ch = await client.channels.fetch(config.discord.channelListingsId);
        if (ch && ch.isTextBased()) {
          listingsChannel = ch as TextChannel;
          console.log(`[bot] Listings channel: #${listingsChannel.name}`);
        } else {
          console.warn(
            `[bot] Channel ${config.discord.channelListingsId} is not a text channel`
          );
        }
      } catch (err) {
        console.error(
          `[bot] Could not find listings channel ${config.discord.channelListingsId}:`,
          err
        );
      }
    } else {
      console.warn("[bot] DISCORD_CHANNEL_LISTINGS_ID not set — listing announcements disabled");
    }

    if (config.discord.channelSalesId) {
      if (config.discord.channelSalesId === config.discord.channelListingsId) {
        salesChannel = listingsChannel;
        console.log("[bot] Sales and listings sharing the same channel");
      } else {
        try {
          const ch = await client.channels.fetch(config.discord.channelSalesId);
          if (ch && ch.isTextBased()) {
            salesChannel = ch as TextChannel;
            console.log(`[bot] Sales channel: #${salesChannel.name}`);
          } else {
            console.warn(
              `[bot] Channel ${config.discord.channelSalesId} is not a text channel`
            );
          }
        } catch (err) {
          console.error(
            `[bot] Could not find sales channel ${config.discord.channelSalesId}:`,
            err
          );
        }
      }
    } else {
      console.warn("[bot] DISCORD_CHANNEL_SALES_ID not set — sale announcements disabled");
    }

    if (!listingsChannel && !salesChannel) {
      console.warn(
        "[bot] No Discord channels configured. Set DISCORD_CHANNEL_LISTINGS_ID and/or DISCORD_CHANNEL_SALES_ID."
      );
    }

    startListener(listingsChannel, salesChannel);
  });

  client.on("error", (err) => {
    console.error("[bot] Discord client error:", err);
  });

  await client.login(config.discord.token);
}
