import { startBot } from "./bot.js";

console.log("[main] Starting MANE NFT Discord Bot...");

process.on("unhandledRejection", (reason, promise) => {
  console.error("[main] Unhandled promise rejection:", reason, promise);
});

process.on("uncaughtException", (err) => {
  console.error("[main] Uncaught exception:", err);
});

startBot().catch((err) => {
  console.error("[main] Fatal startup error:", err);
  process.exit(1);
});
