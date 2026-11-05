// Per-request trace of outgoing provider HTTP calls (debug mode only).
import { AsyncLocalStorage } from "node:async_hooks";

export type TraceEntry = {
  at: string;
  ms: number;
  request: { method: string; url: string; headers: Record<string, string>; body?: unknown };
  response?: { status: number; statusText: string; headers: Record<string, string>; body: unknown };
  error?: string;
};

const store = new AsyncLocalStorage<TraceEntry[]>();
const SECRET_HEADERS = ["authorization", "xi-api-key", "x-goog-api-key", "api-key", "x-api-key"];
const MAX = 8000;

export function runWithTrace<T>(trace: TraceEntry[], fn: () => Promise<T>) {
  return store.run(trace, fn);
}

export function redactHeaders(headers: Headers | Record<string, string> | undefined) {
  const out: Record<string, string> = {};
  new Headers(headers as HeadersInit | undefined).forEach((value, key) => {
    out[key] = SECRET_HEADERS.includes(key.toLowerCase()) ? redactValue(value) : value;
  });
  return out;
}

function redactValue(value: string) {
  const parts = value.split(" ");
  const secret = parts.pop() ?? "";
  return [...parts, secret.length > 8 ? `${secret.slice(0, 4)}…[redacted]` : "[redacted]"].join(" ");
}

function redactUrl(url: string) {
  try {
    const u = new URL(url);
    for (const k of ["key", "api_key", "token"]) if (u.searchParams.has(k)) u.searchParams.set(k, "[redacted]");
    return u.toString();
  } catch {
    return url;
  }
}

function parseBody(text: string): unknown {
  const clipped = text.length > MAX ? `${text.slice(0, MAX)}…[${text.length - MAX} more chars]` : text;
  try {
    return JSON.parse(text);
  } catch {
    return clipped;
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
      body = parseBody(await res.clone().text());
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
    entry.error = e instanceof Error ? e.message : String(e);
    throw e;
  }
}
