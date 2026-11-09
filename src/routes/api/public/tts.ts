import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { synthesize, HttpError, bytesToB64 } from "@/lib/tts.server";
import { runWithTrace, redactHeaders, redactUrl, type TraceEntry } from "@/lib/trace.server";
import { isRequestObject, redactBody } from "@/lib/request-safety";
import { readJsonBody, RequestBodyError } from "@/lib/request-body";
import { record, cacheGet, cacheSet } from "@/lib/monitor.server";
import { resolveApiUser, UserAuthError } from "@/lib/user-account.server";

const CORS = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers":
    "X-Spoken-Text, X-Spoken-Lang, X-Provider, X-Cache, X-Response-Time-Ms, X-Provider-Input-Tokens, X-Provider-Output-Tokens, Content-Type",
};

const optionsSchema = z
  .union([
    z.record(z.string(), z.unknown()),
    z
      .string()
      .max(2000)
      .transform((s, ctx) => {
        try {
          const parsed: unknown = JSON.parse(s);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            return parsed as Record<string, unknown>;
        } catch {
          ctx.addIssue({ code: "custom", message: "options must be a JSON object" });
          return z.NEVER;
        }
        ctx.addIssue({ code: "custom", message: "options must be a JSON object" });
        return z.NEVER;
      }),
  ])
  .optional();

const schema = z.object({
  text: z.string().trim().min(1).max(5000),
  lang: z.string().trim().min(2).max(20),
  target_lang: z.string().trim().max(20).optional().or(z.literal("")),
  provider: z
    .enum(["auto", "google", "lovable", "openrouter", "gemini", "openai", "elevenlabs", "deepgram"])
    .default("google"),
  providers: z.preprocess((v) => {
    if (typeof v !== "string") return v;
    try { return JSON.parse(v); } catch { return v.split(",").map((s) => s.trim()); }
  }, z.array(z.enum(["google", "lovable", "openrouter", "gemini", "openai", "elevenlabs", "deepgram"])).min(1).max(7).refine((v) => new Set(v).size === v.length, "providers must be unique").optional()),
  provider_options: optionsSchema.pipe(z.record(
    z.enum(["google", "lovable", "openrouter", "gemini", "openai", "elevenlabs", "deepgram"]),
    z.record(z.string(), z.unknown()),
  ).optional()),
  api_key: z.string().max(500).optional().or(z.literal("")),
  voice: z.string().max(50).optional().or(z.literal("")),
  voices: optionsSchema.pipe(
    z
      .record(
        z.enum(["lovable", "openrouter", "gemini", "openai", "elevenlabs", "deepgram"]),
        z.string().max(50),
      )
      .optional(),
  ),
  speed: z.coerce.number().min(0.25).max(4).optional(),
  options: optionsSchema,
  format: z.enum(["binary", "json"]).default("binary"),
  debug: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0", "on", "off"])])
    .optional()
    .transform((v) => v === true || v === "true" || v === "1" || v === "on"),
});

