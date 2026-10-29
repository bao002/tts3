// Server-only TTS + translation providers.
import { speechBody } from "./fish-audio";
export type Provider =
  "auto" | "google" | "lovable" | "openrouter" | "gemini" | "openai" | "elevenlabs" | "deepgram";
export type TtsInput = {
  text: string;
  lang: string;
  targetLang?: string | undefined;
  provider: Provider;
  apiKey?: string | undefined;
  userId?: string | undefined;
  voice?: string | undefined;
  speed?: number | undefined;
  options?: Record<string, unknown> | undefined;
};
export type ProviderUsage = { inputTokens?: number | undefined; outputTokens?: number | undefined };
export type TtsResult = {
  audio: Uint8Array;
  mime: string;
  text: string;
  lang: string;
  provider: Provider;
  usage?: ProviderUsage | undefined;
};

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Reads an SSE body, calling onData for every `data:` payload.
async function readSse(res: Response, onData: (data: string) => void) {
  if (!res.body) throw new HttpError(502, "Empty streaming response");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) {
        const d = line.slice(5).trim();
        if (d && d !== "[DONE]") onData(d);
      }
    }
  }
}

function chunkText(text: string, max = 180): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) {
      chunks.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) chunks.push(cur);
  return chunks.flatMap((c) =>
    c.length > max ? (c.match(new RegExp(`.{1,${max}}`, "g")) ?? []) : [c],
  );
}

// ---------------- Google ----------------
async function googleTranslate(text: string, sl: string, tl: string) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl || "auto")}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new HttpError(502, `Google translate failed (${res.status})`);
  const data = (await res.json()) as [Array<[string]>];
  return data[0].map((s) => s[0]).join("");
}

async function googleTts(text: string, lang: string, speed?: number) {
  const parts: Uint8Array[] = [];
  const chunks = chunkText(text);
  const speedParam = speed ? `&ttsspeed=${speed}` : "";
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] ?? "";
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=gtx&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(chunk)}&total=${chunks.length}&idx=${i}&textlen=${chunk.length}${speedParam}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://translate.google.com/" },
    });
    if (!res.ok) throw new HttpError(502, `Google TTS failed (${res.status})`);
    parts.push(new Uint8Array(await res.arrayBuffer()));
  }
  return concat(parts);
}

// ---------------- Lovable AI ----------------
function translatePrompt(text: string, sl: string, tl: string) {
  return `Translate the following text${sl ? ` from ${sl}` : ""} to the language with code "${tl}". Reply with the translation only, nothing else.\n\n${text}`;
}

async function lovableTranslate(
  text: string,
  sl: string,
  tl: string,
  apiKey?: string,
  userId?: string,
) {
  return withProviderKey(
    "lovable",
    apiKey,
    (key) =>
      fetch(`${GATEWAY}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Lovable-AIG-SDK": "fetch",
        },
        body: JSON.stringify({
          model: "openai/gpt-6-astra",
          input: translatePrompt(text, sl, tl),
          reasoning: { effort: "low" },
          store: false,
          stream: true,
        }),
      }),
    async (res) => {
      if (!res.ok)
        throw new HttpError(
          res.status,
          `Lovable translate failed: ${(await res.text()).slice(0, 300)}`,
        );
      let out = "";
      let usage: ProviderUsage | undefined;
      await readSse(res, (d) => {
        try {
          const e = JSON.parse(d);
          if (e.type === "response.output_text.delta") out += e.delta;
          if (e.type === "response.completed" && e.response?.usage)
            usage = {
              inputTokens: e.response.usage.input_tokens,
              outputTokens: e.response.usage.output_tokens,
            };
        } catch {
          return;
        }
      });
      if (!out.trim()) throw new HttpError(502, "Lovable translate returned empty text");
      return { text: out.trim(), usage };
    },
    userId,
  );
}

async function lovableTts(
  text: string,
  voice = "Kore",
  speed?: number,
  options?: Record<string, unknown>,
  apiKey?: string,
  userId?: string,
) {
  // Gemini TTS has no numeric speed param; steer pacing with a style instruction.
  const spoken =
    speed && speed !== 1
      ? `Say this ${speed < 1 ? "slowly" : "quickly"} (about ${speed}x normal pace): ${text}`
      : text;
  return withProviderKey(
    "lovable",
    apiKey,
    (key) =>
      fetch(`${GATEWAY}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3.1-flash-tts-preview",
          contents: [{ role: "user", parts: [{ text: spoken }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
          stream_format: "audio",
          ...options,
        }),
      }),
    async (res) => {
      if (!res.ok)
        throw new HttpError(res.status, `Lovable TTS failed: ${(await res.text()).slice(0, 300)}`);
      return {
        audio: new Uint8Array(await res.arrayBuffer()),
        mime: res.headers.get("content-type") || "audio/wav",
      };
    },
    userId,
  );
}

