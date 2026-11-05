import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { openApiSpec } from "@/lib/openapi";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    schema?: unknown;
  }>;
  requestBody?: unknown;
  responses?: Record<string, { description?: string }>;
};

const methods: HttpMethod[] = ["get", "post", "put", "patch", "delete"];
const methodStyles: Record<HttpMethod, string> = {
  get: "text-sky-700 dark:text-sky-300",
  post: "text-green-700 dark:text-green-300",
  put: "text-amber-700 dark:text-amber-300",
  patch: "text-violet-700 dark:text-violet-300",
  delete: "text-red-700 dark:text-red-300",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOperation(value: unknown): value is OpenApiOperation {
  return (
    isRecord(value) &&
    (typeof value["summary"] === "string" || typeof value["operationId"] === "string")
  );
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "API reference — Speak API" },
      {
        name: "description",
        content: "Browse the Speak API OpenAPI reference and request schemas.",
      },
    ],
  }),
  component: ApiDocs,
});

function sampleFromSchema(schema: unknown, depth = 0): unknown {
  if (!isRecord(schema) || depth > 5) return null;
  if (schema["example"] !== undefined) return schema["example"];
  if (schema["default"] !== undefined) return schema["default"];
  if (Array.isArray(schema["enum"])) return schema["enum"][0];
  const type = schema["type"];
  if (type === "object" || isRecord(schema["properties"])) {
    const out: Record<string, unknown> = {};
    const props = isRecord(schema["properties"]) ? schema["properties"] : {};
    for (const [key, value] of Object.entries(props)) out[key] = sampleFromSchema(value, depth + 1);
    return out;
  }
  if (type === "array") return [sampleFromSchema(schema["items"], depth + 1)];
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "string") return "string";
  return null;
}

function sampleBody(requestBody: unknown): string {
  if (!isRecord(requestBody) || !isRecord(requestBody["content"])) return "";
  const json = requestBody["content"]["application/json"];
  if (!isRecord(json)) return "";
  if (json["example"] !== undefined) return pretty(json["example"]);
  return pretty(sampleFromSchema(json["schema"]));
}

type TryResult = { status: string; body: string; audioUrl?: string };

