import { createFileRoute } from "@tanstack/react-router";
import { createUserApiToken, listUserApiTokens, requireSupabaseUser, revokeUserApiToken, UserAuthError } from "@/lib/user-account.server";
import { hasSupabaseAdminConfig } from "@/lib/openrouter-pool.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

async function handle(request: Request) {
  if (!hasSupabaseAdminConfig()) {
    return Response.json(
      { error: "Personal API tokens require Supabase." },
      { status: 503, headers: CORS },
    );
  }
  try {
    const userId = await requireSupabaseUser(request);
    if (request.method === "GET") {
      return Response.json({ tokens: await listUserApiTokens(userId) }, { headers: { ...CORS, "Cache-Control": "no-store" } });
    }
    if (request.method === "POST") {
      let body: { label?: unknown } = {};
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
      }
      if (body.label !== undefined && typeof body.label !== "string") {
        return Response.json({ error: "label must be a string" }, { status: 400, headers: CORS });
      }
      return Response.json(await createUserApiToken(userId, body.label as string | undefined), { status: 201, headers: { ...CORS, "Cache-Control": "no-store" } });
    }
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!id || !await revokeUserApiToken(userId, id)) return Response.json({ error: "Token not found" }, { status: 404, headers: CORS });
    return Response.json({ revoked: true }, { headers: CORS });
  } catch (error) {
    const status = error instanceof UserAuthError ? error.status : 500;
    return Response.json({ error: status === 401 ? "Authentication required" : "Could not manage API token" }, { status, headers: CORS });
  }
}

export const Route = createFileRoute("/api/user/token")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
      DELETE: async ({ request }) => handle(request),
    },
  },
});
