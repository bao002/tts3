import { KEY_SERVICES, type KeyService } from "@/lib/openrouter-pool.server";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_TOKENS = 100;
const MAX_KEYS_PER_PROVIDER = 10;
const MAX_TOTAL_KEYS = 50;
const MAX_KEY_LENGTH = 500;
const encoder = new TextEncoder();

export type MemoryProviderKeys = Partial<Record<KeyService, string[]>>;

type StoredToken = {
  hash: string;
  providerKeys: MemoryProviderKeys;
  expiresAt: number;
};

const tokens = new Map<string, StoredToken>();

function secret() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function hash(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equal(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function removeExpired(now = Date.now()) {
  for (const [id, entry] of tokens) {
    if (entry.expiresAt <= now) tokens.delete(id);
  }
}

export function validateMemoryProviderKeys(value: unknown): MemoryProviderKeys | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys: MemoryProviderKeys = {};
  let total = 0;

  for (const [service, list] of Object.entries(input)) {
    if (!(KEY_SERVICES as readonly string[]).includes(service)) return null;
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_KEYS_PER_PROVIDER) {
      return null;
    }
    const values: string[] = [];
    for (const item of list) {
      if (
        typeof item !== "string" ||
        item.trim().length === 0 ||
        item.trim().length > MAX_KEY_LENGTH
      ) {
        return null;
      }
      const key = item.trim();
      if (!values.includes(key)) values.push(key);
    }
    keys[service as KeyService] = values;
    total += values.length;
    if (total > MAX_TOTAL_KEYS) return null;
  }

  return total > 0 ? keys : null;
}

export async function createMemoryAccessToken(providerKeys: MemoryProviderKeys) {
  const now = Date.now();
  removeExpired(now);
  if (tokens.size >= MAX_ACTIVE_TOKENS) {
    throw new Error("The temporary token limit has been reached. Revoke or wait for a token to expire.");
  }

  const id = crypto.randomUUID();
  const token = `spt_${id}.${secret()}`;
  tokens.set(id, {
    hash: await hash(token),
    providerKeys: structuredClone(providerKeys),
    expiresAt: now + TOKEN_TTL_MS,
  });
  return {
    id,
    token,
    expires_at: new Date(now + TOKEN_TTL_MS).toISOString(),
    providers: Object.entries(providerKeys).map(([service, keys]) => ({
      service,
      key_count: keys?.length ?? 0,
    })),
  };
}

export async function resolveMemoryAccessToken(token: string) {
  const match = /^spt_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token);
  const id = match?.[1];
  if (!id) return null;
  const entry = tokens.get(id);
  if (!entry || entry.expiresAt <= Date.now()) {
    tokens.delete(id);
    return null;
  }
  if (!equal(entry.hash, await hash(token))) return null;
  return { userId: `memory:${id}`, providerKeys: structuredClone(entry.providerKeys) };
}

export function memoryProviderKeys(userId: string, service: KeyService): string[];
export function memoryProviderKeys(userId: string): MemoryProviderKeys | undefined;
export function memoryProviderKeys(userId: string, service?: KeyService) {
  const id = userId.startsWith("memory:") ? userId.slice("memory:".length) : "";
  const entry = tokens.get(id);
  if (!entry || entry.expiresAt <= Date.now()) {
    tokens.delete(id);
    return service ? [] : undefined;
  }
  return service
    ? [...(entry.providerKeys[service] ?? [])]
    : structuredClone(entry.providerKeys);
}

export async function revokeMemoryAccessToken(token: string) {
  const resolved = await resolveMemoryAccessToken(token);
  if (!resolved) return false;
  return tokens.delete(resolved.userId.slice("memory:".length));
}

export function memoryTokenCount() {
  removeExpired();
  return tokens.size;
}

export const MEMORY_ACCESS_TOKEN_TTL_SECONDS = TOKEN_TTL_MS / 1000;