function TryIt({
  path,
  method,
  operation,
  token,
}: {
  path: string;
  method: HttpMethod;
  operation: OpenApiOperation;
  token: string;
}) {
  const params = (operation.parameters ?? []).filter((p) => p.in === "path" || p.in === "query");
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of params) {
      const s = isRecord(p.schema) ? p.schema : {};
      const d = s["example"] ?? s["default"];
      init[p.name] = d === undefined ? "" : String(d);
    }
    return init;
  });
  const [body, setBody] = useState(() => sampleBody(operation.requestBody));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TryResult | null>(null);

  useEffect(
    () => () => {
      if (result?.audioUrl) URL.revokeObjectURL(result.audioUrl);
    },
    [result],
  );

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      let url = path;
      const query = new URLSearchParams();
      for (const p of params) {
        const v = values[p.name] ?? "";
        if (p.in === "path") url = url.replace(`{${p.name}}`, encodeURIComponent(v));
        else if (v !== "") query.set(p.name, v);
      }
      const qs = query.toString();
      if (qs) url += `?${qs}`;
      const headers = new Headers();
      if (token.trim()) headers.set("Authorization", `Bearer ${token.trim()}`);
      const init: RequestInit = { method: method.toUpperCase(), headers };
      if (operation.requestBody !== undefined && method !== "get" && body.trim()) {
        headers.set("Content-Type", "application/json");
        init.body = body;
      }
      const response = await fetch(url, init);
      const type = response.headers.get("content-type") ?? "";
      const status = `HTTP ${response.status} ${response.statusText} · ${type || "no content-type"}`;
      if (type.startsWith("audio/")) {
        const blob = await response.blob();
        setResult({
          status: `${status} · ${blob.size} bytes`,
          body: "",
          audioUrl: URL.createObjectURL(blob),
        });
      } else {
        const text = await response.text();
        let shown = text;
        try {
          shown = pretty(JSON.parse(text));
        } catch {
          /* not JSON */
        }
        setResult({ status, body: shown });
      }
    } catch (reason) {
      setResult({
        status: "Request failed",
        body: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-4 border-t border-border pt-3">
      <summary className="cursor-pointer text-sm font-semibold">Try it out</summary>
      <form className="mt-3 space-y-3" onSubmit={(event) => void send(event)}>
        {params.map((p) => (
          <label key={`${p.in}-${p.name}`} className="block text-xs text-muted-foreground">
            {p.name} ({p.in}
            {p.required ? ", required" : ""})
            <input
              className="mt-1 w-full border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
              value={values[p.name] ?? ""}
              required={p.required}
              onChange={(event) => setValues({ ...values, [p.name]: event.target.value })}
            />
          </label>
        ))}
        {operation.requestBody !== undefined && method !== "get" && (
          <label className="block text-xs text-muted-foreground">
            JSON body
            <textarea
              className="mt-1 w-full border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
              rows={Math.min(14, Math.max(4, body.split("\n").length))}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
        )}
        <button
          type="submit"
          className="bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
          disabled={busy}
        >
          {busy ? "Sending…" : `Send ${method.toUpperCase()}`}
        </button>
      </form>
      {result && (
        <div role="status" className="mt-3 text-sm">
          <p className="font-mono text-xs">{result.status}</p>
          {result.audioUrl && <audio className="mt-2 w-full" controls src={result.audioUrl} />}
          {result.body && (
            <pre className="mt-2 max-h-96 overflow-auto bg-muted p-3 text-xs">{result.body}</pre>
          )}
        </div>
      )}
    </details>
  );
}

function ClientSnippets({
  path,
  method,
  operation,
  token,
}: {
  path: string;
  method: HttpMethod;
  operation: OpenApiOperation;
  token: string;
}) {
  const [tab, setTab] = useState<"fetch" | "curl">("fetch");
  const [copied, setCopied] = useState(false);

  const base = typeof window === "undefined" ? "https://tts3.lovable.app" : window.location.origin;
  const bearer = token.trim() || "YOUR_API_TOKEN";
  const params = (operation.parameters ?? []).filter((p) => p.in === "query");
  const query = params
    .map((p) => {
      const s = isRecord(p.schema) ? p.schema : {};
      const d = s["example"] ?? s["default"];
      return d === undefined ? null : `${p.name}=${encodeURIComponent(String(d))}`;
    })
    .filter(Boolean)
    .join("&");
  const url = `${base}${path}${query ? `?${query}` : ""}`;
  const body = operation.requestBody !== undefined && method !== "get" ? sampleBody(operation.requestBody) : "";
  const upper = method.toUpperCase();

  const fetchSnippet = [
    `const response = await fetch("${url}", {`,
    `  method: "${upper}",`,
    `  headers: {`,
    `    Authorization: "Bearer ${bearer}",`,
    ...(body ? [`    "Content-Type": "application/json",`] : []),
    `  },`,
    ...(body ? [`  body: JSON.stringify(${body.trim()}),`] : []),
    `});`,
    ``,
    `if (response.headers.get("content-type")?.startsWith("audio/")) {`,
    `  const blob = await response.blob(); // play or save the audio`,
    `} else {`,
    `  const data = await response.json();`,
    `}`,
  ].join("\n");

  const curlSnippet = [
    `curl -X ${upper} "${url}" \\`,
    `  -H "Authorization: Bearer ${bearer}"${body ? " \\" : ""}`,
    ...(body ? [`  -H "Content-Type: application/json" \\`, `  -d '${body.trim().replace(/\n\s*/g, " ")}'`] : []),
  ].join("\n");

  const snippet = tab === "fetch" ? fetchSnippet : curlSnippet;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <details className="mt-4 border-t border-border pt-3">
      <summary className="cursor-pointer text-sm font-semibold">Client code</summary>
      <div className="mt-3">
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            className={`border border-border px-3 py-1 ${tab === "fetch" ? "bg-foreground text-background" : ""}`}
            onClick={() => setTab("fetch")}
          >
            Browser fetch
          </button>
          <button
            type="button"
            className={`border border-border px-3 py-1 ${tab === "curl" ? "bg-foreground text-background" : ""}`}
            onClick={() => setTab("curl")}
          >
            curl
          </button>
          <button type="button" className="ml-auto underline" onClick={() => void copy()}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="mt-2 max-h-96 overflow-auto bg-muted p-3 text-xs">{snippet}</pre>
        <p className="mt-1 text-xs text-muted-foreground">
          {token.trim()
            ? "Your token from the box above is already filled in."
            : "Paste a token in the box above and it will be filled into the sample automatically."}
        </p>
      </div>
    </details>
  );
}

