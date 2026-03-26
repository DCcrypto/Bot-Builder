import { createServer } from "http";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);

export function startHealthServer(): void {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[bot] Health server listening on port ${PORT}`);
  });

  server.on("error", (err) => {
    console.error("[bot] Health server error:", err);
  });
}
