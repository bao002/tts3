import { resolveApiUser, UserAuthError } from "@/lib/user-account.server";
import { history } from "@/lib/monitor.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization",
};

export async function getUsageReport(request: Request) {
  const pool = await import("@/lib/openrouter-pool.server");
  let userId: string | null = null;
  const authorization = request.headers.get("Authorization") || "";

  if (authorization.startsWith("Bearer spt_")) {
    try {
      userId = await resolveApiUser(request);
    } catch {
      return Response.json(
        { error: "Invalid or expired temporary access token" },
        { status: 401, headers: CORS },
      );
    }
  } else if (authorization.startsWith("Bearer spk_")) {
    try {
      userId = await resolveApiUser(request);
    } catch (error) {
      if (error instanceof UserAuthError) {
        return Response.json(
          { error: "Invalid personal API token" },
          { status: 401, headers: CORS },
        );
      }
      return Response.json(
        { error: "Could not authenticate request" },
        { status: 503, headers: CORS },
      );
    }
  } else if (authorization.startsWith("Bearer ")) {
    try {
      userId = await resolveApiUser(request);
    } catch {
      userId = null;
    }
  }

  if (!userId && !(await pool.authorizeManagement(request))) {
    return Response.json(
      { error: "Management authorization required" },
      { status: 401, headers: CORS },
    );
  }

  if (userId?.startsWith("memory:") || !pool.hasSupabaseAdminConfig()) {
    const requested = Number(new URL(request.url).searchParams.get("hours")) || 24;
    const windowHours = Math.max(1, Math.min(720, Math.floor(requested)));
    return Response.json(
      getInMemoryUsageReport(windowHours, userId ?? undefined),
      { headers: { ...CORS, "Cache-Control": "no-store" } },
    );
  }

  const requested = Number(new URL(request.url).searchParams.get("hours")) || 24;
  const windowHours = Math.max(1, Math.min(720, Math.floor(requested)));

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("provider_usage_report", {
      window_hours: windowHours,
      ...(userId ? { report_user_id: userId } : {}),
    });
    if (error) throw error;
    return Response.json(data, { headers: { ...CORS, "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not load usage report" }, { status: 503, headers: CORS });
  }
}

export function getInMemoryUsageReport(windowHours: number, userId?: string) {
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  const events = history.filter(
    (event) =>
      Date.parse(event.at) >= cutoff && (userId === undefined || event.userId === userId),
  );
  const summarize = (group: typeof events) => ({
    requests: group.length,
    successful: group.filter((event) => event.status >= 200 && event.status < 300).length,
    failed: group.filter((event) => event.status < 200 || event.status >= 300).length,
    cached: group.filter((event) => event.cached).length,
    audio_bytes: group.reduce((total, event) => total + event.bytes, 0),
    input_chars: group.reduce((total, event) => total + (event.inputChars ?? 0), 0),
    output_chars: group.reduce((total, event) => total + (event.outputChars ?? 0), 0),
    estimated_input_tokens: group.reduce(
      (total, event) => total + (event.estimatedInputTokens ?? 0),
      0,
    ),
    provider_input_tokens: group.reduce(
      (total, event) => total + (event.providerInputTokens ?? 0),
      0,
    ),
    provider_output_tokens: group.reduce(
      (total, event) => total + (event.providerOutputTokens ?? 0),
      0,
    ),
    avg_duration_ms: group.length
      ? Math.round(group.reduce((total, event) => total + event.ms, 0) / group.length)
      : 0,
  });
  const services = new Map<string, typeof events>();
  for (const event of events) {
    const group = services.get(event.provider) ?? [];
    group.push(event);
    services.set(event.provider, group);
  }
  return {
    window_hours: windowHours,
    totals: summarize(events),
    services: [...services].map(([service, group]) => ({
      service,
      ...summarize(group),
    })).sort((left, right) => right.requests - left.requests),
    storage: "in-memory",
    retention: "Current server process only (maximum 500 recent requests).",
  };
}

export const usageReportCorsHeaders = CORS;
