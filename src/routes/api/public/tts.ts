import { createFileRoute } from "@tanstack/react-router";
import { handle, CORS } from "@/lib/tts-handler.server";
import { isRequestObject } from "@/lib/request-safety";
import { readJsonBody, RequestBodyError } from "@/lib/request-body";
import { resolveApiUser, UserAuthError } from "@/lib/user-account.server";

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
