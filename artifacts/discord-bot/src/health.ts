import { createServer } from "http";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);

export async function startHealthServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    });

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`[bot] Health server listening on port ${PORT}`);
      resolve();
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.log(`[bot] Port ${PORT} already in use — another instance is running. Exiting.`);
        process.exit(0);
      }
      console.error("[bot] Health server error:", err);
      reject(err);
    });
  });
}
