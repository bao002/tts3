import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolState = vi.hoisted(() => ({
  error: null as Error | null,
  rows: [] as unknown[],
  marked: [] as Array<[string, number]>,
  userRows: [] as unknown[],
  userLookups: [] as string[],
  userMarked: [] as Array<[string, string, number]>,
  poolReads: 0,
  supabaseConfigured: true,
}));

vi.mock("@/lib/openrouter-pool.server", () => ({
  KEY_SERVICES: ["openrouter", "lovable", "gemini", "openai", "elevenlabs", "deepgram"],
  hasSupabaseAdminConfig: () => poolState.supabaseConfigured,
  environmentKeys: (service: string) => {
    const name = service.toUpperCase();
    return [
      ...new Set(
        [
          process.env[`${name}_API_KEY`] || "",
          ...(process.env[`${name}_API_KEYS`] || "").split(/[\s,]+/),
        ]
          .map((key) => key.trim())
          .filter(Boolean),
      ),
    ];
  },
  poolRows: async () => {
    poolState.poolReads++;
    if (poolState.error) throw poolState.error;
    return poolState.rows;
  },
  userKeyRows: async (userId: string) => {
    poolState.userLookups.push(userId);
    return poolState.userRows;
  },
  reserveUserKey: async (_userId: string, _service: string, excluded: string[] = []) =>
    poolState.userRows.find((value) => !excluded.includes((value as { id: string }).id)) ?? null,
  reserveAnyUserKey: async (_userId: string, excluded: string[] = []) =>
    poolState.userRows.find((value) => !excluded.includes((value as { id: string }).id)) ?? null,
  markUserKey: async (userId: string, id: string, status: number) => {
    poolState.userMarked.push([userId, id, status]);
  },
  reserveAnyKey: async (excluded: string[] = []) =>
    poolState.rows.find((value) => !excluded.includes((value as { id: string }).id)) ?? null,
  decryptKey: async (row: { ciphertext: string }) => row.ciphertext,
  markKey: async (id: string, status: number) => {
    poolState.marked.push([id, status]);
  },
  reserveKey: vi.fn(),
}));

import { synthesize } from "@/lib/tts.server";
import { createMemoryAccessToken } from "@/lib/memory-api-tokens.server";

