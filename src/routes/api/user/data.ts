import { createFileRoute } from "@tanstack/react-router";
import {
  addUserKey,
  decryptKey,
  hasSupabaseAdminConfig,
  KEY_SERVICES,
  userKeyRows,
  type KeyService,
} from "@/lib/openrouter-pool.server";
import { listUserApiTokens, requireSupabaseUser, UserAuthError } from "@/lib/user-account.server";
import { isRequestObject } from "@/lib/request-safety";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};
const NO_STORE = { ...CORS, "Cache-Control": "no-store" };

async function handle(request: Request) {
  if (!hasSupabaseAdminConfig()) {
    return Response.json({ error: "Account data requires Supabase." }, { status: 503, headers: CORS });
  }
  try {
    const userId = await requireSupabaseUser(request);
    if (request.method === "GET") {
      const rows = await userKeyRows(userId);
      const keys = await Promise.all(
        rows.map(async (row) => ({
          service: row.service,
          key: await decryptKey(row),
          created_at: row.created_at,
        })),
      );
      const tokens = (await listUserApiTokens(userId)).map((t: { label: string; created_at: string; revoked_at: string | null }) => ({
        label: t.label,
        created_at: t.created_at,
        revoked_at: t.revoked_at,
      }));
      return Response.json(
        { version: 1, exported_at: new Date().toISOString(), provider_keys: keys, api_tokens: tokens },
        { headers: NO_STORE },
      );
    }
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
    }
    if (!isRequestObject(raw) || !Array.isArray(raw.provider_keys)) {
      return Response.json({ error: "provider_keys array is required" }, { status: 400, headers: CORS });
    }
    if (raw.provider_keys.length > 200) {
      return Response.json({ error: "Too many keys (max 200)" }, { status: 400, headers: CORS });
    }
    let imported = 0, skipped = 0, invalid = 0;
    for (const item of raw.provider_keys as unknown[]) {
      if (
        !isRequestObject(item) ||
        typeof item.service !== "string" ||
        !KEY_SERVICES.includes(item.service as KeyService) ||
        typeof item.key !== "string" ||
        !item.key.trim() ||
        item.key.length > 500
      ) {
        invalid++;
        continue;
      }
      if (await addUserKey(userId, item.service as KeyService, item.key)) imported++;
      else skipped++;
    }
    return Response.json({ imported, skipped, invalid }, { headers: NO_STORE });
  } catch (error) {
    const status = error instanceof UserAuthError ? error.status : 500;
    return Response.json(
      { error: status === 401 ? "Authentication required" : "Could not process account data" },
      { status, headers: CORS },
    );
  }
}

export const Route = createFileRoute("/api/user/data")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
