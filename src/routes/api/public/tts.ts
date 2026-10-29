import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { synthesize, HttpError, bytesToB64 } from "@/lib/tts.server";
import { record, cacheGet, cacheSet } from "@/lib/monitor.server";
import { resolveApiUser, UserAuthError } from "@/lib/user-account.server";

const CORS = {
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
  api_key: z.string().max(500).optional().or(z.literal("")),
  voice: z.string().max(50).optional().or(z.literal("")),
  speed: z.coerce.number().min(0.25).max(4).optional(),
  options: optionsSchema,
  format: z.enum(["binary", "json"]).default("binary"),
});

async function handle(
  raw: Record<string, unknown>,
  method: string,
  userId?: string,
  headerApiKey?: string,
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
  if (p.api_key && (p.provider === "auto" || p.provider === "google")) {
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
    p.lang,
    p.target_lang || "",
    p.voice || "",
    p.speed ?? "",
    p.options ?? null,
    p.text,
  ]);
  try {
    let r = p.provider === "auto" || userId || p.api_key ? undefined : cacheGet(key);
    const cached = !!r;
    if (!r) {
      r = await synthesize({
        text: p.text,
        lang: p.lang,
        targetLang: p.target_lang || undefined,
        provider: p.provider,
        userId,
        apiKey: p.api_key || undefined,
        voice: p.voice || undefined,
        speed: p.speed,
        options: p.options,
      });
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
    if (p.format === "json")
      return Response.json(
        {
          audio: bytesToB64(r.audio),
          mime: r.mime,
          text: r.text,
          lang: r.lang,
          provider: r.provider,
          usage: r.usage,
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
    return Response.json({ error: msg }, { status, headers: CORS });
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
        );
      },
      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
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
          body,
          "POST",
          userId ?? undefined,
          request.headers.get("X-Provider-API-Key") ?? undefined,
        );
      },
    },
  },
});
