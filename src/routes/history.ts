import { createFileRoute } from "@tanstack/react-router";
import { history } from "@/lib/monitor.server";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };

export const Route = createFileRoute("/history")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const limit = Math.min(500, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 100));
        return Response.json({ count: history.length, requests: history.slice(0, limit) }, { headers: CORS });
      },
    },
  },
});
