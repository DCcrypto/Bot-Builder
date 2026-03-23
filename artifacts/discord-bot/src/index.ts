import { startBot } from "./bot.js";

console.log("[main] Starting MANE NFT Discord Bot...");

startBot().catch((err) => {
  console.error("[main] Fatal startup error:", err);
  process.exit(1);
});
