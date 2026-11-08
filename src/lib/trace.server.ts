// Per-request trace of outgoing provider HTTP calls (debug mode only).
import { AsyncLocalStorage } from "node:async_hooks";
import { redactBody, redactHeaders, redactUrl } from "./request-safety";
export { redactHeaders, redactUrl } from "./request-safety";

export type TraceEntry = {
  at: string;
  ms: number;
  request: { method: string; url: string; headers: Record<string, string>; body?: unknown };
  response?: { status: number; statusText: string; headers: Record<string, string>; body: unknown };
  error?: string;
};

const store = new AsyncLocalStorage<TraceEntry[]>();
const MAX = 8000;

export function runWithTrace<T>(trace: TraceEntry[], fn: () => Promise<T>) {
  return store.run(trace, fn);
}

function parseBody(text: string): unknown {
  try {
    const safe = redactBody(JSON.parse(text));
    const serialized = JSON.stringify(safe);
    return serialized.length > MAX ? `[JSON body omitted: ${serialized.length} characters]` : safe;
  } catch {
    return "[non-JSON body omitted]";
  }
}

export async function tracedFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const trace = store.getStore();
  if (!trace) return fetch(input, init);
  const t0 = Date.now();
  const entry: TraceEntry = {
    at: new Date().toISOString(),
    ms: 0,
    request: {
      method: init?.method ?? "GET",
      url: redactUrl(String(input)),
      headers: redactHeaders(init?.headers as Record<string, string> | undefined),
      ...(typeof init?.body === "string" ? { body: parseBody(init.body) } : {}),
    },
  };
  trace.push(entry);
  try {
    const res = await fetch(input, init);
    entry.ms = Date.now() - t0;
    const type = res.headers.get("content-type") ?? "";
    let body: unknown;
    if (/json|text\/(?!event-stream)/.test(type) || !res.ok) {
      // Provider bodies can echo credentials and contain large base64 audio payloads.
      body = "[provider response body omitted]";
    } else if (type.includes("event-stream")) {
      body = "[event stream]";
    } else {
      body = `[binary ${type || "data"}${res.headers.get("content-length") ? `, ${res.headers.get("content-length")} bytes` : ""}]`;
    }
    entry.response = {
      status: res.status,
      statusText: res.statusText,
      headers: redactHeaders(res.headers),
      body,
    };
    return res;
  } catch (e) {
    entry.ms = Date.now() - t0;
    entry.error = "Provider request failed";
    throw e;
  }
}
