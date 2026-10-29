// In-memory request history + response cache (per server instance, free).
export type HistoryEntry = {
  at: string;
  method: string;
  provider: string;
  userId?: string | undefined;
  lang: string;
  target_lang?: string;
  status: number;
  ms: number;
  bytes: number;
  cached: boolean;
  error?: string;
  inputChars?: number;
  outputChars?: number;
  estimatedInputTokens?: number;
  providerInputTokens?: number | undefined;
  providerOutputTokens?: number | undefined;
};

const HISTORY_MAX = 500;
export const history: HistoryEntry[] = [];
export async function record(e: HistoryEntry) {
  history.unshift(e);
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    await supabaseAdmin.from('provider_usage_events').insert({
      method: e.method,
      service: e.provider.slice(0, 40),
      user_id: e.userId ?? null,
      status: e.status,
      duration_ms: Math.max(0, Math.round(e.ms)),
      audio_bytes: Math.max(0, e.bytes),
      input_chars: Math.max(0, e.inputChars ?? 0),
      output_chars: Math.max(0, e.outputChars ?? 0),
      estimated_input_tokens: Math.max(0, e.estimatedInputTokens ?? 0),
      provider_input_tokens: e.providerInputTokens ?? null,
      provider_output_tokens: e.providerOutputTokens ?? null,
      cached: e.cached,
    });
  } catch {
    // Usage collection is best-effort and must not block public synthesis.
  }
}

type CacheVal = { audio: Uint8Array; mime: string; text: string; lang: string; provider: string; usage?: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined };
const CACHE_MAX_BYTES = 50 * 1024 * 1024;
const CACHE_TTL = 24 * 60 * 60 * 1000;
const cache = new Map<string, { v: CacheVal; at: number }>();
let cacheBytes = 0;
export const cacheStats = { hits: 0, misses: 0 };

export function cacheGet(key: string): CacheVal | undefined {
  const e = cache.get(key);
  if (!e || Date.now() - e.at > CACHE_TTL) {
    if (e) {
      cache.delete(key);
      cacheBytes -= e.v.audio.length;
    }
    cacheStats.misses++;
    return undefined;
  }
  cache.delete(key);
  cache.set(key, e); // LRU bump
  cacheStats.hits++;
  return e.v;
}

export function cacheSet(key: string, v: CacheVal) {
  if (v.audio.length > CACHE_MAX_BYTES / 4) return;
  cache.set(key, { v, at: Date.now() });
  cacheBytes += v.audio.length;
  for (const [k, e] of cache) {
    if (cacheBytes <= CACHE_MAX_BYTES) break;
    cache.delete(k);
    cacheBytes -= e.v.audio.length;
  }
}

export function cacheInfo() {
  return { entries: cache.size, bytes: cacheBytes, ...cacheStats };
}
