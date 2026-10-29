const keyedProviders = [
  "openrouter",
  "lovable",
  "gemini",
  "openai",
  "elevenlabs",
  "deepgram",
] as const;
const ttsProviders = [
  "auto",
  "google",
  "lovable",
  "openrouter",
  "gemini",
  "openai",
  "elevenlabs",
  "deepgram",
] as const;
const audioProviders = [
  "google",
  "lovable",
  "openrouter",
  "gemini",
  "openai",
  "elevenlabs",
  "deepgram",
] as const;

const params = {
  text: {
    type: "string",
    minLength: 1,
    maxLength: 5000,
    description: "Text to speak (trimmed; 1–5000 characters)",
  },
  lang: {
    type: "string",
    minLength: 2,
    maxLength: 20,
    description:
      "Source language as a YouTube-supported language code or BCP-47 tag (for example en, zh-Hant, es-419, or pt-BR). Language codes are passed through to the selected provider.",
    example: "en",
  },
  target_lang: {
    type: "string",
    maxLength: 20,
    description:
      "Optional YouTube-supported language code or BCP-47 tag. If set, text is translated before speaking.",
    example: "fr-CA",
  },
  provider: {
    type: "string",
    enum: ttsProviders,
    default: "google",
    description:
      "Auto randomly selects a configured provider key without recent auth/quota failures. Providers are Google, Lovable, OpenRouter, Gemini, OpenAI, ElevenLabs, and Deepgram.",
  },
  api_key: {
    type: "string",
    maxLength: 500,
    description:
      "API key for the selected keyed provider. This per-request key takes precedence over saved and server-configured keys and is not stored. Omit to use configured keys. Requires an explicit keyed provider (not auto or google). Personal API tokens must omit this field and use account-owned keys. Prefer POST or the X-Provider-API-Key header to avoid URL logging.",
  },
  voice: {
    type: "string",
    maxLength: 50,
    description:
      "Provider-specific voice. Gemini: prebuilt voice name (default Kore). OpenAI: voice name (default coral). ElevenLabs: voice ID (default JBFqnCBsd6RMkjVDRZzb). Deepgram: Aura model ID; defaults by lang for English, Spanish, German, Dutch, French, Italian, and Japanese, otherwise English. OpenRouter: provider-specific voice ID; Fish Audio chooses a licensed voice matching lang when available. Auto ignores this field.",
  },
  speed: {
    type: "number",
    minimum: 0.25,
    maximum: 4,
    default: 1,
    description:
      "Speech rate multiplier (0.25–4). Supported directly by Google, OpenAI, OpenRouter, and Deepgram; other providers may clamp or ignore it.",
  },
  options: {
    type: "object",
    additionalProperties: true,
    properties: {
      model: {
        type: "string",
        description:
          "Provider-specific model override. OpenRouter defaults to Fish Audio S2.1 Pro Free; OpenAI to gpt-4o-mini-tts; Gemini to gemini-2.5-flash-preview-tts; ElevenLabs to eleven_multilingual_v2; Deepgram to an Aura-2 voice selected by language.",
      },
      instructions: { type: "string", description: "Optional OpenAI speech style instructions." },
      voice_id: { type: "string", description: "Optional ElevenLabs voice ID override." },
      encoding: {
        type: "string",
        description: "Deepgram output encoding (for example mp3, linear16, or opus).",
      },
      container: {
        type: "string",
        description: "Deepgram output container (for example wav or ogg).",
      },
      sample_rate: {
        type: "integer",
        description: "Deepgram output sample rate, where supported by the encoding.",
      },
      bit_rate: {
        type: "integer",
        description: "Deepgram output bit rate, where supported by the encoding.",
      },
      mip_opt_out: {
        type: "boolean",
        description: "Deepgram Model Improvement Program opt-out setting.",
      },
    },
    description: "Provider-specific settings. For GET requests, pass as a URL-encoded JSON string.",
  },
  format: { type: "string", enum: ["binary", "json"], default: "binary", description: "binary = raw audio file, json = base64 audio" },
} as const;

