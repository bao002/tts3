import { createFileRoute } from "@tanstack/react-router";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };

async function credits(key: string) {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const { data } = (await r.json()) as { data: { usage?: number; limit?: number | null; limit_remaining?: number | null; is_free_tier?: boolean } };
    return { usage: data.usage ?? null, limit: data.limit ?? null, remaining: data.limit_remaining ?? null, free_tier: data.is_free_tier ?? null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "failed" };
  }
}

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        const { startedAt } = await import('@/lib/tts.server');
        const { cacheInfo, history } = await import('@/lib/monitor.server');
        const { poolRows, publicKey, decryptKey, environmentKeys, hasSupabaseAdminConfig } =
          await import("@/lib/openrouter-pool.server");
        const up = Math.floor((Date.now() - startedAt) / 1000);
        const openrouter = hasSupabaseAdminConfig()
          ? await Promise.all(
              (await poolRows("openrouter")).map(async (k, i) => ({
                position: i,
                ...publicKey(k),
                credits: await credits(await decryptKey(k)),
              })),
            )
          : environmentKeys("openrouter").map((_, position) => ({
              position,
              status: "configured",
              source: "env",
            }));
        return Response.json(
          {
            status: "ok",
            started_at: new Date(startedAt).toISOString(),
            uptime_seconds: up,
            uptime: `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m ${up % 60}s`,
            lovable_api_key: process.env["LOVABLE_API_KEY"] ? "configured" : "missing",
            openrouter_keys: openrouter,
            cache: cacheInfo(),
            requests_recorded: history.length,
            supabase_configured: hasSupabaseAdminConfig(),
          },
          { headers: CORS },
        );
      },
    },
  },
});
