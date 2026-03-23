import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const SEEN_FILE = join(DATA_DIR, "seen-listings.json");

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface SeenEntry {
  id: string;
  seenAt: string;
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function loadSeenIds(): Set<string> {
  ensureDataDir();
  if (!existsSync(SEEN_FILE)) return new Set();
  try {
    const raw = readFileSync(SEEN_FILE, "utf-8");
    const entries = JSON.parse(raw) as SeenEntry[];
    const cutoff = Date.now() - MAX_AGE_MS;
    return new Set(
      entries.filter((e) => new Date(e.seenAt).getTime() > cutoff).map((e) => e.id)
    );
  } catch {
    return new Set();
  }
}

export function markSeen(ids: string[]): void {
  ensureDataDir();
  let existing: SeenEntry[] = [];
  if (existsSync(SEEN_FILE)) {
    try {
      existing = JSON.parse(readFileSync(SEEN_FILE, "utf-8")) as SeenEntry[];
    } catch {
      existing = [];
    }
  }

  const now = new Date().toISOString();
  const existingIds = new Set(existing.map((e) => e.id));
  for (const id of ids) {
    if (!existingIds.has(id)) {
      existing.push({ id, seenAt: now });
    }
  }

  const cutoff = Date.now() - MAX_AGE_MS;
  existing = existing.filter((e) => new Date(e.seenAt).getTime() > cutoff);

  writeFileSync(SEEN_FILE, JSON.stringify(existing, null, 2));
}