const audioSuccessResponse = {
  description: "Encoded audio, or a JSON object when format=json. Auto selects a keyed provider without recent auth/quota failures; Google is not included because it does not use API keys.",
  headers: {
    "X-Response-Time-Ms": {
      schema: { type: "integer" },
      description: "Server-side request duration in milliseconds.",
    },
    "X-Provider": {
      schema: {
        type: "string",
        enum: audioProviders,
      },
      description: "Provider that generated the audio, including the provider selected by Auto.",
    },
    "X-Provider-Input-Tokens": {
      schema: { type: "integer" },
      description: "Provider-reported input token count, when available.",
    },
    "X-Provider-Output-Tokens": {
      schema: { type: "integer" },
      description: "Provider-reported output token count, when available.",
    },
  },
  content: {
    "audio/mpeg": { schema: { type: "string", format: "binary" } },
    "audio/wav": { schema: { type: "string", format: "binary" } },
    "audio/*": { schema: { type: "string", format: "binary" } },
    "application/json": {
      schema: {
        type: "object",
        properties: {
          audio: { type: "string", contentEncoding: "base64" },
          mime: { type: "string" },
          text: { type: "string" },
          lang: { type: "string" },
          provider: { type: "string" },
          usage: {
            type: "object",
            properties: { inputTokens: { type: "integer" }, outputTokens: { type: "integer" } },
          },
        },
      },
    },
  },
};

const usageMetricsSchema = {
  type: "object",
  properties: {
    requests: { type: "integer" },
    successful: { type: "integer" },
    failed: { type: "integer" },
    cached: { type: "integer" },
    audio_bytes: { type: "integer" },
    input_chars: { type: "integer" },
    output_chars: { type: "integer" },
    estimated_input_tokens: { type: "integer" },
    provider_input_tokens: { type: "integer", description: "Provider-reported total; zero when unavailable." },
    provider_output_tokens: { type: "integer", description: "Provider-reported total; zero when unavailable." },
    avg_duration_ms: { type: "integer" },
  },
};

const usageReportSchema = {
  type: "object",
  properties: {
    window_hours: { type: "integer" },
    totals: usageMetricsSchema,
    services: {
      type: "array",
      items: {
        type: "object",
        properties: { service: { type: "string" }, ...usageMetricsSchema.properties },
      },
    },
  },
};

