import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const GUILD_SETTINGS_FILE = join(DATA_DIR, "guild-settings.json");

export interface GuildSettings {
  channelListingsId: string | null;
  channelMintsId: string | null;
  mintContractAddress: string | null;
  trackedCollections: string[];
  cooldownHours: number;
  channelBuysId: string | null;
  buyTokenAddress: string | null;
  buyPairAddress: string | null;
  minBuyCro: number;
  buyImageUrl: string | null;
  buyEmoji: string;
  buyRates: [number, number, number, number];
}

type GuildSettingsStore = Record<string, GuildSettings>;

const DEFAULT_GUILD_SETTINGS: GuildSettings = {
  channelListingsId: null,
  channelMintsId: null,
  mintContractAddress: null,
  trackedCollections: [],
  cooldownHours: 6,
  channelBuysId: null,
  buyTokenAddress: null,
  buyPairAddress: null,
  minBuyCro: 0,
  buyImageUrl: null,
  buyEmoji: "🟢",
  buyRates: [10, 50, 200, 500],
};

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadStore(): GuildSettingsStore {
  ensureDataDir();
  if (!existsSync(GUILD_SETTINGS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(GUILD_SETTINGS_FILE, "utf-8")) as GuildSettingsStore;
  } catch {
    console.warn("[settings] Failed to parse guild-settings.json, starting fresh");
    return {};
  }
}

function saveStore(store: GuildSettingsStore): void {
  ensureDataDir();
  writeFileSync(GUILD_SETTINGS_FILE, JSON.stringify(store, null, 2));
}

export function getGuildSettings(guildId: string): GuildSettings {
  const store = loadStore();
  const saved = store[guildId];
  if (!saved) return { ...DEFAULT_GUILD_SETTINGS };
  const rates = Array.isArray(saved.buyRates) && saved.buyRates.length === 4
    ? saved.buyRates as [number, number, number, number]
    : DEFAULT_GUILD_SETTINGS.buyRates;
  return {
    channelListingsId: saved.channelListingsId ?? null,
    channelMintsId: saved.channelMintsId ?? null,
    mintContractAddress: saved.mintContractAddress ?? null,
    trackedCollections: saved.trackedCollections ?? [],
    cooldownHours: typeof saved.cooldownHours === "number" ? saved.cooldownHours : DEFAULT_GUILD_SETTINGS.cooldownHours,
    channelBuysId: saved.channelBuysId ?? null,
    buyTokenAddress: saved.buyTokenAddress ?? null,
    buyPairAddress: saved.buyPairAddress ?? null,
    minBuyCro: typeof saved.minBuyCro === "number" ? saved.minBuyCro : 0,
    buyImageUrl: saved.buyImageUrl ?? null,
    buyEmoji: saved.buyEmoji ?? "🟢",
    buyRates: rates,
  };
}

export function saveGuildSettings(guildId: string, settings: GuildSettings): void {
  const store = loadStore();
  store[guildId] = settings;
  saveStore(store);
}

export function removeGuildSettings(guildId: string): void {
  const store = loadStore();
  delete store[guildId];
  saveStore(store);
}

export function getAllGuildIds(): string[] {
  return Object.keys(loadStore());
}

function updateGuild(guildId: string, updater: (s: GuildSettings) => void): GuildSettings {
  const s = getGuildSettings(guildId);
  updater(s);
  saveGuildSettings(guildId, s);
  return s;
}

export function setListingsChannel(guildId: string, id: string | null): GuildSettings {
  return updateGuild(guildId, (s) => { s.channelListingsId = id; });
}

export function setMintsChannel(guildId: string, id: string | null): GuildSettings {
  return updateGuild(guildId, (s) => { s.channelMintsId = id; });
}

export function setMintContract(guildId: string, address: string): GuildSettings {
  return updateGuild(guildId, (s) => { s.mintContractAddress = address; });
}

export function clearMintContract(guildId: string): GuildSettings {
  return updateGuild(guildId, (s) => { s.mintContractAddress = null; });
}

export function setCooldown(guildId: string, hours: number): GuildSettings {
  return updateGuild(guildId, (s) => { s.cooldownHours = hours; });
}

export function setOnlyCollection(guildId: string, address: string): GuildSettings {
  return updateGuild(guildId, (s) => { s.trackedCollections = [address]; });
}

export function clearTrackedCollections(guildId: string): GuildSettings {
  return updateGuild(guildId, (s) => { s.trackedCollections = []; });
}

export function addTrackedCollection(
  guildId: string,
  address: string
): { added: boolean; settings: GuildSettings } {
  const s = getGuildSettings(guildId);
  const norm = address.toLowerCase();
  if (s.trackedCollections.map((a) => a.toLowerCase()).includes(norm)) {
    return { added: false, settings: s };
  }
  s.trackedCollections.push(address);
  saveGuildSettings(guildId, s);
  return { added: true, settings: s };
}

export function removeTrackedCollection(
  guildId: string,
  address: string
): { removed: boolean; settings: GuildSettings } {
  const s = getGuildSettings(guildId);
  const norm = address.toLowerCase();
  const before = s.trackedCollections.length;
  s.trackedCollections = s.trackedCollections.filter((a) => a.toLowerCase() !== norm);
  const removed = s.trackedCollections.length < before;
  if (removed) saveGuildSettings(guildId, s);
  return { removed, settings: s };
}

export function setBuysChannel(guildId: string, id: string | null): GuildSettings {
  return updateGuild(guildId, (s) => { s.channelBuysId = id; });
}

export function setBuyToken(guildId: string, tokenAddress: string, pairAddress: string): GuildSettings {
  return updateGuild(guildId, (s) => {
    s.buyTokenAddress = tokenAddress;
    s.buyPairAddress = pairAddress;
  });
}

export function setMinBuyCro(guildId: string, amount: number): GuildSettings {
  return updateGuild(guildId, (s) => { s.minBuyCro = amount; });
}

export function setBuyImage(guildId: string, url: string | null): GuildSettings {
  return updateGuild(guildId, (s) => { s.buyImageUrl = url; });
}

export function setBuyEmoji(guildId: string, emoji: string): GuildSettings {
  return updateGuild(guildId, (s) => { s.buyEmoji = emoji; });
}

export function setBuyRates(guildId: string, rates: [number, number, number, number]): GuildSettings {
  return updateGuild(guildId, (s) => { s.buyRates = rates; });
}

export function clearBuyConfig(guildId: string): GuildSettings {
  return updateGuild(guildId, (s) => {
    s.channelBuysId = null;
    s.buyTokenAddress = null;
    s.buyPairAddress = null;
    s.minBuyCro = 0;
    s.buyImageUrl = null;
    s.buyEmoji = "🟢";
    s.buyRates = [10, 50, 200, 500];
  });
}