async function handle(
  raw: Record<string, unknown>,
  method: string,
  userId?: string,
  headerApiKey?: string,
  incoming?: { url: string; headers: Headers },
) {
  const request = headerApiKey?.trim() ? { ...raw, api_key: headerApiKey.trim() } : raw;
  const t0 = Date.now();
  const parsed = schema.safeParse(request);
  if (!parsed.success) {
    await record({
      at: new Date().toISOString(),
      method,
      provider: String(request["provider"] ?? ""),
      lang: String(request["lang"] ?? ""),
      userId,
      status: 400,
      ms: 0,
      bytes: 0,
      cached: false,
      error: "invalid input",
    });
    return Response.json({ error: parsed.error.flatten() }, { status: 400, headers: CORS });
  }
  const p = parsed.data;
  if (p.api_key && (p.providers || p.provider === "auto" || p.provider === "google")) {
    return Response.json(
      {
        error:
          "A per-request API key requires a specific keyed provider; Auto and Google do not accept api_key.",
      },
      { status: 400, headers: CORS },
    );
  }
  if (userId && p.api_key) {
    return Response.json(
      { error: "Personal API tokens use provider keys saved to the account; omit api_key." },
      { status: 400, headers: CORS },
    );
  }
  const base = {
    method,
    provider: p.provider,
    lang: p.lang,
    ...(p.target_lang ? { target_lang: p.target_lang } : {}),
  };
  const key = JSON.stringify([
    p.provider,
    p.providers ?? null,
    p.provider_options ?? null,
    p.lang,
    p.target_lang || "",
    p.voice || "",
    p.voices ?? null,
    p.speed ?? "",
    p.options ?? null,
    p.text,
  ]);
  const trace: TraceEntry[] = [];
  const serverLog = () => ({
    received: {
      method,
      url: incoming ? redactUrl(incoming.url) : undefined,
      headers: incoming ? redactHeaders(incoming.headers) : undefined,
      body: redactBody(p),
    },
    provider_calls: trace,
  });
  try {
    let r = p.debug || p.provider === "auto" || userId || p.api_key ? undefined : cacheGet(key);
    const cached = !!r;
    if (!r) {
      const input = {
        text: p.text,
        lang: p.lang,
        targetLang: p.target_lang || undefined,
        provider: p.provider,
        providers: p.providers,
        providerOptions: p.provider_options,
        userId,
        apiKey: p.api_key || undefined,
        voice: p.voice || undefined,
        voices: p.voices,
        speed: p.speed,
        options: p.options,
      };
      r = p.debug ? await runWithTrace(trace, () => synthesize(input)) : await synthesize(input);
      if (p.provider !== "auto" && !userId && !p.api_key) cacheSet(key, r);
    }
    const responseTimeMs = Date.now() - t0;
    await record({
      at: new Date().toISOString(),
      ...base,
      userId,
      provider: r.provider,
      status: 200,
      ms: responseTimeMs,
      bytes: r.audio.length,
      cached,
      inputChars: p.text.length,
      outputChars: r.text.length,
      estimatedInputTokens: cached ? 0 : Math.ceil(r.text.length / 4),
      providerInputTokens: cached ? undefined : r.usage?.inputTokens,
      providerOutputTokens: cached ? undefined : r.usage?.outputTokens,
    });
    const extra = {
      "X-Cache": cached ? "HIT" : "MISS",
      "X-Provider": r.provider,
      "X-Response-Time-Ms": String(responseTimeMs),
      ...(!cached && r.usage?.inputTokens !== undefined
        ? { "X-Provider-Input-Tokens": String(r.usage.inputTokens) }
        : {}),
      ...(!cached && r.usage?.outputTokens !== undefined
        ? { "X-Provider-Output-Tokens": String(r.usage.outputTokens) }
        : {}),
    };
    if (p.format === "json" || p.debug)
      return Response.json(
        {
          audio: bytesToB64(r.audio),
          mime: r.mime,
          text: r.text,
          lang: r.lang,
          provider: r.provider,
          usage: r.usage,
          ...(p.debug ? { debug: {
            requested_provider: p.provider,
            requested_providers: p.providers ?? [p.provider],
            provider: r.provider,
            response_time_ms: responseTimeMs,
            cached,
            audio_bytes: r.audio.length,
            mime: r.mime,
            lang: r.lang,
            usage: r.usage,
          } } : {}),
          ...(p.debug ? { server_log: serverLog() } : {}),
        },
        { headers: { ...CORS, ...extra } },
      );
    return new Response(r.audio as BodyInit, {
      headers: {
        ...CORS,
        ...extra,
        "Content-Type": r.mime,
        "X-Spoken-Text": encodeURIComponent(r.text.slice(0, 2000)),
        "X-Spoken-Lang": r.lang,
      },
    });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error(e);
    await record({
      at: new Date().toISOString(),
      ...base,
      userId,
      status,
      ms: Date.now() - t0,
      bytes: 0,
      cached: false,
      error: msg.slice(0, 200),
      inputChars: p.text.length,
      estimatedInputTokens: Math.ceil(p.text.length / 4),
    });
    return Response.json(
      { error: msg, ...(p.debug ? { debug: { requested_provider: p.provider, requested_providers: p.providers ?? [p.provider], response_time_ms: Date.now() - t0, status }, server_log: serverLog() } : {}) },
      { status, headers: CORS },
    );
  }
}

export const Route = createFileRoute("/api/public/tts")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        let userId: string | null = null;
        try {
          userId = await resolveApiUser(request);
        } catch (error) {
          const status = error instanceof UserAuthError ? error.status : 503;
          return Response.json(
            {
              error:
                status === 401 ? "Invalid personal API token" : "Could not authenticate request",
            },
            { status, headers: CORS },
          );
        }
        return handle(
          Object.fromEntries(new URL(request.url).searchParams),
          "GET",
          userId ?? undefined,
          request.headers.get("X-Provider-API-Key") ?? undefined,
          request,
        );
      },
      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          const raw = await readJsonBody(request);
          if (!isRequestObject(raw)) {
            return Response.json({ error: "JSON body must be an object" }, { status: 400, headers: CORS });
          }
          body = raw;
        } catch (error) {
          return Response.json({ error: error instanceof RequestBodyError ? error.message : "Invalid JSON body" }, { status: error instanceof RequestBodyError ? error.status : 400, headers: CORS });
        }
        let userId: string | null = null;
        try {
          userId = await resolveApiUser(request);
        } catch (error) {
          const status = error instanceof UserAuthError ? error.status : 503;
          return Response.json(
            {
              error:
                status === 401 ? "Invalid personal API token" : "Could not authenticate request",
            },
            { status, headers: CORS },
          );
        }
        return handle(
          { ...body, ...(new URL(request.url).searchParams.has("debug") ? { debug: new URL(request.url).searchParams.get("debug") } : {}) },
          "POST",
          userId ?? undefined,
          request.headers.get("X-Provider-API-Key") ?? undefined,
          request,
        );
      },
    },
  },
});
