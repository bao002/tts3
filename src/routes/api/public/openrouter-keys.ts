import { createFileRoute } from "@tanstack/react-router";
import type { KeyService } from "@/lib/openrouter-pool.server";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "*" };
async function handle(request: Request) {
  const pool = await import('@/lib/openrouter-pool.server');
  if (!await pool.authorizeManagement(request)) return Response.json({ error: 'Enter your management token or a configured server provider key' }, { status: 401, headers: CORS });
  if (!pool.hasSupabaseAdminConfig()) {
    return Response.json(
      {
        error:
          "Saved provider key management requires Supabase; configure provider keys through server environment variables instead.",
      },
      { status: 503, headers: CORS },
    );
  }
  try {
    const url = new URL(request.url);
    const requestedService = request.method === 'DELETE' ? url.searchParams.get('service') : undefined;
    let service: KeyService = (requestedService || url.searchParams.get('service') || 'openrouter') as KeyService;
    if (!pool.KEY_SERVICES.includes(service)) return Response.json({ error: 'Unsupported service' }, { status: 400, headers: CORS });
    if (request.method === 'POST') {
      const body = await request.json() as { key?: unknown; reset?: unknown; service?: unknown };
      if (body.service !== undefined) {
        if (typeof body.service !== 'string' || !pool.KEY_SERVICES.includes(body.service as KeyService)) return Response.json({ error: 'Unsupported service' }, { status: 400, headers: CORS });
        service = body.service as KeyService;
      }
      if (typeof body.reset === 'string') {
        if (!await pool.resetKey(body.reset, service)) return Response.json({ error: 'Key not found' }, { status: 404, headers: CORS });
      } else {
        if (typeof body.key !== 'string' || !body.key.trim() || body.key.length > 500) return Response.json({ error: 'key is required' }, { status: 400, headers: CORS });
        if (!await pool.addKey(service, body.key)) return Response.json({ error: 'Key already exists' }, { status: 409, headers: CORS });
      }
    }
    if (!pool.KEY_SERVICES.includes(service)) return Response.json({ error: 'Unsupported service' }, { status: 400, headers: CORS });
    if (request.method === 'DELETE' && !await pool.removeKey(url.searchParams.get('id') || '', service)) return Response.json({ error: 'Key not found or managed in server secrets' }, { status: 400, headers: CORS });
    return Response.json({ service, keys: await pool.listKeys(service), quarantine_after: pool.QUARANTINE_AFTER, quarantine_minutes: pool.QUARANTINE_MS / 60000 }, { headers: { ...CORS, 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Could not update saved keys' }, { status: 500, headers: CORS });
  }
}

export const Route = createFileRoute("/api/public/openrouter-keys")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
      DELETE: async ({ request }) => handle(request),
    },
  },
});
