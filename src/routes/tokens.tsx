import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type ProviderKey = {
  id: string;
  service: string;
  key_suffix: string;
  status: string;
  failures: number;
  code: number | null;
  created_at: string;
  last_used: string | null;
  quarantined_until: string | null;
};
type KeyEvent = {
  id: number;
  key_id: string;
  occurred_at: string;
  action: "request" | "test";
  response_code: number;
};
type ApiToken = {
  id: string;
  label: string;
  created_at: string;
  last_used: string | null;
  revoked_at: string | null;
};
type TokenData = { keys: ProviderKey[]; history: KeyEvent[]; tokens: ApiToken[] };

const providerNames: Record<string, string> = {
  openrouter: "OpenRouter",
  lovable: "Lovable AI",
  gemini: "Google Gemini",
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
  deepgram: "Deepgram",
};
const providerLimits: Record<string, string> = {
  openrouter:
    "Key status and account usage/remaining limits may be returned by OpenRouter. Model-specific limits still apply.",
  lovable: "Authentication only; this view cannot retrieve billing, credit, or rate-limit details.",
  gemini: "Authentication only; quota, billing, and model access are controlled by Google.",
  openai:
    "Authentication only; billing, project budgets, rate limits, and model permissions are not checked.",
  elevenlabs:
    "Authentication only; subscription, character quota, and rate limits are not checked.",
  deepgram: "Authentication only; balance, project quota, and rate limits are not checked.",
};

function isAvailable(key: ProviderKey) {
  return key.status !== "blocked" && key.status !== "quarantined";
}

