import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { openApiSpec } from "@/lib/openapi";
import { speechLanguages } from "@/lib/fish-audio";
import { detectLanguageCode } from "@/lib/language-detection";
import { saveAudioHistory } from "@/lib/audio-history";
import { supabase } from "@/integrations/supabase/client";

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
  const [lastRequest, setLastRequest] = useState<Record<string, unknown> | null>(null);
  const [lastResponse, setLastResponse] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [k]: e.target.value }));
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
    setLastRequest(null);
    setLastResponse(null);
    try {
      let options: Record<string, unknown> | undefined;
      if (
        !quickRequest &&
        form.provider !== "google" &&
        form.provider !== "auto" &&
        form.options.trim()
      ) {
        try {
          options = JSON.parse(form.options);
        } catch {
          throw new Error("options is not valid JSON");
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
      setLastRequest({
        method: "POST",
        url: "/api/public/tts",
        body: { ...body, ...(body["api_key"] ? { api_key: "[redacted]" } : {}) },
      });
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
      const res = await fetch("/api/public/tts", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const responseText = await res.text();
        let responseBody: unknown = responseText;
        let message = `Request failed (${res.status})`;
        try {
          responseBody = JSON.parse(responseText);
          if (responseBody && typeof responseBody === "object" && "error" in responseBody) {
            const error = responseBody["error"];
            message = typeof error === "string" ? error : JSON.stringify(error);
          }
        } catch {
          if (responseText) message = responseText;
        }
        setLastResponse({
          status: res.status,
          statusText: res.statusText,
          contentType: res.headers.get("Content-Type"),
          body: responseBody,
        });
        throw new Error(message);
      }
      const blob = await res.blob();
      setAudio(URL.createObjectURL(blob));
      const responseTimeHeader = res.headers.get("X-Response-Time-Ms");
      const responseTimeMs =
        responseTimeHeader === null
          ? Math.round(performance.now() - requestStartedAt)
          : Number(responseTimeHeader);
      const spokenLanguage = res.headers.get("X-Spoken-Lang") || form.lang;
      try {
        await saveAudioHistory({
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          provider: res.headers.get("X-Provider") || form.provider,
          language: spokenLanguage,
          responseTimeMs: Number.isFinite(responseTimeMs)
            ? responseTimeMs
            : Math.round(performance.now() - requestStartedAt),
          audioBytes: blob.size,
          inputChars: String(body["text"] ?? "").length,
          cached: res.headers.get("X-Cache") === "HIT",
          ...(res.headers.has("X-Provider-Input-Tokens")
            ? { providerInputTokens: Number(res.headers.get("X-Provider-Input-Tokens")) }
            : {}),
          ...(res.headers.has("X-Provider-Output-Tokens")
            ? { providerOutputTokens: Number(res.headers.get("X-Provider-Output-Tokens")) }
            : {}),
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
      let spokenText = res.headers.get("X-Spoken-Text") || "";
      try {
        spokenText = decodeURIComponent(spokenText);
      } catch {
        // Keep the raw header if it is not URI-encoded.
      }
      setLastResponse({
        status: res.status,
        statusText: res.statusText,
        contentType: blob.type || res.headers.get("Content-Type"),
        spokenLanguage,
        cache: res.headers.get("X-Cache"),
        audioBytes: blob.size,
        spokenText,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setInfo(message);
      setLastResponse((current) => current ?? { error: message });
    } finally {
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
            onChange={set("provider")}
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
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => void run(quickSamples.fr)}
          >
            <Play aria-hidden="true" size={14} />
            Speak French
          </button>
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => void run(quickSamples.it)}
          >
            <Play aria-hidden="true" size={14} />
            Speak Italian
          </button>
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
        <details className="rounded-lg border border-border px-3 py-3">
          <summary className="cursor-pointer text-sm font-medium">Advanced settings</summary>
          <div className="mt-3 space-y-3">
            {form.provider !== "auto" && form.provider !== "google" && (
              <label className="block text-xs text-muted-foreground">
                {form.provider === "deepgram" ? "Aura model (optional)" : "Voice (optional)"}
                <input
                  className={`${field} mt-1`}
                  placeholder={
                    form.provider === "deepgram"
                      ? "Use language default, e.g. aura-2-thalia-en"
                      : "Use provider default"
                  }
                  value={form.voice}
                  onChange={set("voice")}
                />
              </label>
            )}
            {form.provider === "openrouter" && (
              <>
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
              form.provider !== "openrouter" && (
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
        <button
          onClick={() => void run()}
          disabled={busy}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {busy ? "Generating…" : "Generate audio"}
        </button>
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
            {historyWarning && (
              <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
                {historyWarning}
              </p>
            )}
          </div>
        )}
        {audio && <audio className="w-full" controls src={audio} />}
        {lastRequest && (
          <section className="border-t border-border pt-4">
            <h2 className="text-sm font-semibold">Request sent</h2>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
              {JSON.stringify(lastRequest, null, 2)}
            </pre>
          </section>
        )}
        {lastResponse && (
          <section className="border-t border-border pt-4">
            <h2 className="text-sm font-semibold">Response</h2>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
              {JSON.stringify(lastResponse, null, 2)}
            </pre>
          </section>
        )}
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
