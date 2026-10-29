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

function ApiDocs() {
  const [apiToken, setApiToken] = useState("");
  const [speechText, setSpeechText] = useState("Hello from the Speak API tester.");
  const [speechLang, setSpeechLang] = useState("en");
  const [provider, setProvider] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [audioUrl, setAudioUrl] = useState("");

  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  async function trySpeech(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult("");
    setAudioUrl("");
    try {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (apiToken.trim()) headers.set("Authorization", `Bearer ${apiToken.trim()}`);
      const response = await fetch("/api/public/tts", {
        method: "POST",
        headers,
        body: JSON.stringify({ text: speechText, lang: speechLang, provider }),
      });
      if (!response.ok) {
        const body = await response.text();
        setResult(`HTTP ${response.status}: ${body || response.statusText}`);
        return;
      }
      const blob = await response.blob();
      if (blob.type.startsWith("audio/")) {
        setAudioUrl(URL.createObjectURL(blob));
        setResult(`HTTP ${response.status} · ${blob.type} · ${blob.size} bytes`);
      } else {
        setResult(`HTTP ${response.status}: ${await blob.text()}`);
      }
    } catch (reason) {
      setResult(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

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
            </div>
          </article>
        ))}
      </section>

      <section className="mt-8 border border-border p-4">
        <h2 className="font-semibold">Try a speech request</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Optionally enter a personal API token. It is held in this page's memory only, sent as a
          bearer header, and never added to the URL or request summary.
        </p>
        <form className="mt-4 space-y-3" onSubmit={(event) => void trySpeech(event)}>
          <label className="block text-xs text-muted-foreground">
            Personal API token (optional)
            <input
              aria-label="Personal API token"
              className="mt-1 w-full border border-border bg-background px-3 py-2 text-sm"
              type="password"
              autoComplete="off"
              value={apiToken}
              onChange={(event) => setApiToken(event.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-muted-foreground">
              Provider
              <select
                aria-label="Tester provider"
                className="mt-1 w-full border border-border bg-background px-3 py-2 text-sm"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
              >
                {[
                  "auto",
                  "google",
                  "lovable",
                  "openrouter",
                  "gemini",
                  "openai",
                  "elevenlabs",
                  "deepgram",
                ].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-muted-foreground">
              Language
              <input
                aria-label="Tester language"
                className="mt-1 w-full border border-border bg-background px-3 py-2 text-sm"
                value={speechLang}
                onChange={(event) => setSpeechLang(event.target.value)}
                required
              />
            </label>
          </div>
          <label className="block text-xs text-muted-foreground">
            Text
            <textarea
              aria-label="Tester text"
              className="mt-1 w-full border border-border bg-background px-3 py-2 text-sm"
              rows={3}
              maxLength={5000}
              value={speechText}
              onChange={(event) => setSpeechText(event.target.value)}
              required
            />
          </label>
          <button
            type="submit"
            className="bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
            disabled={busy}
          >
            {busy ? "Sending…" : "Send request"}
          </button>
        </form>
        {result && (
          <p role="status" className="mt-3 break-words text-sm">
            {result}
          </p>
        )}
        {audioUrl && <audio className="mt-3 w-full" controls src={audioUrl} />}
        <p className="mt-4 text-sm text-muted-foreground">
          For other operations, use the{" "}
          <Link to="/" className="underline">
            speech playground
          </Link>{" "}
          or send requests directly.
        </p>
      </section>
    </main>
  );
}
