import { buildDirectRequest, headersToObject, isDirectProvider, redactSecretHeaders, type DirectProvider } from "@/lib/direct-tts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { openApiSpec } from "@/lib/openapi";
import { speechLanguages } from "@/lib/fish-audio";
import { providerVoices } from "@/lib/voices";
import { detectLanguageCode } from "@/lib/language-detection";
import { saveAudioHistory } from "@/lib/audio-history";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { geminiAudioBlob } from "@/lib/gemini-audio";
import { isRequestObject } from "@/lib/request-safety";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Speak API — Text to speech with translation" },
      {
        name: "description",
        content:
          "Open API for text-to-speech via Google, Lovable AI, OpenRouter, Gemini, OpenAI, ElevenLabs, and Deepgram, with optional translation.",
      },
      { property: "og:title", content: "Speak API" },
      {
        property: "og:description",
        content:
          "Text-to-speech API with translation across Google, Lovable AI, OpenRouter, Gemini, OpenAI, ElevenLabs, and Deepgram.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const field =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring";
const quickSamples = {
  fr: {
    text: "Bonjour, comment allez-vous aujourd'hui ? La lumière du soir est magnifique.",
    lang: "fr",
  },
  it: { text: "Ciao, come stai oggi? La luce della sera è bellissima.", lang: "it" },
} as const;

type LogEntry = { source: "client" | "server"; title: string; data: unknown };

function Index() {
  const [form, setForm] = useState({
    text: "The warm light flows across the OpenRouter office as the evening settles in and the routing never stops. One interface, hundreds of models. Ready when you are.",
    lang: "en",
    target_lang: "",
    provider: "google",
    api_key: "",
    voice: "",
    model: "fish-audio/s2.1-pro-free:free",
    speed: "1",
    options: "",
  });
  const [models, setModels] = useState<Array<{ slug: string; short_name?: string; name?: string }>>(
    [],
  );
  const [modelsLoading, setModelsLoading] = useState(true);
  const [audio, setAudio] = useState<string | null>(null);
  const [info, setInfo] = useState("");
  const [historyWarning, setHistoryWarning] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [direct, setDirect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customVoice, setCustomVoice] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [k]: e.target.value }));
  const setProvider = (e: { target: { value: string } }) => {
    setCustomVoice(false);
    setDirect((current) => current && isDirectProvider(e.target.value));
    setForm((current) => ({ ...current, provider: e.target.value, voice: "", api_key: "", options: "" }));
  };
  const voiceOptions = providerVoices[form.provider] ?? [];
  const selectVoice = (e: { target: { value: string } }) => {
    const v = e.target.value;
    if (v === "__custom") {
      setCustomVoice(true);
      setForm((current) => ({ ...current, voice: "" }));
    } else {
      setCustomVoice(false);
      setForm((current) => ({ ...current, voice: v }));
    }
  };
  const setText = (e: { target: { value: string } }) => {
    const text = e.target.value;
    const lang = detectLanguageCode(text);
    setForm((current) => ({ ...current, text, ...(lang ? { lang } : {}) }));
  };

  useEffect(() => {
    if (!audio) return;
    return () => URL.revokeObjectURL(audio);
  }, [audio]);

  useEffect(() => {
    fetch(
      "https://openrouter.ai/api/frontend/v1/models/find?active=true&fmt=cards&input_modalities=text&output_modalities=audio",
    )
      .then((res) => {
        if (!res.ok) throw new Error(`OpenRouter returned ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const listed = (data.data?.models ?? []) as Array<{
          slug: string;
          short_name?: string;
          name?: string;
        }>;
        const available = [
          { slug: "fish-audio/s2.1-pro-free:free", short_name: "Fish Audio S2.1 Pro Free" },
          ...listed.filter((model) => model.slug !== "fish-audio/s2.1-pro-free:free"),
        ];
        setModels(available);
      })
      .catch(() => setInfo("Could not load OpenRouter models"))
      .finally(() => setModelsLoading(false));
  }, []);

  async function run(quickRequest?: { text: string; lang: string }) {
    const requestStartedAt = performance.now();
    setBusy(true);
    setInfo("");
    setHistoryWarning("");
    setAudio(null);
    setLogs([]);
    const log: LogEntry[] = [];
    try {
      let options: Record<string, unknown> | undefined;
      if (
        !quickRequest &&
        form.provider !== "google" &&
        form.provider !== "auto" &&
        form.options.trim()
      ) {
        try {
          const parsed: unknown = JSON.parse(form.options);
          if (!isRequestObject(parsed)) throw new Error("not an object");
          options = parsed;
        } catch {
          throw new Error("Provider options must be a JSON object");
        }
      }
      const body: Record<string, unknown> = quickRequest
        ? {
            ...quickRequest,
            provider: form.provider,
            ...(form.provider !== "auto" &&
              form.provider !== "google" &&
              form.api_key && { api_key: form.api_key }),
            ...(form.provider === "openrouter" && form.model && { options: { model: form.model } }),
          }
        : {
            text: form.text,
            lang: form.lang,
            provider: form.provider,
            ...(form.target_lang && { target_lang: form.target_lang }),
            ...(form.provider !== "auto" &&
              form.provider !== "google" &&
              form.api_key && { api_key: form.api_key }),
            ...(form.provider !== "auto" && form.voice && { voice: form.voice }),
            ...(Number(form.speed) !== 1 && { speed: Number(form.speed) }),
            ...((options || (form.provider === "openrouter" && form.model)) && {
              options: {
                ...options,
                ...(form.provider === "openrouter" && form.model ? { model: form.model } : {}),
              },
            }),
          };
      const useDirect = direct && isDirectProvider(form.provider);
      if (direct && !useDirect) throw new Error("Choose OpenAI, OpenRouter, Gemini, ElevenLabs or Deepgram for direct mode");
      if (useDirect && form.target_lang.trim()) throw new Error("Translation requires server mode; clear Translate to or turn off direct mode");
      if (useDirect && !form.api_key.trim())
        throw new Error("Direct mode needs your provider API key (Advanced settings)");
      let res: Response;
      if (useDirect) {
        const req = buildDirectRequest({
          provider: form.provider as DirectProvider,
          apiKey: form.api_key.trim(),
          text: String(body["text"]),
          lang: String(body["lang"]),
          voice: typeof body["voice"] === "string" ? body["voice"] : undefined,
          speed: typeof body["speed"] === "number" ? body["speed"] : undefined,
          options: body["options"] as Record<string, unknown> | undefined,
        });
        log.push({
          source: "client",
          title: `Request → ${req.method} ${req.url}`,
          data: { method: req.method, url: req.url, headers: redactSecretHeaders(req.headers), body: req.body },
        });
        res = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: JSON.stringify(req.body),
        });
      } else {
        body["debug"] = true;
        const headers = new Headers({ "Content-Type": "application/json" });
        if (
          import.meta.env["VITE_SUPABASE_URL"] &&
          import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]
        ) {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (data.session?.access_token) {
            headers.set("Authorization", `Bearer ${data.session.access_token}`);
          }
        }
        log.push({
          source: "client",
          title: "Request → POST /api/public/tts",
          data: {
            method: "POST",
            url: `${window.location.origin}/api/public/tts`,
            headers: redactSecretHeaders(headersToObject(headers)),
            body: { ...body, ...(body["api_key"] ? { api_key: "[redacted]" } : {}) },
          },
        });
        res = await fetch("/api/public/tts", { method: "POST", headers, body: JSON.stringify(body) });
      }
      const responseInfo = {
        status: res.status,
        statusText: res.statusText,
        headers: headersToObject(res.headers),
      };
      let blob: Blob;
      let meta: { text?: string; lang?: string; provider?: string; usage?: { inputTokens?: number; outputTokens?: number } } = {};
      if ((res.headers.get("Content-Type") || "").includes("json")) {
        const json = (await res.json()) as Record<string, unknown>;
        if (useDirect && form.provider === "gemini") {
          log.push({ source: "client", title: `Response ← ${res.status}`, data: { ...responseInfo, body: "[Gemini response body omitted]" } });
          if (!res.ok) {
            const error = json["error"] as { message?: string } | undefined;
            throw new Error(error?.message || `Gemini request failed (${res.status})`);
          }
          blob = geminiAudioBlob(json);
          meta = { text: String(body["text"]), lang: String(body["lang"]), provider: "gemini" };
        } else {
        const { server_log: serverLog, audio: b64, ...rest } = json;
        if (serverLog && typeof serverLog === "object") {
          const sl = serverLog as { received?: unknown; provider_calls?: Array<{ request?: { method?: string; url?: string } }> };
          log.push({ source: "server", title: "Received from client", data: sl.received });
          (sl.provider_calls ?? []).forEach((call, i) =>
            log.push({
              source: "server",
              title: `Provider call ${i + 1} → ${call.request?.method ?? ""} ${call.request?.url ?? ""}`,
              data: call,
            }),
          );
          if (!sl.provider_calls?.length)
            log.push({ source: "server", title: "No provider calls", data: "Served from cache or failed before calling a provider" });
        }
        log.push({
          source: "client",
          title: `Response ← ${res.status}`,
          data: { ...responseInfo, body: { ...rest, ...(typeof b64 === "string" ? { audio: `[base64, ${b64.length} chars]` } : {}) } },
        });
        if (!res.ok || typeof b64 !== "string") {
          const error = json["error"];
          throw new Error(
            error ? (typeof error === "string" ? error : JSON.stringify(error)) : `Request failed (${res.status})`,
          );
        }
        blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], {
          type: typeof json["mime"] === "string" ? json["mime"] : "audio/mpeg",
        });
        meta = json as typeof meta;
        }
      } else if (!res.ok) {
        const text = await res.text();
        log.push({ source: "client", title: `Response ← ${res.status}`, data: { ...responseInfo, body: text } });
        throw new Error(text || `Request failed (${res.status})`);
      } else {
        blob = await res.blob();
        log.push({
          source: "client",
          title: `Response ← ${res.status}`,
          data: { ...responseInfo, body: `[binary ${blob.type || "audio"}, ${blob.size} bytes]` },
        });
      }
      setAudio(URL.createObjectURL(blob));
      const responseTimeHeader = res.headers.get("X-Response-Time-Ms");
      const responseTimeMs =
        responseTimeHeader === null
          ? Math.round(performance.now() - requestStartedAt)
          : Number(responseTimeHeader);
      const spokenLanguage = res.headers.get("X-Spoken-Lang") || meta.lang || form.lang;
      const inTok = res.headers.get("X-Provider-Input-Tokens") ?? meta.usage?.inputTokens;
      const outTok = res.headers.get("X-Provider-Output-Tokens") ?? meta.usage?.outputTokens;
      try {
        await saveAudioHistory({
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          provider: res.headers.get("X-Provider") || meta.provider || form.provider,
          language: spokenLanguage,
          responseTimeMs: Number.isFinite(responseTimeMs)
            ? responseTimeMs
            : Math.round(performance.now() - requestStartedAt),
          audioBytes: blob.size,
          inputChars: String(body["text"] ?? "").length,
          cached: res.headers.get("X-Cache") === "HIT",
          ...(inTok != null ? { providerInputTokens: Number(inTok) } : {}),
          ...(outTok != null ? { providerOutputTokens: Number(outTok) } : {}),
          mime: blob.type || res.headers.get("Content-Type") || "audio/mpeg",
          audio: blob,
        });
      } catch (historyError) {
        setHistoryWarning(
          `Audio generated, but browser history could not be saved: ${
            historyError instanceof Error ? historyError.message : String(historyError)
          }`,
        );
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setInfo(message);
      log.push({ source: "client", title: "Error", data: message });
    } finally {
      setLogs(log);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 text-foreground sm:px-6 sm:py-14 lg:px-8">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Speak API playground
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Turn your words into voice.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Generate natural speech, translate as you go, and choose from a range of providers.
          Explore the{" "}
          <Link to="/docs" className="font-medium text-foreground underline underline-offset-4">
            API reference
          </Link>{" "}
          or view the{" "}
          <a
            className="font-medium text-foreground underline underline-offset-4"
            href="/api/public/openapi.json"
          >
            OpenAPI document
          </a>
          .
        </p>
      </header>

      <section
        aria-label="Speech playground"
        className="space-y-5 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-7"
      >
        <label className="block text-xs text-muted-foreground">
          Provider
          <select
            aria-label="Provider"
            className={`${field} mt-1`}
            value={form.provider}
            onChange={setProvider}
          >
            <option value="auto">Auto (random healthy provider)</option>
            <option value="google">Google</option>
            <option value="lovable">Lovable</option>
            <option value="openrouter">OpenRouter</option>
            <option value="gemini">Google Gemini</option>
            <option value="openai">OpenAI GPT</option>
            <option value="elevenlabs">ElevenLabs</option>
            <option value="deepgram">Deepgram Aura</option>
          </select>
        </label>
        {form.provider === "auto" && (
          <p className="rounded-lg bg-muted px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            Auto randomly selects a configured provider key that has no recent authentication or
            quota failures. To supply your own key for one request, select its specific provider.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline"
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => void run(quickSamples.fr)}
          >
            <Play aria-hidden="true" size={14} />
            Speak French
          </Button>
          <Button variant="outline"
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => void run(quickSamples.it)}
          >
            <Play aria-hidden="true" size={14} />
            Speak Italian
          </Button>
        </div>
        <label className="block text-xs text-muted-foreground">
          Text to speak
          <textarea className={`${field} mt-1`} rows={3} value={form.text} onChange={setText} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs text-muted-foreground">
            Text language
            <input
              aria-label="Text language"
              list="speech-languages"
              className={`${field} mt-1`}
              placeholder="Auto-detected"
              value={form.lang}
              onChange={set("lang")}
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Translate to (optional)
            <input
              aria-label="Translate to"
              list="speech-languages"
              className={`${field} mt-1`}
              placeholder="No translation"
              value={form.target_lang}
              onChange={set("target_lang")}
            />
          </label>
          <datalist id="speech-languages">
            {speechLanguages.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </datalist>
        </div>
        {direct && isDirectProvider(form.provider) && (
          <label className="block text-xs text-muted-foreground">
            Provider API key
            <input aria-label="Provider API key" className={`${field} mt-1`} type="password" autoComplete="off" value={form.api_key} onChange={set("api_key")} />
          </label>
        )}
        <details className="rounded-lg border border-border px-3 py-3">
          <summary className="cursor-pointer text-sm font-medium">Advanced settings</summary>
          <div className="mt-3 space-y-3">
            {form.provider !== "auto" && form.provider !== "google" && (
              <label className="block text-xs text-muted-foreground">
                {form.provider === "deepgram" ? "Aura model (optional)" : "Voice (optional)"}
                {voiceOptions.length > 0 ? (
                  <>
                    <select
                      aria-label="Voice"
                      className={`${field} mt-1`}
                      value={customVoice ? "__custom" : form.voice}
                      onChange={selectVoice}
                    >
                      <option value="">Provider default</option>
                      {voiceOptions.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                        </option>
                      ))}
                      <option value="__custom">Custom…</option>
                    </select>
                    {customVoice && (
                      <input
                        aria-label="Custom voice"
                        className={`${field} mt-2`}
                        placeholder={
                          form.provider === "deepgram"
                            ? "e.g. aura-2-thalia-en"
                            : form.provider === "openrouter"
                              ? "Fish Audio voice ID (32 hex chars)"
                              : "Voice name or ID"
                        }
                        value={form.voice}
                        onChange={set("voice")}
                      />
                    )}
                  </>
                ) : (
                  <input
                    className={`${field} mt-1`}
                    placeholder="Voice ID from your ElevenLabs account"
                    value={form.voice}
                    onChange={set("voice")}
                  />
                )}
              </label>
            )}
            {form.provider === "openrouter" && (
              <>
                {!direct && <label className="block text-xs text-muted-foreground">
                  API key (optional; overrides configured keys for this request)
                  <input
                    className={`${field} mt-1`}
                    type="password"
                    autoComplete="off"
                    placeholder="Use configured keys, or enter a one-request override"
                    value={form.api_key}
                    onChange={set("api_key")}
                  />
                </label>}
                <label className="block text-xs text-muted-foreground">
                  OpenRouter model
                  <select
                    className={`${field} mt-1`}
                    value={form.model}
                    onChange={set("model")}
                    disabled={modelsLoading || models.length === 0}
                  >
                    <option value="">
                      {modelsLoading ? "Loading models…" : "No models available"}
                    </option>
                    {models.map((model) => (
                      <option key={model.slug} value={model.slug}>
                        {model.short_name || model.name || model.slug}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {form.provider !== "google" &&
              form.provider !== "auto" &&
              form.provider !== "openrouter" && !direct && (
                <label className="block text-xs text-muted-foreground">
                  API key (optional; overrides configured keys for this request)
                  <input
                    className={`${field} mt-1`}
                    type="password"
                    autoComplete="off"
                    placeholder="Use configured keys, or enter a one-request override"
                    value={form.api_key}
                    onChange={set("api_key")}
                  />
                </label>
              )}
            <label className="block text-xs text-muted-foreground">
              Speed: {form.speed}x
              <input
                className="w-full accent-foreground"
                type="range"
                min="0.25"
                max="4"
                step="0.25"
                value={form.speed}
                onChange={set("speed")}
              />
            </label>
            {form.provider !== "google" && form.provider !== "auto" && (
              <label className="block text-xs text-muted-foreground">
                Provider options (JSON)
                <textarea
                  className={`${field} mt-1`}
                  rows={2}
                  placeholder='Optional, e.g. {"temperature":0.7}'
                  value={form.options}
                  onChange={set("options")}
                />
              </label>
            )}
          </div>
        </details>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 accent-foreground"
            checked={direct}
            disabled={!isDirectProvider(form.provider)}
            onChange={(e) => setDirect(e.target.checked)}
          />
          <span>
            Send directly to the AI provider from this browser
            <span className="block text-xs text-muted-foreground">
              {direct
                ? isDirectProvider(form.provider)
                  ? "Uses the provider API key above."
                  : "Pick OpenAI, OpenRouter, Gemini, ElevenLabs or Deepgram."
                : "Off: the request goes through this server, and the server log is shown below."}
            </span>
          </span>
        </label>
        <Button
          onClick={() => void run()}
          disabled={busy}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {busy ? "Generating…" : "Generate audio"}
        </Button>
        {info && (
          <div role="alert" className="break-all text-sm text-destructive">
            <p>{info}</p>
            {info.includes("No provider key is available") && (
              <Link to="/account" className="mt-1 inline-block underline">
                Add a provider key in your account
              </Link>
            )}
            {info.includes("test a saved key in Account") && (
              <Link to="/account" className="mt-1 inline-block underline">
                Open Account to test your saved key
              </Link>
            )}
          </div>
        )}
        {historyWarning && <p role="status" className="text-sm text-muted-foreground">{historyWarning}</p>}
        {audio && <audio className="w-full" controls src={audio} />}
        {logs.length > 0 && <RequestLog logs={logs} />}
      </section>

      <details className="mt-8 rounded-xl border border-border px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold">API quick reference</summary>
        <h2 className="mt-4 text-sm font-semibold">curl</h2>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">{`curl "$HOST/api/public/tts?text=Hello&lang=en&target_lang=fr&provider=google" -o out.mp3`}</pre>
        <h2 className="mt-6 text-sm font-semibold">OpenAPI</h2>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs">
          {JSON.stringify(openApiSpec, null, 2)}
        </pre>
      </details>
    </main>
  );
}

function RequestLog({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState<"all" | "client" | "server">("all");
  const shown = logs.filter((l) => filter === "all" || l.source === filter);
  return (
    <section className="border-t border-border pt-4" aria-label="Request log">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Request log</h2>
        <div className="flex gap-1 text-xs">
          {(["all", "client", "server"] as const).map((f) => (
            <Button variant={filter === f ? "default" : "outline"} size="sm"
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md border border-border px-2 py-1 capitalize ${filter === f ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              {f}
            </Button>
          ))}
        </div>
      </div>
      <ol className="mt-3 space-y-2">
        {shown.map((entry, i) => (
          <li key={i}>
            <details className="rounded-lg border border-border" open>
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
                <span
                  className={`rounded px-1.5 py-0.5 font-semibold uppercase ${entry.source === "server" ? "bg-accent text-accent-foreground" : "bg-muted text-foreground"}`}
                >
                  {entry.source}
                </span>
                <span className="break-all font-mono">{entry.title}</span>
              </summary>
              <pre className="max-h-96 overflow-auto border-t border-border bg-muted p-3 text-xs">
                {typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data, null, 2)}
              </pre>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
