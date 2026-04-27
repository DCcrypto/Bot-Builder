import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { getGuildSettings } from "./settings.js";
import { fetchTokenPrice, fetchPriceByPair } from "./priceChecker.js";
import { buildPriceEmbed } from "./embeds.js";
import type { GuildState } from "./listener.js";

export const priceCommand = new SlashCommandBuilder()
  .setName("price")
  .setDescription("Check the current price, chart, and market stats for a token via DexScreener")
  .addStringOption((opt) =>
    opt
      .setName("token")
      .setDescription(
        "Token or pair contract address (0x...) — leave blank to use the configured buy token"
      )
      .setRequired(false)
  )
  .addBooleanOption((opt) =>
    opt
      .setName("public")
      .setDescription("Post the price card visibly to the whole channel (default: only you see it)")
      .setRequired(false)
  );

export async function handlePriceInteraction(
  interaction: ChatInputCommandInteraction,
  _guildStates: Map<string, GuildState>
): Promise<void> {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "price") return;

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: "⚠️ This command can only be used inside a Discord server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const tokenArg = interaction.options.getString("token", false)?.trim() ?? null;
  const isPublic = interaction.options.getBoolean("public", false) ?? false;

  try {
    await interaction.deferReply({ flags: isPublic ? undefined : MessageFlags.Ephemeral });
  } catch (err) {
    console.error("[price] deferReply failed:", err);
    return;
  }

  console.log(`[price] [${guildId}] /price token=${tokenArg ?? "(default)"} public=${isPublic}`);

  let priceData = null;

  if (tokenArg) {
    priceData = await fetchTokenPrice(tokenArg, guildId);
  } else {
    const settings = getGuildSettings(guildId);
    if (settings.buyPairAddress) {
      priceData = await fetchPriceByPair(settings.buyPairAddress);
      if (!priceData && settings.buyTokenAddress) {
        priceData = await fetchTokenPrice(settings.buyTokenAddress);
      }
    } else if (settings.buyTokenAddress) {
      priceData = await fetchTokenPrice(settings.buyTokenAddress);
    }
  }

  if (!priceData) {
    let hint: string;
    if (tokenArg) {
      const isAddress = tokenArg.toLowerCase().startsWith("0x");
      if (isAddress) {
        hint = `No price data found for \`${tokenArg}\` on Cronos. Make sure it's a valid token or pair contract address on Cronos listed on DexScreener.`;
      } else {
        hint = `Could not resolve \`${tokenArg}\` to a token. If this is a symbol (e.g. MANE), make sure it matches your server's configured buy token symbol, or pass the full \`0x...\` contract address instead.`;
      }
    } else {
      hint = `No buy token is configured for this server. Run \`/settings buys token\` to set one, or pass a token address directly: \`/price token:0x...\`.`;
    }
    await interaction.editReply(`❌ ${hint}`);
    return;
  }

  try {
    const embed = buildPriceEmbed(priceData);
    await interaction.editReply({ embeds: [embed.embed], components: embed.components });
    console.log(`[price] [${guildId}] Posted price for ${priceData.symbol}`);
  } catch (err) {
    console.error("[price] Error building/sending embed:", err);
    await interaction.editReply("❌ Failed to build the price embed. Please try again.").catch(() => {});
  }
}
