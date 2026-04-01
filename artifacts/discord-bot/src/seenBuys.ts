import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const SEEN_BUYS_FILE = join(DATA_DIR, "seen-buys.json");

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface SeenEntry {
  txHash: string;
  seenAt: string;
}

type SeenStore = Record<string, SeenEntry[]>;

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadStore(): SeenStore {
  ensureDataDir();
  if (!existsSync(SEEN_BUYS_FILE)) return {};
  try {
    const raw = JSON.parse(readFileSync(SEEN_BUYS_FILE, "utf-8")) as unknown;
    if (Array.isArray(raw)) return {};
    return raw as SeenStore;
  } catch {
    return {};
  }
}

function saveStore(store: SeenStore): void {
  ensureDataDir();
  writeFileSync(SEEN_BUYS_FILE, JSON.stringify(store, null, 2));
}

export function loadSeenBuyTxHashes(guildId: string): Set<string> {
  const store = loadStore();
  const entries = store[guildId] ?? [];
  const cutoff = Date.now() - MAX_AGE_MS;
  return new Set(
    entries.filter((e) => new Date(e.seenAt).getTime() > cutoff).map((e) => e.txHash)
  );
}

export function markBuyTxSeen(guildId: string, txHashes: string[]): void {
  const store = loadStore();
  const existing = store[guildId] ?? [];
  const now = new Date().toISOString();
  const existingSet = new Set(existing.map((e) => e.txHash));
  for (const txHash of txHashes) {
    if (!existingSet.has(txHash)) {
      existing.push({ txHash, seenAt: now });
    }
  }
  const cutoff = Date.now() - MAX_AGE_MS;
  store[guildId] = existing.filter((e) => new Date(e.seenAt).getTime() > cutoff);
  saveStore(store);
}
