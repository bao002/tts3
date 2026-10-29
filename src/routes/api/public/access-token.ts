import { createFileRoute } from "@tanstack/react-router";
import {
  createMemoryAccessToken,
  MEMORY_ACCESS_TOKEN_TTL_SECONDS,
  revokeMemoryAccessToken,
  validateMemoryProviderKeys,
} from "@/lib/memory-api-tokens.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const privateHeaders = { ...CORS, "Cache-Control": "no-store" };

async function create(request: Request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 65_536) {
    return Response.json({ error: "Request body is too large." }, { status: 413, headers: CORS });
  }

  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) {
      return Response.json({ error: "Invalid JSON body." }, { status: 400, headers: CORS });
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) {
        await reader.cancel();
        return Response.json({ error: "Request body is too large." }, { status: 413, headers: CORS });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder().decode(bytes);
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400, headers: CORS });
  }

  const providerKeys =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? validateMemoryProviderKeys(Reflect.get(body, "provider_keys"))
      : null;
  if (!providerKeys) {
    return Response.json(
      {
        error:
          "provider_keys must map one or more supported providers to arrays of 1–10 non-empty API keys (50 keys total maximum).",
      },
      { status: 400, headers: CORS },
    );
  }

  try {
    const accessToken = await createMemoryAccessToken(providerKeys);
    return Response.json(
      {
        ...accessToken,
        token_type: "Bearer",
        expires_in: MEMORY_ACCESS_TOKEN_TTL_SECONDS,
      },
      { status: 201, headers: privateHeaders },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("token limit")) {
      return Response.json({ error: error.message }, { status: 429, headers: CORS });
    }
    throw error;
  }
}

async function revoke(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token.startsWith("spt_")) {
    return Response.json({ error: "A temporary access token is required." }, { status: 401, headers: CORS });
  }
  if (!(await revokeMemoryAccessToken(token))) {
    return Response.json({ error: "Invalid or expired access token." }, { status: 401, headers: CORS });
  }
  return Response.json({ revoked: true }, { headers: privateHeaders });
}

export const Route = createFileRoute("/api/public/access-token")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => create(request),
      DELETE: async ({ request }) => revoke(request),
    },
  },
});
