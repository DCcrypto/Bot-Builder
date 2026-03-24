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
  },
  cronos: {
    pollIntervalMs: parseInt(optionalEnv("POLL_INTERVAL_MS", "15000"), 10),
  },
  site: {
    baseUrl: optionalEnv("SITE_BASE_URL", "https://manenft.com"),
  },
};
