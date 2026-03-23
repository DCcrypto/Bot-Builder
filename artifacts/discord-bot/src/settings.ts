import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const SETTINGS_FILE = join(DATA_DIR, "settings.json");

export interface BotSettings {
  channelListingsId: string | null;
  channelSalesId: string | null;
  trackedCollections: string[];
}

const DEFAULT_SETTINGS: BotSettings = {
  channelListingsId: process.env["DISCORD_CHANNEL_LISTINGS_ID"] ?? null,
  channelSalesId: process.env["DISCORD_CHANNEL_SALES_ID"] ?? null,
  trackedCollections: [],
};

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadSettings(): BotSettings {
  ensureDataDir();
  if (!existsSync(SETTINGS_FILE)) {
    writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = readFileSync(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<BotSettings>;
    return {
      channelListingsId: parsed.channelListingsId ?? DEFAULT_SETTINGS.channelListingsId,
      channelSalesId: parsed.channelSalesId ?? DEFAULT_SETTINGS.channelSalesId,
      trackedCollections: parsed.trackedCollections ?? [],
    };
  } catch {
    console.warn("[settings] Failed to parse settings file, using defaults");
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: BotSettings): void {
  ensureDataDir();
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

export function getSettings(): BotSettings {
  return loadSettings();
}

export function setListingsChannel(id: string | null): BotSettings {
  const s = loadSettings();
  s.channelListingsId = id;
  saveSettings(s);
  return s;
}

export function setSalesChannel(id: string | null): BotSettings {
  const s = loadSettings();
  s.channelSalesId = id;
  saveSettings(s);
  return s;
}

export function addTrackedCollection(address: string): { added: boolean; settings: BotSettings } {
  const s = loadSettings();
  const norm = address.toLowerCase();
  if (s.trackedCollections.map((a) => a.toLowerCase()).includes(norm)) {
    return { added: false, settings: s };
  }
  s.trackedCollections.push(address);
  saveSettings(s);
  return { added: true, settings: s };
}

export function removeTrackedCollection(address: string): { removed: boolean; settings: BotSettings } {
  const s = loadSettings();
  const norm = address.toLowerCase();
  const before = s.trackedCollections.length;
  s.trackedCollections = s.trackedCollections.filter((a) => a.toLowerCase() !== norm);
  const removed = s.trackedCollections.length < before;
  if (removed) saveSettings(s);
  return { removed, settings: s };
}