function pcmToWav(pcm: Uint8Array, sampleRate: number) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeText = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, pcm.length, true);
  return concat([new Uint8Array(header), pcm]);
}

async function geminiTts(
  text: string,
  lang: string,
  voice = "Kore",
  apiKey?: string,
  options?: Record<string, unknown>,
  userId?: string,
) {
  const model =
    typeof options?.["model"] === "string" ? options["model"] : "gemini-2.5-flash-preview-tts";
  return withProviderKey(
    "gemini",
    apiKey,
    (key) =>
      fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Speak naturally in ${lang}: ${text}` }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            },
          }),
        },
      ),
    async (response) => {
      const result = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
        }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const audioParts =
        result.candidates
          ?.flatMap((candidate) => candidate.content?.parts ?? [])
          .flatMap((part) => (part.inlineData?.data ? [part.inlineData] : [])) ?? [];
      if (!audioParts.length) throw new HttpError(502, "Gemini returned no audio data");
      const rate = Number(audioParts[0]?.mimeType?.match(/rate=(\d+)/)?.[1] ?? 24000);
      return {
        audio: pcmToWav(concat(audioParts.map((part) => b64ToBytes(part.data!))), rate),
        mime: "audio/wav",
        usage: {
          inputTokens: result.usageMetadata?.promptTokenCount,
          outputTokens: result.usageMetadata?.candidatesTokenCount,
        },
      };
    },
    userId,
  );
}

async function openaiTts(
  text: string,
  lang: string,
  voice = "coral",
  apiKey?: string,
  speed?: number,
  options?: Record<string, unknown>,
  userId?: string,
) {
  const model = typeof options?.["model"] === "string" ? options["model"] : "gpt-4o-mini-tts";
  return withProviderKey(
    "openai",
    apiKey,
    (key) =>
      fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          voice,
          input: text,
          response_format: "mp3",
          ...(speed !== undefined && { speed }),
          ...(typeof options?.["instructions"] === "string"
            ? { instructions: options["instructions"] }
            : { instructions: `Speak naturally in ${lang}.` }),
        }),
      }),
    async (response) => new Uint8Array(await response.arrayBuffer()),
    userId,
  );
}

async function elevenLabsTts(
  text: string,
  lang: string,
  voice = "JBFqnCBsd6RMkjVDRZzb",
  apiKey?: string,
  speed?: number,
  options?: Record<string, unknown>,
  userId?: string,
) {
  const model =
    typeof options?.["model"] === "string" ? options["model"] : "eleven_multilingual_v2";
  const voiceId = typeof options?.["voice_id"] === "string" ? options["voice_id"] : voice;
  return withProviderKey(
    "elevenlabs",
    apiKey,
    (key) =>
      fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({
            text,
            model_id: model,
            language_code: lang.toLowerCase().split("-")[0],
            ...(speed !== undefined && {
              voice_settings: { speed: Math.max(0.7, Math.min(1.2, speed)) },
            }),
          }),
        },
      ),
    async (response) => new Uint8Array(await response.arrayBuffer()),
    userId,
  );
}

const deepgramModels: Record<string, string> = {
  en: "aura-2-thalia-en",
  es: "aura-2-celeste-es",
  de: "aura-2-helena-de",
  nl: "aura-2-rhea-nl",
  fr: "aura-2-agathe-fr",
  it: "aura-2-maia-it",
  ja: "aura-2-ama-ja",
};

async function deepgramTts(
  text: string,
  lang: string,
  voice?: string,
  apiKey?: string,
  speed?: number,
  options?: Record<string, unknown>,
  userId?: string,
) {
  const model =
    (typeof options?.["model"] === "string" && options["model"]) ||
    voice ||
    deepgramModels[lang.toLowerCase().split("-")[0] ?? ""] ||
    "aura-2-thalia-en";
  const query = new URLSearchParams({ model });
  if (speed !== undefined) query.set("speed", String(speed));
  for (const name of ["encoding", "container", "sample_rate", "bit_rate", "mip_opt_out"]) {
    const value = options?.[name];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      query.set(name, String(value));
    }
  }
  return withProviderKey(
    "deepgram",
    apiKey,
    (key) =>
      fetch(`https://api.deepgram.com/v1/speak?${query}`, {
        method: "POST",
        headers: {
          Authorization: `Token ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      }),
    async (response) => ({
      audio: new Uint8Array(await response.arrayBuffer()),
      mime: response.headers.get("content-type") || "audio/mpeg",
    }),
    userId,
  );
}

// ---------------- Persistent OpenRouter key pool ----------------
import {
  KEY_SERVICES,
  environmentKeys,
  hasSupabaseAdminConfig,
  poolRows,
  reserveKey,
  reserveAnyKey,
  decryptKey,
  markKey,
  userKeyRows,
  reserveUserKey,
  reserveAnyUserKey,
  markUserKey,
  type KeyService,
} from "./openrouter-pool.server";
import { memoryProviderKeys } from "./memory-api-tokens.server";
export const startedAt = Date.now();
const BLOCKED = new Set([401, 402, 403, 429]);
const PROVIDER_LABELS: Record<KeyService, string> = {
  openrouter: "OpenRouter",
  lovable: "Lovable AI",
  gemini: "Google Gemini",
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
  deepgram: "Deepgram",
};
const PROVIDER_ERROR_BODY_LIMIT = 4096;

type ProviderFailure = { status: number; detail?: string };

async function providerErrorDetail(
  response: Response,
  apiKey: string,
): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;

  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (bytesRead < PROVIDER_ERROR_BODY_LIMIT) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = PROVIDER_ERROR_BODY_LIMIT - bytesRead;
      const chunk = value.subarray(0, remaining);
      chunks.push(chunk);
      bytesRead += chunk.byteLength;
      if (chunk.byteLength < value.byteLength) break;
    }
  } catch {
    return undefined;
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(concat(chunks)));
  } catch {
    return undefined;
  }
  if (typeof payload !== "object" || payload === null) return undefined;

  const error = Reflect.get(payload, "error");
  const message =
    typeof error === "object" && error !== null && typeof Reflect.get(error, "message") === "string"
      ? Reflect.get(error, "message")
      : typeof error === "string"
        ? error
        : Reflect.get(payload, "message");
  if (typeof message !== "string") return undefined;

  const sanitized = (apiKey ? message.replaceAll(apiKey, "[redacted]") : message)
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return sanitized || undefined;
}

function providerFailureExplanation(service: KeyService, status: number) {
  const label = PROVIDER_LABELS[service];
  if (status === 401)
    return `${label} rejected the API key. Check that the key is current and correctly saved.`;
  if (status === 403)
    return `${label} denied access. Check the key's permissions and access to the requested model.`;
  if (status === 402)
    return `${label} reported a billing or account payment issue. Check the provider account.`;
  if (status === 429)
    return `${label} rate-limited the request or the account has reached a usage limit.`;
  if (status === 503)
    return `${label} is temporarily unavailable. This does not by itself mean the API key is invalid; test a saved key in Account or verify the server-configured key, then retry later if it is accepted.`;
  if (status === 599)
    return `Could not connect to ${label}. Check network access and retry; this does not by itself mean the API key is invalid.`;
  if (status >= 500)
    return `${label} returned a server error. This does not by itself mean the API key is invalid; retry later.`;
  return `${label} rejected the request. Check the request settings and provider key permissions.`;
}

function summarizeProviderFailures(service: KeyService, failures: ProviderFailure[]) {
  const label = PROVIDER_LABELS[service];
  const latest = failures.at(-1);
  if (!latest) {
    return new HttpError(
      503,
      `No ${label} key could be reserved for this request. Check key availability and try again.`,
    );
  }
  const counts = new Map<number, number>();
  for (const failure of failures) counts.set(failure.status, (counts.get(failure.status) ?? 0) + 1);
  const results = [...counts]
    .map(([status, count]) => `HTTP ${status}${count > 1 ? ` (${count} keys)` : ""}`)
    .join(", ");
  const detail = latest.detail ? ` Provider detail: ${latest.detail}` : "";
  const status = latest.status >= 400 && latest.status < 500 ? latest.status : 502;
  return new HttpError(
    status,
    `Tried ${failures.length} ${label} key${failures.length === 1 ? "" : "s"}; results: ${results}. ${providerFailureExplanation(service, latest.status)}${detail}`,
  );
}

function shuffled<T>(values: T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

async function withProviderKey<T>(
  service: KeyService,
  apiKey: string | undefined,
  fn: (key: string) => Promise<Response>,
  parse: (r: Response) => Promise<T>,
  userId?: string,
): Promise<T> {
  const supplied = apiKey?.trim();
  if (supplied) {
    const response = await fn(supplied);
    if (!response.ok) {
      const detail = await providerErrorDetail(response, supplied);
      throw new HttpError(
        response.status,
        `${service} request failed (HTTP ${response.status}). ${providerFailureExplanation(service, response.status)}${detail ? ` Provider detail: ${detail}` : ""}`,
      );
    }
    return parse(response);
  }
  if (userId?.startsWith("memory:")) {
    const keys = shuffled(memoryProviderKeys(userId, service) ?? []);
    if (!keys.length) {
      throw new HttpError(
        400,
        `Your temporary access token does not include a ${PROVIDER_LABELS[service]} API key.`,
      );
    }
    const failures: ProviderFailure[] = [];
    for (const key of keys) {
      let response: Response;
      try {
        response = await fn(key);
      } catch {
        failures.push({ status: 599 });
        continue;
      }
      if (response.ok) {
        try {
          return await parse(response);
        } catch (error) {
          failures.push({ status: 502 });
          if (error instanceof HttpError && error.status < 500) throw error;
          continue;
        }
      }
      const detail = await providerErrorDetail(response, key);
      failures.push({ status: response.status, ...(detail ? { detail } : {}) });
      if (BLOCKED.has(response.status) || response.status >= 500) continue;
      throw summarizeProviderFailures(service, failures);
    }
    throw summarizeProviderFailures(service, failures);
  }
  if (!userId && !hasSupabaseAdminConfig()) {
    const keys = shuffled(environmentKeys(service));
    if (!keys.length) {
      throw new HttpError(400, providerKeySetupMessage(service, false, Boolean(userId), false));
    }
    const failures: ProviderFailure[] = [];
    for (const key of keys) {
      let response: Response;
      try {
        response = await fn(key);
      } catch {
        failures.push({ status: 502 });
        continue;
      }
      if (response.ok) {
        try {
          return await parse(response);
        } catch (error) {
          failures.push({ status: 502 });
          if (error instanceof HttpError && error.status < 500) throw error;
          continue;
        }
      }
      const detail = await providerErrorDetail(response, key);
      failures.push({ status: response.status, ...(detail ? { detail } : {}) });
      if (BLOCKED.has(response.status) || response.status >= 500) continue;
      throw summarizeProviderFailures(service, failures);
    }
    throw summarizeProviderFailures(service, failures);
  }
  let all: Array<{ id: string; ciphertext: string }>;
  try {
    all = userId ? await userKeyRows(userId, service) : await poolRows(service);
  } catch {
    throw new HttpError(503, providerKeySetupMessage(service, true, Boolean(userId), true));
  }
  if (!all.length) {
    throw new HttpError(400, providerKeySetupMessage(service, false, Boolean(userId), true));
  }
  const attempted: string[] = [];
  const failures: ProviderFailure[] = [];
  for (let attempt = 0; attempt < all.length; attempt++) {
    const row = userId
      ? await reserveUserKey(userId, service, attempted)
      : (await reserveKey(service, attempted)).key;
    if (!row) break;
    attempted.push(row.id);
    const mark = (code: number) =>
      userId ? markUserKey(userId, row.id, code) : markKey(row.id, code);
    let response: Response;
    let apiKey: string;
    try {
      apiKey = await decryptKey(row);
      response = await fn(apiKey);
    } catch {
      await mark(599);
      failures.push({ status: 599 });
      continue;
    }
    if (response.ok) {
      try {
        const result = await parse(response);
        await mark(response.status);
        return result;
      } catch (error) {
        await mark(502);
        failures.push({ status: 502 });
        if (error instanceof HttpError && error.status < 500) throw error;
        continue;
      }
    }
    const detail = await providerErrorDetail(response, apiKey);
    failures.push({ status: response.status, ...(detail ? { detail } : {}) });
    await mark(response.status);
    if (BLOCKED.has(response.status) || response.status >= 500) continue;
    throw summarizeProviderFailures(service, failures);
  }
  throw summarizeProviderFailures(service, failures);
}

function providerKeySetupMessage(
  service: KeyService,
  savedKeysUnavailable: boolean,
  userOwned = false,
  supabaseAvailable = true,
) {
  const envName = service.toUpperCase();
  const setup = userOwned
    ? "Add a provider API key in your account. Personal API tokens only use keys saved to that account."
    : `Set ${envName}_API_KEY or ${envName}_API_KEYS${supabaseAvailable ? ", or add a saved provider key" : ""}.`;
  return `${PROVIDER_LABELS[service]} requires an API key. ${savedKeysUnavailable ? `Saved keys could not be loaded. ` : ""}${setup}`;
}

function orFetch(key: string, body: unknown) {
  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function openrouterTranslate(
  text: string,
  sl: string,
  tl: string,
  apiKey?: string,
  userId?: string,
) {
  return withProviderKey(
    "openrouter",
    apiKey,
    (k) =>
      orFetch(k, {
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: translatePrompt(text, sl, tl) }],
      }),
    async (r) => {
      const j = (await r.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const t = j.choices?.[0]?.message?.content?.trim();
      if (!t) throw new HttpError(502, "OpenRouter translate returned empty text");
      return {
        text: t,
        usage: { inputTokens: j.usage?.prompt_tokens, outputTokens: j.usage?.completion_tokens },
      };
    },
    userId,
  );
}

async function openrouterTts(
  text: string,
  lang: string,
  voice?: string,
  apiKey?: string,
  speed?: number,
  options?: Record<string, unknown>,
  userId?: string,
) {
  return withProviderKey(
    "openrouter",
    apiKey,
    (k) =>
      fetch("https://openrouter.ai/api/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
        body: JSON.stringify(speechBody(text, lang, voice, speed, options)),
      }),
    async (r) => new Uint8Array(await r.arrayBuffer()),
    userId,
  );
}

async function synthesizeAuto(input: TtsInput): Promise<TtsResult> {
  if (input.apiKey?.trim()) {
    throw new HttpError(
      400,
      "A per-request API key requires a specific keyed provider; Auto cannot determine which provider the key belongs to.",
    );
  }
  const target = input.targetLang?.trim();
  const request =
    target && target !== input.lang
      ? {
          ...input,
          text: await googleTranslate(input.text, input.lang, target),
          lang: target,
          targetLang: undefined,
        }
      : input;
  if (input.userId?.startsWith("memory:")) {
    const keysByProvider = memoryProviderKeys(input.userId);
    const candidates = shuffled(
      KEY_SERVICES.flatMap((service) =>
        (keysByProvider?.[service] ?? []).map((apiKey) => ({ service, apiKey })),
      ),
    );
    if (!candidates.length) {
      throw new HttpError(400, "Your temporary access token has no provider API keys.");
    }
    let lastError: unknown;
    for (const { service, apiKey } of candidates) {
      try {
        return await synthesize({ ...request, provider: service, apiKey });
      } catch (error) {
        lastError = error;
        const status = error instanceof HttpError ? error.status : 599;
        if (error instanceof HttpError && !BLOCKED.has(status) && status < 500) throw error;
      }
    }
    if (lastError) throw lastError;
    throw new HttpError(400, "No provider key is available for Auto routing.");
  }
  if (!input.userId && !hasSupabaseAdminConfig()) {
    const candidates = shuffled(
      KEY_SERVICES.flatMap((service) =>
        environmentKeys(service).map((apiKey) => ({ service, apiKey })),
      ),
    );
    if (!candidates.length) {
      throw new HttpError(
        400,
        "Auto routing without Supabase requires at least one provider key configured through server environment variables.",
      );
    }
    let lastError: unknown;
    for (const { service, apiKey } of candidates) {
      try {
        return await synthesize({ ...request, provider: service, apiKey });
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 599;
        lastError = error;
        if (error instanceof HttpError && !BLOCKED.has(status) && status < 500) throw error;
      }
    }
    if (lastError) throw lastError;
  }
  if (!input.userId && hasSupabaseAdminConfig()) {
    try {
      await poolRows();
    } catch {
      throw new HttpError(
        503,
        "Auto routing could not load provider keys. Check provider-key storage and environment configuration.",
      );
    }
  }
  const excluded: string[] = [];
  let lastError: unknown;
  for (;;) {
    let row;
    try {
      row = input.userId
        ? await reserveAnyUserKey(input.userId, excluded)
        : await reserveAnyKey(excluded);
    } catch {
      throw new HttpError(
        503,
        "Auto routing could not load provider keys. Check provider-key storage and environment configuration.",
      );
    }
    if (!row) break;
    excluded.push(row.id);
    if (!(KEY_SERVICES as readonly string[]).includes(row.service)) continue;
    const provider = row.service as KeyService;
    try {
      const result = await synthesize({ ...request, provider, apiKey: await decryptKey(row) });
      const mark = input.userId ? markUserKey(input.userId, row.id, 200) : markKey(row.id, 200);
      await mark.catch((error) => console.error("Could not update provider key status", error));
      return { ...result, provider };
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 599;
      const mark = input.userId
        ? markUserKey(input.userId, row.id, status)
        : markKey(row.id, status);
      await mark.catch((markError) =>
        console.error("Could not update provider key status", markError),
      );
      lastError = error;
      if (error instanceof HttpError && !BLOCKED.has(error.status) && error.status < 500)
        throw error;
    }
  }
  if (lastError) throw lastError;
  throw new HttpError(
    400,
    input.userId
      ? "No provider key is available in your account. Add a provider key in your account settings."
      : "No provider key is available for Auto routing. Add a key in account settings or configure a provider key on the server.",
  );
}

// ---------------- Entry ----------------
export async function synthesize(input: TtsInput): Promise<TtsResult> {
  if (input.provider === "auto") return synthesizeAuto(input);
  let { text } = input;
  let usage: ProviderUsage | undefined;
  const target = input.targetLang?.trim();
  if (target && target !== input.lang) {
    if (
      input.provider === "google" ||
      input.provider === "gemini" ||
      input.provider === "openai" ||
      input.provider === "elevenlabs" ||
      input.provider === "deepgram"
    )
      text = await googleTranslate(text, input.lang, target);
    else {
      const translated =
        input.provider === "lovable"
          ? await lovableTranslate(text, input.lang, target, input.apiKey, input.userId)
          : await openrouterTranslate(text, input.lang, target, input.apiKey, input.userId);
      text = translated.text;
      usage = translated.usage;
    }
  }
  const lang = target || input.lang;
  if (input.provider === "google")
    return {
      audio: await googleTts(text, lang, input.speed),
      mime: "audio/mpeg",
      text,
      lang,
      provider: "google",
    };
  if (input.provider === "lovable") {
    const r = await lovableTts(
      text,
      input.voice,
      input.speed,
      input.options,
      input.apiKey,
      input.userId,
    );
    return { ...r, text, lang, provider: "lovable", usage };
  }
  if (input.provider === "gemini") {
    const r = await geminiTts(text, lang, input.voice, input.apiKey, input.options, input.userId);
    return { ...r, text, lang, provider: "gemini", usage: mergeUsage(usage, r.usage) };
  }
  if (input.provider === "openai") {
    return {
      audio: await openaiTts(
        text,
        lang,
        input.voice,
        input.apiKey,
        input.speed,
        input.options,
        input.userId,
      ),
      mime: "audio/mpeg",
      text,
      lang,
      provider: "openai",
      usage,
    };
  }
  if (input.provider === "elevenlabs") {
    return {
      audio: await elevenLabsTts(
        text,
        lang,
        input.voice,
        input.apiKey,
        input.speed,
        input.options,
        input.userId,
      ),
      mime: "audio/mpeg",
      text,
      lang,
      provider: "elevenlabs",
      usage,
    };
  }
  if (input.provider === "deepgram") {
    const r = await deepgramTts(
      text,
      lang,
      input.voice,
      input.apiKey,
      input.speed,
      input.options,
      input.userId,
    );
    return { ...r, text, lang, provider: "deepgram", usage };
  }
  return {
    audio: await openrouterTts(
      text,
      lang,
      input.voice,
      input.apiKey,
      input.speed,
      input.options,
      input.userId,
    ),
    mime: "audio/mpeg",
    text,
    lang,
    provider: "openrouter",
    usage,
  };
}

function mergeUsage(a?: ProviderUsage, b?: ProviderUsage): ProviderUsage | undefined {
  if (!a && !b) return undefined;
  return {
    inputTokens:
      a?.inputTokens === undefined && b?.inputTokens === undefined
        ? undefined
        : (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
    outputTokens:
      a?.outputTokens === undefined && b?.outputTokens === undefined
        ? undefined
        : (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
  };
}

export function bytesToB64(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
