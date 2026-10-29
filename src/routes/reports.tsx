import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { listAudioHistory, type AudioHistoryRecord } from "@/lib/audio-history";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Usage reports — Speak API" },
      {
        name: "description",
        content: "Provider request, latency, audio, cache, and token statistics.",
      },
    ],
  }),
  component: Reports,
});

type ServiceReport = {
  service: string;
  requests: number;
  successful: number;
  failed: number;
  cached: number;
  audio_bytes: number;
  input_chars: number;
  output_chars: number;
  estimated_input_tokens: number;
  provider_input_tokens: number;
  provider_output_tokens: number;
  avg_duration_ms: number;
};
type Report = {
  window_hours: number;
  totals: Omit<ServiceReport, "service">;
  services: ServiceReport[];
};
type PlayableAudio = AudioHistoryRecord & { audioUrl: string };

function Reports() {
  const [audioHistory, setAudioHistory] = useState<PlayableAudio[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [token, setToken] = useState("");
  const [hours, setHours] = useState("24");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    const audioUrls: string[] = [];

    void listAudioHistory()
      .then((records) => {
        if (disposed) return;
        const playable = records.map((record) => {
          const audioUrl = URL.createObjectURL(record.audio);
          audioUrls.push(audioUrl);
          return { ...record, audioUrl };
        });
        setAudioHistory(playable);
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setHistoryError(
            reason instanceof Error ? reason.message : "Could not load browser audio history.",
          );
        }
      })
      .finally(() => {
        if (!disposed) setHistoryLoading(false);
      });

    return () => {
      disposed = true;
      audioUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  async function load(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/report/usage?hours=${encodeURIComponent(hours)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Report request failed");
      setReport(body as Report);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setReport(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 text-foreground">
      <nav className="flex gap-4 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Back
        </Link>
        <Link to="/openrouter" className="hover:text-foreground">
          Provider keys
        </Link>
      </nav>
      <h1 className="mt-5 text-2xl font-semibold">Usage reports</h1>
      <section className="mt-7">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Generated audio history</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Audio is saved in this browser only. Up to 100 recent records are kept, within a 50 MB
              storage limit.
            </p>
          </div>
          <span className="text-sm text-muted-foreground">{audioHistory.length} records</span>
        </div>
        {historyError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {historyError}
          </p>
        )}
        {historyLoading ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading saved audio…
          </p>
        ) : !historyError && audioHistory.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border p-4 text-sm text-muted-foreground">
            No saved audio yet. Generate speech in the playground and it will appear here.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
              <thead className="bg-muted/50">
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Generated
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Audio
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Provider
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Response time
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Balance left
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Reported tokens in / out
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Language
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Text chars
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Audio / cache
                  </th>
                </tr>
              </thead>
              <tbody>
                {audioHistory.map((record) => (
                  <tr key={record.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-3 py-3">
                      <time dateTime={record.createdAt}>
                        {new Date(record.createdAt).toLocaleString()}
                      </time>
                    </td>
                    <td className="px-3 py-3">
                      <audio
                        aria-label={`Play ${record.provider} audio generated ${new Date(record.createdAt).toLocaleString()}`}
                        className="w-60"
                        controls
                        preload="none"
                        src={record.audioUrl}
                      />
                    </td>
                    <td className="px-3 py-3 font-medium capitalize">{record.provider}</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                      {record.responseTimeMs} ms
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">Not reported</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                      {record.providerInputTokens ?? "—"} / {record.providerOutputTokens ?? "—"}
                    </td>
                    <td className="px-3 py-3">{record.language}</td>
                    <td className="px-3 py-3 tabular-nums">{record.inputChars}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {formatBytes(record.audioBytes)} · {record.cached ? "cache hit" : "generated"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Providers do not return remaining account balances through synthesis responses, so the
          balance is shown as “Not reported.” Dashes indicate token usage was not returned.
        </p>
      </section>
      <form className="mt-6 flex flex-wrap items-end gap-3" onSubmit={load}>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Management token
          <input
            aria-label="Management token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="w-72 max-w-full border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Window
          <select
            aria-label="Report window"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            className="border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="24">24 hours</option>
            <option value="168">7 days</option>
            <option value="720">30 days</option>
          </select>
        </label>
        <Button type="submit" variant="outline" disabled={!token || busy}>
          {busy ? "Loading" : "Load report"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {report && (
        <section className="mt-8 overflow-x-auto">
          <h2 className="text-sm font-semibold">Last {report.window_hours} hours</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-4 sm:grid-cols-4">
            <Metric label="Requests" value={report.totals.requests} />
            <Metric
              label="Succeeded / failed"
              value={`${report.totals.successful} / ${report.totals.failed}`}
            />
            <Metric label="Average duration" value={`${report.totals.avg_duration_ms} ms`} />
            <Metric label="Audio generated" value={formatBytes(report.totals.audio_bytes)} />
            <Metric
              label="Characters in / out"
              value={`${report.totals.input_chars} / ${report.totals.output_chars}`}
            />
            <Metric label="Cache hits" value={report.totals.cached} />
            <Metric label="Estimated input tokens" value={report.totals.estimated_input_tokens} />
            <Metric label="Reported input tokens" value={report.totals.provider_input_tokens} />
            <Metric label="Reported output tokens" value={report.totals.provider_output_tokens} />
          </dl>
          <table className="mt-6 w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Service</th>
                <th className="py-2 pr-4 font-medium">Requests</th>
                <th className="py-2 pr-4 font-medium">Success / failed</th>
                <th className="py-2 pr-4 font-medium">Cache hits</th>
                <th className="py-2 pr-4 font-medium">Characters in / out</th>
                <th className="py-2 pr-4 font-medium">Estimated input tokens</th>
                <th className="py-2 pr-4 font-medium">Reported tokens in / out</th>
                <th className="py-2 font-medium">Avg. ms</th>
              </tr>
            </thead>
            <tbody>
              {report.services.map((service) => (
                <tr key={service.service} className="border-b border-border">
                  <td className="py-3 pr-4 font-medium">{service.service}</td>
                  <td className="py-3 pr-4">{service.requests}</td>
                  <td className="py-3 pr-4">
                    {service.successful} / {service.failed}
                  </td>
                  <td className="py-3 pr-4">{service.cached}</td>
                  <td className="py-3 pr-4">
                    {service.input_chars} / {service.output_chars}
                  </td>
                  <td className="py-3 pr-4">{service.estimated_input_tokens}</td>
                  <td className="py-3 pr-4">
                    {service.provider_input_tokens} / {service.provider_output_tokens}
                  </td>
                  <td className="py-3">{service.avg_duration_ms}</td>
                </tr>
              ))}
              {report.services.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-5 text-muted-foreground">
                    No requests in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">
            Input tokens are estimated from spoken text. Reported token totals are included only
            when a provider returns usage data. Request text and credentials are never stored in
            this report.
          </p>
        </section>
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