function availabilityLabel(key: ProviderKey) {
  if (key.status === "blocked") {
    return `Blocked${key.code ? ` (last HTTP ${key.code})` : ""} — test the key or replace it`;
  }
  if (key.status === "quarantined") {
    return key.quarantined_until
      ? `Quarantined until ${new Date(key.quarantined_until).toLocaleString()}`
      : "Quarantined";
  }
  if (key.status === "untested") return "Available — not tested yet";
  if (key.status === "error") return "Available — last request failed";
  return "Available";
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

export const Route = createFileRoute("/tokens")({
  head: () => ({
    meta: [
      { title: "Tokens and provider key activity — Speak API" },
      {
        name: "description",
        content: "Review personal API tokens, provider key availability, and recent key activity.",
      },
    ],
  }),
  component: Tokens,
});

function Tokens() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [authUnavailable, setAuthUnavailable] = useState("");
  const [data, setData] = useState<TokenData>({ keys: [], history: [], tokens: [] });
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    try {
      const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        if (active) setSession(nextSession);
      });
      unsubscribe = () => data.subscription.unsubscribe();
      void supabase.auth
        .getSession()
        .then(({ data: sessionData }) => {
          if (active) {
            setSession(sessionData.session);
            setLoadingSession(false);
          }
        })
        .catch((reason: unknown) => {
          if (active) {
            setError(reason instanceof Error ? reason.message : String(reason));
            setLoadingSession(false);
          }
        });
    } catch (reason) {
      setAuthUnavailable(reason instanceof Error ? reason.message : String(reason));
      setLoadingSession(false);
    }
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!session?.access_token) {
      setData({ keys: [], history: [], tokens: [] });
      return;
    }
    let active = true;
    setLoadingData(true);
    setError("");
    const headers = { Authorization: `Bearer ${session.access_token}` };
    void Promise.all([
      fetch("/api/user/provider-keys", { headers }),
      fetch("/api/user/token", { headers }),
    ])
      .then(async ([keysResponse, tokenResponse]) => {
        const [keysBody, tokenBody] = await Promise.all([
          keysResponse.json(),
          tokenResponse.json(),
        ]);
        if (!keysResponse.ok) throw new Error(keysBody.error || "Could not load provider keys");
        if (!tokenResponse.ok) throw new Error(tokenBody.error || "Could not load API tokens");
        if (active) {
          setData({
            keys: keysBody.keys as ProviderKey[],
            history: keysBody.history as KeyEvent[],
            tokens: tokenBody.tokens as ApiToken[],
          });
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoadingData(false);
      });
    return () => {
      active = false;
    };
  }, [session?.access_token]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 text-foreground">
      <nav className="flex gap-4 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Back to speech
        </Link>
        <Link to="/account" className="hover:text-foreground">
          Account and keys
        </Link>
        <Link to="/reports" className="hover:text-foreground">
          Usage
        </Link>
      </nav>
      <h1 className="mt-5 text-2xl font-semibold">Tokens and key activity</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Personal credentials only. Server-managed keys are not visible from this account page.
      </p>
      {loadingSession ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading account…</p>
      ) : authUnavailable ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          Account tokens and saved provider keys require Supabase. Public speech requests remain
          available. {authUnavailable}
        </p>
      ) : !session ? (
        <section className="mt-6 border border-border p-4">
          <p className="text-sm">Sign in to review your saved provider keys and personal tokens.</p>
          <Button asChild className="mt-3">
            <Link to="/account">Sign in or create an account</Link>
          </Button>
        </section>
      ) : (
        <>
          {loadingData && (
            <p className="mt-4 text-sm text-muted-foreground">Loading key details…</p>
          )}
          <section className="mt-8">
            <h2 className="text-base font-semibold">Personal API tokens</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tokens authenticate API requests; they do not include provider credits. Requests use
              your saved provider keys. Only token metadata is shown; token secrets cannot be
              retrieved.
            </p>
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {data.tokens.length === 0 && (
                <li className="py-3 text-sm text-muted-foreground">No personal tokens yet.</li>
              )}
              {data.tokens.map((token) => (
                <li key={token.id} className="flex flex-wrap gap-x-6 gap-y-1 py-3 text-sm">
                  <span className="min-w-40 flex-1 font-medium">{token.label}</span>
                  <span
                    className={
                      token.revoked_at ? "text-destructive" : "text-green-700 dark:text-green-400"
                    }
                  >
                    {token.revoked_at ? "Revoked" : "Active"}
                  </span>
                  <span className="text-muted-foreground">
                    Created {formatTime(token.created_at)}
                  </span>
                  <span className="text-muted-foreground">
                    Last used {formatTime(token.last_used)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8 border-t border-border pt-6">
            <h2 className="text-base font-semibold">Saved provider keys</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Availability reflects this service’s routing state, not a live check of provider
              balance or quota. Select “Test key” in{" "}
              <Link to="/account" className="underline hover:text-foreground">
                Account
              </Link>{" "}
              to verify credentials.
            </p>
            {data.keys.length === 0 ? (
              <p className="mt-3 border-y border-border py-3 text-sm text-muted-foreground">
                No personal provider keys are saved.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border border-y border-border">
                {data.keys.map((key) => (
                  <li key={key.id} className="py-4">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                      <span className="min-w-32 flex-1 font-medium">
                        {providerNames[key.service] || key.service}
                      </span>
                      <code className="text-muted-foreground">••••{key.key_suffix}</code>
                      <span
                        className={
                          isAvailable(key)
                            ? "text-green-700 dark:text-green-400"
                            : "text-red-700 dark:text-red-400"
                        }
                      >
                        {availabilityLabel(key)}
                      </span>
                      <span className="text-muted-foreground">
                        Last used {formatTime(key.last_used)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {providerLimits[key.service] ||
                        "Provider billing, model access, and rate limits are not checked."}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8 border-t border-border pt-6">
            <h2 className="text-base font-semibold">Recent provider key history</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Up to 200 recent tests and synthesis attempts are shown. History begins with this
              feature; older requests cannot be attributed to an individual key. Response bodies and
              credentials are not stored.
            </p>
            {data.history.length === 0 ? (
              <p className="mt-3 border-y border-border py-3 text-sm text-muted-foreground">
                No recorded provider key activity yet.
              </p>
            ) : (
              <ol className="mt-3 divide-y divide-border border-y border-border">
                {data.history.map((event) => {
                  const key = data.keys.find((candidate) => candidate.id === event.key_id);
                  const succeeded = event.response_code >= 200 && event.response_code < 300;
                  return (
                    <li
                      key={event.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm"
                    >
                      <span className="min-w-32 flex-1">
                        {key
                          ? `${providerNames[key.service] || key.service} ••••${key.key_suffix}`
                          : "Removed provider key"}
                      </span>
                      <span className="capitalize text-muted-foreground">
                        {event.action === "test" ? "Key test" : "Synthesis"}
                      </span>
                      <span
                        className={
                          succeeded
                            ? "text-green-700 dark:text-green-400"
                            : "text-red-700 dark:text-red-400"
                        }
                      >
                        {event.response_code === 599
                          ? "Network error"
                          : `HTTP ${event.response_code}`}
                      </span>
                      <time className="text-muted-foreground" dateTime={event.occurred_at}>
                        {formatTime(event.occurred_at)}
                      </time>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </>
      )}
      {error && (
        <p role="alert" className="mt-5 border border-destructive/40 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </main>
  );
}