export const openApiSpec = {
  openapi: "3.1.0",
  info: { title: "Speak API", version: "1.0.0", description: "Text-to-speech with optional translation. CORS enabled." },
  servers: [{ url: "https://tts2.lovable.app", description: "Speak API production server" }],
  paths: {
    "/api/public/tts": {
      get: {
        operationId: "synthesizeSpeechFromQuery",
        summary: "Synthesize speech (query params)",
        security: [{ personalApiTokenAuth: [] }, {}],
        parameters: [
          ...Object.entries(params).map(([name, schema]) => ({
            name,
            in: "query",
            required: name === "text" || name === "lang",
            schema:
              name === "options"
                ? {
                    type: "string",
                    maxLength: 2000,
                    description: "URL-encoded JSON object of provider options.",
                  }
                : schema,
          })),
          {
            name: "X-Provider-API-Key",
            in: "header",
            required: false,
            description:
              "Per-request provider key; overrides saved and server-configured keys. Use with a specific keyed provider, not Auto or Google. Header takes precedence over api_key.",
            schema: { type: "string", maxLength: 500 },
          },
        ],
        responses: {
          "200": audioSuccessResponse,
          "400": {
            description: "Invalid input or no configured provider key is available",
            content: {
              "application/json": { schema: { type: "object", properties: { error: {} } } },
            },
          },
          "502": {
            description:
              "Provider request failed after key attempts. The error explains whether the provider rejected the key, reported a quota/billing issue, rejected request settings, or had a temporary outage; a 5xx response does not by itself mean the key is invalid.",
          },
          "503": { description: "Provider key storage or routing is unavailable" },
        },
      },
      post: {
        operationId: "synthesizeSpeech",
        summary: "Synthesize speech (JSON body)",
        security: [{ personalApiTokenAuth: [] }, {}],
        parameters: [
          {
            name: "X-Provider-API-Key",
            in: "header",
            required: false,
            description:
              "Per-request provider key; overrides saved and server-configured keys. Use with a specific keyed provider, not Auto or Google. Header takes precedence over api_key.",
            schema: { type: "string", maxLength: 500 },
          },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["text", "lang"], properties: params } } },
        },
        responses: {
          "200": audioSuccessResponse,
          "400": { description: "Invalid input or no configured provider key is available" },
          "502": {
            description:
              "Provider request failed after key attempts. The error explains whether the provider rejected the key, reported a quota/billing issue, rejected request settings, or had a temporary outage; a 5xx response does not by itself mean the key is invalid.",
          },
          "503": { description: "Provider key storage or routing is unavailable" },
        },
      },
    },
    "/api/public/openapi.json": {
      get: {
        operationId: "getOpenApiDocument",
        summary: "Get the canonical OpenAPI document",
        security: [],
        responses: {
          "200": {
            description: "Current Speak API contract in OpenAPI 3.1 JSON format.",
            headers: {
              "Access-Control-Allow-Origin": {
                schema: { type: "string", const: "*" },
                description: "Allows browser clients to fetch the public API contract.",
              },
            },
            content: {
              "application/json": {
                schema: { type: "object", description: "The canonical OpenAPI 3.1 document." },
              },
            },
          },
          "500": { description: "Could not generate the OpenAPI document" },
        },
      },
    },
    "/api/public/info": {
      get: {
        operationId: "getPublicServiceInfo",
        summary: "Get API capabilities and provider availability",
        description:
          "Returns non-secret service status, provider availability, persistence mode, and features that require Supabase.",
        security: [],
        responses: {
          "200": {
            description: "Public API capabilities and configuration status.",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/api/public/access-token": {
      post: {
        operationId: "createTemporaryAccessToken",
        summary: "Create a temporary access token without an account",
        description:
          "Provide your own provider keys to receive an opaque bearer token. Keys stay in server memory, are never returned, and are lost when the process restarts. Tokens expire after 24 hours.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["provider_keys"],
                properties: {
                  provider_keys: {
                    type: "object",
                    minProperties: 1,
                    additionalProperties: {
                      type: "array",
                      minItems: 1,
                      maxItems: 10,
                      items: { type: "string", minLength: 1, maxLength: 500 },
                    },
                    description:
                      "Map keyed provider names to arrays of API keys. At most 50 keys total.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Temporary bearer token, returned once. Store it securely.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["token", "expires_at", "providers"],
                  properties: {
                    token: { type: "string" },
                    token_type: { type: "string", const: "Bearer" },
                    expires_at: { type: "string", format: "date-time" },
                    expires_in: { type: "integer", const: 86400 },
                    providers: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          service: { type: "string", enum: keyedProviders },
                          key_count: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Provider key list is missing or invalid" },
          "413": { description: "Request body is too large" },
          "429": { description: "In-memory token capacity has been reached" },
        },
      },
      delete: {
        operationId: "revokeTemporaryAccessToken",
        summary: "Revoke the current temporary access token",
        security: [{ personalApiTokenAuth: [] }],
        responses: {
          "200": { description: "Temporary token revoked" },
          "401": { description: "Missing, invalid, or expired temporary token" },
        },
      },
    },
    "/api/public/openrouter-keys": {
      get: {
        operationId: "listSharedProviderKeys",
        summary: "List shared provider key metadata",
        description:
          "Requires a management bearer token or configured server provider key. Secrets, ciphertext, and fingerprints are never returned.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "service",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: keyedProviders,
              default: "openrouter",
            },
          },
        ],
        responses: {
          "200": {
            description: "Shared provider keys and their health state.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    service: { type: "string" },
                    keys: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string", format: "uuid" },
                          service: { type: "string" },
                          key: { type: "string", const: "Configured key" },
                          source: { type: "string" },
                          status: { type: "string" },
                          code: { type: ["integer", "null"] },
                          failures: { type: "integer" },
                          lastUsed: { type: "integer" },
                          quarantinedUntil: { type: "integer" },
                        },
                      },
                    },
                    quarantine_after: { type: "integer" },
                    quarantine_minutes: { type: "integer" },
                  },
                },
              },
            },
          },
          "400": { description: "Unsupported provider service" },
          "401": { description: "Management authorization required" },
          "503": { description: "Saved provider key management requires Supabase" },
        },
      },
      post: {
        operationId: "updateSharedProviderKeys",
        summary: "Add a shared provider key or reset its health",
        description:
          "Requires a management bearer token or configured server provider key. A key is encrypted before storage; use `reset` with a key row ID to reset its health instead.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                anyOf: [{ required: ["key"] }, { required: ["reset"] }],
                properties: {
                  service: {
                    type: "string",
                    enum: keyedProviders,
                  },
                  key: { type: "string", maxLength: 500 },
                  reset: {
                    type: "string",
                    format: "uuid",
                    description: "Shared key row ID whose failure state should be reset.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated key list and health state" },
          "400": { description: "Unsupported service or invalid/missing key" },
          "401": { description: "Management authorization required" },
          "404": { description: "Key to reset was not found" },
          "409": { description: "Key already exists" },
          "503": { description: "Saved provider key management requires Supabase" },
        },
      },
      delete: {
        operationId: "deleteSharedProviderKey",
        summary: "Delete a saved shared provider key",
        description:
          "Requires a management bearer token or configured server provider key. Keys managed through environment variables cannot be deleted here.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "query",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "service",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: keyedProviders,
              default: "openrouter",
            },
          },
        ],
        responses: {
          "200": { description: "Updated key list and health state" },
          "400": { description: "Key not found or managed in server secrets" },
          "401": { description: "Management authorization required" },
          "503": { description: "Saved provider key management requires Supabase" },
        },
      },
    },
    "/api/public/usage": {
      get: {
        operationId: "getProviderUsageReportLegacy",
        summary: "Get provider usage statistics",
        description:
          "Legacy alias of /api/report/usage. Returns JSON aggregates by actual provider. Temporary tokens receive their own process-memory usage; personal API tokens and Supabase sessions receive their own persisted usage; management credentials receive global usage.",
        security: [{ personalApiTokenAuth: [] }, { supabaseSessionAuth: [] }, { bearerAuth: [] }],
        parameters: [
          {
            name: "hours",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 720, default: 24 },
          },
        ],
        responses: {
          "200": {
            description:
              "Request, audio, character, estimated-token, reported-token, and latency totals grouped by actual provider.",
            content: { "application/json": { schema: usageReportSchema } },
          },
          "401": { description: "Management authorization required" },
          "503": { description: "Usage report unavailable" },
        },
      },
    },
    "/api/report/usage": {
      get: {
        operationId: "getProviderUsageReport",
        summary: "Get provider usage report",
        description:
          "Returns usage aggregates grouped by the actual provider. Temporary tokens receive their own process-memory usage; personal API tokens and Supabase sessions receive their own persisted usage; management credentials receive global usage. Playable audio history is stored in the user's browser and is not included.",
        security: [{ personalApiTokenAuth: [] }, { supabaseSessionAuth: [] }, { bearerAuth: [] }],
        parameters: [
          {
            name: "hours",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 720, default: 24 },
          },
        ],
        responses: {
          "200": { description: "Request, audio, character, estimated-token, reported-token, and latency totals grouped by actual provider.", content: { "application/json": { schema: usageReportSchema } } },
          "401": { description: "Management authorization required" },
          "503": { description: "Usage report unavailable" },
        },
      },
    },
    "/api/user/token": {
      get: {
        operationId: "listPersonalApiTokens",
        summary: "List personal API tokens",
        security: [{ supabaseSessionAuth: [] }],
        responses: {
          "200": { description: "Token metadata only; token secrets are never returned by this operation.", content: { "application/json": { schema: { type: "object", properties: { tokens: { type: "array", items: { type: "object", properties: { id: { type: "string", format: "uuid" }, label: { type: "string" }, created_at: { type: "string", format: "date-time" }, last_used: { type: ["string", "null"], format: "date-time" }, revoked_at: { type: ["string", "null"], format: "date-time" } } } } } } } } },
          "401": { description: "Valid Supabase session required" },
        },
      },
      post: {
        operationId: "createPersonalApiToken",
        summary: "Create a personal API token",
        description: "Requires a Supabase session. The personal token secret is returned once and cannot be retrieved later; only its hash is stored.",
        security: [{ supabaseSessionAuth: [] }],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { label: { type: "string", maxLength: 80, default: "External agent" } },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "New token. Store the token value securely; it is shown only once.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["id", "token"],
                  properties: {
                    id: { type: "string", format: "uuid" },
                    token: { type: "string", description: "Personal bearer secret; shown once." },
                  },
                },
              },
            },
          },
          "401": { description: "Valid Supabase session required" },
        },
      },
      delete: {
        operationId: "revokePersonalApiToken",
        summary: "Revoke a personal API token",
        security: [{ supabaseSessionAuth: [] }],
        parameters: [
          { name: "id", in: "query", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Token revoked" },
          "404": { description: "Token not found for this user" },
          "401": { description: "Valid Supabase session required" },
        },
      },
    },
    "/api/user/provider-keys": {
      get: {
        operationId: "listPersonalProviderKeys",
        summary: "List personal provider keys",
        security: [{ supabaseSessionAuth: [] }],
        responses: {
          "200": {
            description:
              "Owner-scoped key metadata. Provider secrets and ciphertext are never returned.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    services: {
                      type: "array",
                      items: {
                        type: "string",
                        enum: keyedProviders,
                      },
                    },
                    keys: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string", format: "uuid" },
                          service: { type: "string" },
                          key_suffix: {
                            type: "string",
                            description:
                              "Last four characters of the saved key; the secret is never returned.",
                          },
                          status: { type: "string" },
                          failures: { type: "integer" },
                          code: { type: ["integer", "null"] },
                          created_at: { type: "string", format: "date-time" },
                          last_used: { type: ["string", "null"], format: "date-time" },
                        },
                      },
                    },
                    history: {
                      type: "array",
                      description:
                        "Up to 200 recent provider key request and test outcomes. Events are recorded from the migration onward; provider response bodies and credentials are never stored.",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "integer" },
                          key_id: { type: "string", format: "uuid" },
                          occurred_at: { type: "string", format: "date-time" },
                          action: { type: "string", enum: ["request", "test"] },
                          response_code: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Valid Supabase session required" },
        },
      },
      post: {
        operationId: "savePersonalProviderKey",
        summary: "Save a personal provider key",
        security: [{ supabaseSessionAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                anyOf: [{ required: ["service", "key"] }, { required: ["test", "id"] }],
                properties: {
                  service: {
                    type: "string",
                    enum: keyedProviders,
                  },
                  key: { type: "string", maxLength: 500 },
                  test: {
                    type: "boolean",
                    const: true,
                    description:
                      "Test a saved provider key with a provider-specific non-billing authentication endpoint. OpenRouter may also return safe account/token status.",
                  },
                  id: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Provider key test result and, for OpenRouter, safe token/account status.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    test: {
                      type: "object",
                      properties: {
                        valid: { type: "boolean" },
                        service: { type: "string", enum: keyedProviders },
                        status: { type: "string" },
                        http_status: { type: "integer" },
                        account: { type: "object" },
                        message: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          "201": { description: "Provider key saved and encrypted" },
          "409": { description: "Key already saved for this account" },
          "401": { description: "Valid Supabase session required" },
        },
      },
      delete: {
        operationId: "removePersonalProviderKey",
        summary: "Remove a personal provider key",
        security: [{ supabaseSessionAuth: [] }],
        parameters: [{ name: "id", in: "query", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Provider key removed" }, "404": { description: "Key not found for this user" }, "401": { description: "Valid Supabase session required" } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "PROVIDER_MANAGEMENT_TOKEN or an authorized configured provider API key.",
      },
      supabaseSessionAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Supabase access token from the signed-in user's session. Required for account management endpoints.",
      },
      personalApiTokenAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "Personal API token created from a signed-in account, or temporary token created at /api/public/access-token. Temporary tokens contain no provider secrets, expire after 24 hours, and work only while the server process retains them. Usage reports are scoped to the token.",
      },
    },
  },
};
