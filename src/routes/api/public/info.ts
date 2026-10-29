import { createFileRoute } from "@tanstack/react-router";
import { environmentKeys, hasSupabaseAdminConfig, KEY_SERVICES } from "@/lib/openrouter-pool.server";
import { memoryTokenCount } from "@/lib/memory-api-tokens.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export const Route = createFileRoute("/api/public/info")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        const supabaseConfigured = hasSupabaseAdminConfig();
        return Response.json(
          {
            status: "ok",
            app: "Speak API",
            storage: supabaseConfigured ? "supabase" : "in-memory",
            available_providers: [
              { service: "google", credentials_required: false },
              ...KEY_SERVICES.map((service) => ({
                service,
                credentials_required: true,
                server_keys_configured: environmentKeys(service).length > 0,
              })),
            ],
            api_capabilities: {
              speech: true,
              openapi: true,
              temporary_provider_key_tokens: true,
              in_memory_history: true,
              in_memory_usage_reports: true,
              registration: supabaseConfigured,
              saved_provider_keys: supabaseConfigured,
              persistent_usage_reports: supabaseConfigured,
            },
            temporary_tokens: {
              active: memoryTokenCount(),
              expires_after_seconds: 86_400,
              lost_on_server_restart: true,
            },
            database_required_for: supabaseConfigured
              ? []
              : ["account sign-in", "saved provider keys", "personal account tokens", "persistent usage reports"],
          },
          { headers: { ...CORS, "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