beforeEach(() => {
  for (const service of ["OPENROUTER", "LOVABLE", "GEMINI", "OPENAI", "ELEVENLABS", "DEEPGRAM"]) {
    vi.stubEnv(`${service}_API_KEY`, "");
    vi.stubEnv(`${service}_API_KEYS`, "");
  }
  poolState.error = null;
  poolState.rows = [];
  poolState.marked = [];
  poolState.userRows = [];
  poolState.userLookups = [];
  poolState.userMarked = [];
  poolState.poolReads = 0;
  poolState.supabaseConfigured = true;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("provider API key errors", () => {
  it("uses a temporary token's own provider keys and retries quota failures", async () => {
    const created = await createMemoryAccessToken({ openai: ["temporary-key-a", "temporary-key-b"] });
    const authorizationHeaders: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("Authorization") ?? "";
      authorizationHeaders.push(authorization);
      if (authorization.endsWith("temporary-key-a")) {
        return Response.json({ error: "rate limit" }, { status: 429 });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "audio/mpeg" },
      });
    });
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesize({
      text: "Temporary account",
      lang: "en",
      provider: "openai",
      userId: `memory:${created.id}`,
    });

    expect(result).toMatchObject({ provider: "openai", mime: "audio/mpeg" });
    expect(authorizationHeaders).toEqual([
      "Bearer temporary-key-a",
      "Bearer temporary-key-b",
    ]);
    expect(poolState.poolReads).toBe(0);
    expect(poolState.userLookups).toEqual([]);
  });

  it("uses only the temporary token's keys for Auto routing", async () => {
    const created = await createMemoryAccessToken({ gemini: ["temporary-gemini-key"] });
    const encodedPcm = btoa(String.fromCharCode(0, 0, 1, 0));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("temporary-gemini-key");
      return Response.json({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: encodedPcm, mimeType: "audio/pcm;rate=24000" } }],
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesize({
      text: "Temporary Auto request",
      lang: "en",
      provider: "auto",
      userId: `memory:${created.id}`,
    });

    expect(result.provider).toBe("gemini");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(poolState.poolReads).toBe(0);
    expect(poolState.userLookups).toEqual([]);
  });

  it("explains that OpenRouter needs a key when saved keys cannot be loaded", async () => {
    poolState.error = new Error("Could not load OpenRouter keys from Supabase");

    await expect(
      synthesize({
        text: "Ciao, come stai?",
        lang: "it",
        provider: "openrouter",
      }),
    ).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining("OpenRouter requires an API key"),
    });
    await expect(
      synthesize({
        text: "Ciao, come stai?",
        lang: "it",
        provider: "openrouter",
      }),
    ).rejects.not.toThrow("Supabase");
  });

  it("explains how to configure a key when no key is available", async () => {
    await expect(
      synthesize({
        text: "Ciao, come stai?",
        lang: "it",
        provider: "openrouter",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("OPENROUTER_API_KEY"),
    });
  });

  it("calls OpenAI TTS with the configured key and returns MP3 audio", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesize({
      text: "Bonjour",
      lang: "fr",
      provider: "openai",
      apiKey: "openai-test",
    });

    expect(result).toMatchObject({ provider: "openai", mime: "audio/mpeg" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/speech",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer openai-test" }),
      }),
    );
  });

  it("uses a supplied key instead of Supabase-saved keys", async () => {
    poolState.supabaseConfigured = true;
    const authorizationHeaders: Array<string | null> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      authorizationHeaders.push(new Headers(init?.headers).get("Authorization"));
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesize({
      text: "Bonjour",
      lang: "fr",
      provider: "openai",
      apiKey: "one-request-key",
    });

    expect(result.provider).toBe("openai");
    expect(authorizationHeaders).toEqual(["Bearer one-request-key"]);
    expect(poolState.poolReads).toBe(0);
  });

  it("rejects an API key with Auto instead of silently ignoring it", async () => {
    await expect(
      synthesize({ text: "Hello", lang: "en", provider: "auto", apiKey: "one-request-key" }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("specific keyed provider"),
    });
    expect(poolState.poolReads).toBe(0);
  });

  it("uses server-configured provider keys without connecting to Supabase", async () => {
    poolState.supabaseConfigured = false;
    vi.stubEnv("OPENAI_API_KEY", "server-openai-key");
    const authorizationHeaders: Array<string | null> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      authorizationHeaders.push(new Headers(init?.headers).get("Authorization"));
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesize({ text: "Bonjour", lang: "fr", provider: "openai" });

    expect(result).toMatchObject({ provider: "openai", mime: "audio/mpeg" });
    expect(authorizationHeaders[0]?.startsWith("Bearer ")).toBe(true);
    expect(poolState.poolReads).toBe(0);
  });

  it("does not use shared environment keys for personal-token requests without Supabase", async () => {
    poolState.supabaseConfigured = false;
    vi.stubEnv("OPENAI_API_KEY", "server-openai-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      synthesize({
        text: "Private request",
        lang: "en",
        provider: "openai",
        userId: "owner-a",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("keys saved to that account"),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(poolState.userLookups).toEqual(["owner-a"]);
  });

  it("fails over across environment keys in Auto mode without Supabase", async () => {
    poolState.supabaseConfigured = false;
    vi.stubEnv("OPENAI_API_KEY", "server-openai-key");
    vi.stubEnv("GEMINI_API_KEY", "server-gemini-key");
    vi.spyOn(Math, "random").mockReturnValue(0);
    const encodedPcm = btoa(String.fromCharCode(0, 0, 1, 0));
    const geminiApiKeys: Array<string | null> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("api.openai.com")) {
        return Response.json({ error: "rate limit" }, { status: 429 });
      }
      geminiApiKeys.push(new Headers(init?.headers).get("x-goog-api-key"));
      return Response.json({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: encodedPcm, mimeType: "audio/pcm;rate=24000" } }],
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesize({ text: "Ciao", lang: "it", provider: "auto" });

    expect(result.provider).toBe("gemini");
    expect(geminiApiKeys[0]).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(poolState.poolReads).toBe(0);
    expect(poolState.marked).toEqual([]);
  });

  it("calls ElevenLabs with a voice ID and returns MP3 audio", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesize({
      text: "Ciao",
      lang: "it",
      provider: "elevenlabs",
      apiKey: "eleven-test",
      voice: "voice-id",
    });

    expect(result.provider).toBe("elevenlabs");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/text-to-speech/voice-id?");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "xi-api-key": "eleven-test" });
  });

  it("calls Deepgram with a language-matched Aura model and supports output options", async () => {
    poolState.supabaseConfigured = false;
    vi.stubEnv("DEEPGRAM_API_KEY", "deepgram-test");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/wav" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesize({
      text: "Bonjour",
      lang: "fr-CA",
      provider: "deepgram",
      speed: 1.25,
      options: { encoding: "linear16", container: "wav", sample_rate: 24000 },
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    const parsedUrl = new URL(String(url));
    expect(result).toMatchObject({ provider: "deepgram", mime: "audio/wav" });
    expect(parsedUrl.origin + parsedUrl.pathname).toBe("https://api.deepgram.com/v1/speak");
    expect(parsedUrl.searchParams.get("model")).toBe("aura-2-agathe-fr");
    expect(parsedUrl.searchParams.get("speed")).toBe("1.25");
    expect(parsedUrl.searchParams.get("encoding")).toBe("linear16");
    expect(parsedUrl.searchParams.get("container")).toBe("wav");
    expect(parsedUrl.searchParams.get("sample_rate")).toBe("24000");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Token deepgram-test");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "Bonjour" });
    expect(poolState.poolReads).toBe(0);
  });

  it("includes Deepgram in Auto routing for environment-configured keys", async () => {
    poolState.supabaseConfigured = false;
    vi.stubEnv("DEEPGRAM_API_KEY", "deepgram-test");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesize({
      text: "Hello",
      lang: "en",
      provider: "auto",
    });

    expect(result.provider).toBe("deepgram");
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
      "Token deepgram-test",
    );
    expect(poolState.poolReads).toBe(0);
  });

  it("wraps Gemini PCM as WAV and reports provider token usage", async () => {
    const encodedPcm = btoa(String.fromCharCode(0, 0, 1, 0));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: encodedPcm, mimeType: "audio/pcm;rate=24000" } }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesize({
      text: "Hola",
      lang: "es",
      provider: "gemini",
      apiKey: "gemini-test",
    });

    expect(result).toMatchObject({
      provider: "gemini",
      mime: "audio/wav",
      usage: { inputTokens: 3, outputTokens: 4 },
    });
    expect(result.audio.byteLength).toBe(48);
  });

  it("fails over from a rate-limited provider to another healthy key", async () => {
    poolState.rows = [
      { id: "openai-row", service: "openai", ciphertext: "openai-test" },
      { id: "gemini-row", service: "gemini", ciphertext: "gemini-test" },
    ];
    const encodedPcm = btoa(String.fromCharCode(0, 0, 1, 0));
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("api.openai.com")
        ? Response.json({ error: "rate limit" }, { status: 429 })
        : Response.json({
            candidates: [
              {
                content: {
                  parts: [{ inlineData: { data: encodedPcm, mimeType: "audio/pcm;rate=24000" } }],
                },
              },
            ],
          }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesize({ text: "Ciao", lang: "it", provider: "auto" });

    expect(result.provider).toBe("gemini");
    expect(poolState.marked).toEqual([
      ["openai-row", 429],
      ["gemini-row", 200],
    ]);
  });

  it("translates once before Auto routing without penalizing the selected provider", async () => {
    poolState.rows = [{ id: "openai-row", service: "openai", ciphertext: "openai-test" }];
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("translate.googleapis.com")
        ? Response.json([[["Hola"]]])
        : new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/mpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesize({
      text: "Hello",
      lang: "en",
      targetLang: "es",
      provider: "auto",
    });

    expect(result).toMatchObject({ provider: "openai", text: "Hola", lang: "es" });
    expect(poolState.marked).toEqual([["openai-row", 200]]);
  });

  it("does not fall back to shared keys for an account without its own provider key", async () => {
    poolState.rows = [{ id: "shared-key", service: "openrouter", ciphertext: "shared-secret" }];

    let rejection: unknown;
    try {
      await synthesize({
        text: "Private request",
        lang: "en",
        provider: "openrouter",
        userId: "owner-a",
      });
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toMatchObject({ status: 400 });
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain("keys saved to that account");
    expect(poolState.userLookups).toEqual(["owner-a"]);
    expect(poolState.poolReads).toBe(0);
  });

  it("uses the signed-in user's saved OpenRouter key for synthesis", async () => {
    poolState.userRows = [
      {
        id: "owner-openrouter",
        service: "openrouter",
        ciphertext: "owner-openrouter-secret",
      },
    ];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer owner-openrouter-secret",
      );
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "audio/mpeg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesize({
      text: "Hello",
      lang: "en",
      provider: "openrouter",
      userId: "owner-a",
    });

    expect(result).toMatchObject({ provider: "openrouter", mime: "audio/mpeg" });
    expect(poolState.userLookups).toEqual(["owner-a"]);
    expect(poolState.userMarked).toEqual([["owner-a", "owner-openrouter", 200]]);
    expect(poolState.poolReads).toBe(0);
  });

  it("explains OpenAI 503 failures without exposing saved API keys", async () => {
    const secret = "openai-saved-secret";
    poolState.userRows = [{ id: "owner-openai", service: "openai", ciphertext: secret }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message: `Service unavailable for key ${secret}` } },
          { status: 503 },
        ),
      ),
    );

    let rejection: unknown;
    try {
      await synthesize({
        text: "Ciao",
        lang: "it",
        provider: "openai",
        userId: "owner-a",
      });
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toMatchObject({
      status: 502,
      message: expect.stringContaining(
        "OpenAI is temporarily unavailable. This does not by itself mean the API key is invalid",
      ),
    });
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain(
      "Provider detail: Service unavailable for key [redacted]",
    );
    expect((rejection as Error).message).not.toContain(secret);
    expect(poolState.userMarked).toEqual([["owner-a", "owner-openai", 503]]);
  });

  it("Auto uses and marks only keys belonging to the personal-token owner", async () => {
    poolState.rows = [{ id: "shared-key", service: "openai", ciphertext: "shared-secret" }];
    poolState.userRows = [{ id: "owner-gemini", service: "gemini", ciphertext: "owner-secret" }];
    const encodedPcm = btoa(String.fromCharCode(0, 0, 1, 0));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("owner-secret");
      return Response.json({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: encodedPcm, mimeType: "audio/pcm;rate=24000" } }],
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesize({
      text: "Private request",
      lang: "en",
      provider: "auto",
      userId: "owner-a",
    });

    expect(result.provider).toBe("gemini");
    expect(poolState.poolReads).toBe(0);
    expect(poolState.userMarked).toEqual([["owner-a", "owner-gemini", 200]]);
  });
});