function ApiDocs() {
  const [apiToken, setApiToken] = useState("");
  const operations = Object.entries(openApiSpec.paths).flatMap(([path, pathItem]) =>
    methods.flatMap((method) => {
      const operation = Reflect.get(pathItem, method);
      return isOperation(operation) ? [{ path, method, operation }] : [];
    }),
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 text-foreground">
      <header className="border-b border-border pb-6">
        <nav className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            Back to speech
          </Link>
          <a href="/api/public/openapi.json" className="hover:text-foreground">
            OpenAPI JSON
          </a>
        </nav>
        <h1 className="mt-6 text-3xl font-semibold">{openApiSpec.info.title} API reference</h1>
        <p className="mt-2 text-sm text-muted-foreground">{openApiSpec.info.description}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Version {openApiSpec.info.version} · {operations.length} operations ·{" "}
          <a className="underline" href="/api/public/openapi.json">
            Download the canonical OpenAPI document
          </a>
        </p>
      </header>

      <section className="sticky top-0 z-10 mt-6 border border-border bg-background p-4">
        <label className="block text-sm font-semibold">
          API token
          <input
            aria-label="API token"
            className="mt-1 w-full border border-border bg-background px-3 py-2 font-mono text-sm font-normal"
            type="password"
            autoComplete="off"
            placeholder="Paste a personal API token, session token, or management token"
            value={apiToken}
            onChange={(event) => setApiToken(event.target.value)}
          />
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Sent as <code>Authorization: Bearer …</code> with every "Try it out" request. Kept in this
          page only. Get one on the{" "}
          <Link to="/tokens" className="underline">
            tokens page
          </Link>
          .
        </p>
      </section>

      <section aria-label="API operations" className="mt-8 space-y-4">
        {operations.map(({ path, method, operation }) => (
          <article key={`${method}-${path}`} className="border border-border">
            <div className="p-4">
              <h2 className="flex flex-wrap items-baseline gap-3 text-base font-semibold">
                <span className={`font-mono uppercase ${methodStyles[method]}`}>{method}</span>
                <code className="break-all">{path}</code>
              </h2>
              {operation.summary && <p className="mt-2 text-sm">{operation.summary}</p>}
              {operation.description && (
                <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                  {operation.description}
                </p>
              )}
              {operation.parameters && operation.parameters.length > 0 && (
                <section className="mt-4">
                  <h3 className="text-sm font-semibold">Parameters</h3>
                  <ul className="mt-2 divide-y divide-border border-y border-border">
                    {operation.parameters.map((parameter) => (
                      <li
                        key={`${parameter.in}-${parameter.name}`}
                        className="grid gap-1 py-2 text-sm sm:grid-cols-[12rem_1fr]"
                      >
                        <code>{parameter.name}</code>
                        <span className="text-muted-foreground">
                          {parameter.in}
                          {parameter.required ? " · required" : " · optional"}
                          {parameter.description ? ` · ${parameter.description}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {operation.requestBody !== undefined && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-semibold">
                    Request body schema
                  </summary>
                  <pre className="mt-2 max-h-96 overflow-auto bg-muted p-3 text-xs">
                    {pretty(operation.requestBody)}
                  </pre>
                </details>
              )}
              {operation.responses && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-semibold">Responses</summary>
                  <ul className="mt-2 divide-y divide-border border-y border-border">
                    {Object.entries(operation.responses).map(([status, response]) => (
                      <li key={status} className="grid gap-1 py-2 text-sm sm:grid-cols-[8rem_1fr]">
                        <code>{status}</code>
                        <span className="text-muted-foreground">{response.description}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <ClientSnippets path={path} method={method} operation={operation} token={apiToken} />
              <TryIt path={path} method={method} operation={operation} token={apiToken} />
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
