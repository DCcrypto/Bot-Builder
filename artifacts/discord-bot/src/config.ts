function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  discord: {
    token: requireEnv("DISCORD_BOT_TOKEN"),
    channelListingsId: optionalEnv("DISCORD_CHANNEL_LISTINGS_ID", ""),
    channelSalesId: optionalEnv("DISCORD_CHANNEL_SALES_ID", ""),
  },
  cronos: {
    rpcUrl: optionalEnv("CRONOS_RPC_URL", "https://evm.cronos.org"),
    marketplaceAddress: requireEnv("MARKETPLACE_CONTRACT_ADDRESS"),
    pollIntervalMs: parseInt(optionalEnv("POLL_INTERVAL_MS", "30000"), 10),
    startBlock: optionalEnv("START_BLOCK", "latest"),
  },
  site: {
    baseUrl: optionalEnv("SITE_BASE_URL", "https://manenft.com"),
  },
};
