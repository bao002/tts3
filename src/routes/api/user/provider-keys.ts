import { createFileRoute } from "@tanstack/react-router";
import {
  addUserKey,
  hasSupabaseAdminConfig,
  KEY_SERVICES,
  listUserProviderKeyEvents,
  listUserKeys,
  removeUserKey,
  testUserProviderKey,
  type KeyService,
} from "@/lib/openrouter-pool.server";
import { requireSupabaseUser, UserAuthError } from "@/lib/user-account.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

async function handle(request: Request) {
  if (!hasSupabaseAdminConfig()) {
    return Response.json(
      { error: "Account provider keys require Supabase." },
      { status: 503, headers: CORS },
    );
  }
  try {
    const userId = await requireSupabaseUser(request);
    if (request.method === "GET") {
      return Response.json(
        {
          services: KEY_SERVICES,
          keys: await listUserKeys(userId),
          history: await listUserProviderKeyEvents(userId),
        },
        { headers: { ...CORS, "Cache-Control": "no-store" } },
      );
    }
    if (request.method === "POST") {
      let body: { id?: unknown; service?: unknown; key?: unknown; test?: unknown };
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
      }
      if (body.test === true) {
        if (typeof body.id !== "string" || !body.id) {
          return Response.json(
            { error: "Provider key id is required" },
            { status: 400, headers: CORS },
          );
        }
        return Response.json(
          { test: await testUserProviderKey(userId, body.id) },
          {
            headers: { ...CORS, "Cache-Control": "no-store" },
          },
        );
      }
      if (typeof body.service !== "string" || !KEY_SERVICES.includes(body.service as KeyService)) {
        return Response.json({ error: "Unsupported provider" }, { status: 400, headers: CORS });
      }
      if (typeof body.key !== "string" || !body.key.trim() || body.key.length > 500) {
        return Response.json(
          { error: "A provider API key is required" },
          { status: 400, headers: CORS },
        );
      }
      if (!(await addUserKey(userId, body.service as KeyService, body.key))) {
        return Response.json(
          { error: "This key is already saved for your account" },
          { status: 409, headers: CORS },
        );
      }
      return Response.json({ saved: true }, { status: 201, headers: CORS });
    }
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!id || !(await removeUserKey(userId, id)))
      return Response.json({ error: "Provider key not found" }, { status: 404, headers: CORS });
    return Response.json({ removed: true }, { headers: CORS });
  } catch (error) {
    const status = error instanceof UserAuthError ? error.status : 500;
    return Response.json(
      { error: status === 401 ? "Authentication required" : "Could not manage provider key" },
      { status, headers: CORS },
    );
  }
}

export const Route = createFileRoute("/api/user/provider-keys")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
      DELETE: async ({ request }) => handle(request),
    },
  },
});
