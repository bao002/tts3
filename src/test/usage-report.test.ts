import { beforeEach, describe, expect, it } from "vitest";
import { history } from "@/lib/monitor.server";
import { getInMemoryUsageReport } from "@/lib/usage-report.server";

beforeEach(() => {
  history.length = 0;
});

describe("process-local usage reports", () => {
  it("returns metrics grouped by actual provider and scopes temporary tokens", () => {
    const now = new Date().toISOString();
    history.push(
      {
        at: now,
        method: "POST",
        provider: "openai",
        userId: "memory:token-owner",
        lang: "en",
        status: 200,
        ms: 120,
        bytes: 4096,
        cached: false,
        inputChars: 20,
        outputChars: 18,
        estimatedInputTokens: 5,
        providerInputTokens: 7,
        providerOutputTokens: 8,
      },
      {
        at: now,
        method: "POST",
        provider: "gemini",
        userId: "memory:other-owner",
        lang: "fr",
        status: 429,
        ms: 300,
        bytes: 0,
        cached: false,
        error: "quota",
        inputChars: 12,
        estimatedInputTokens: 3,
      },
    );

    const report = getInMemoryUsageReport(24, "memory:token-owner");
    expect(report).toMatchObject({
      window_hours: 24,
      storage: "in-memory",
      totals: {
        requests: 1,
        successful: 1,
        failed: 0,
        audio_bytes: 4096,
        input_chars: 20,
        provider_input_tokens: 7,
        provider_output_tokens: 8,
        avg_duration_ms: 120,
      },
      services: [{ service: "openai", requests: 1 }],
    });
  });

  it("returns process-wide in-memory metrics when no token scope is requested", () => {
    const now = new Date().toISOString();
    history.push(
      {
        at: now,
        method: "POST",
        provider: "openai",
        lang: "en",
        status: 200,
        ms: 100,
        bytes: 100,
        cached: false,
      },
      {
        at: now,
        method: "POST",
        provider: "openai",
        lang: "en",
        status: 429,
        ms: 200,
        bytes: 0,
        cached: false,
      },
    );

    expect(getInMemoryUsageReport(24).totals).toMatchObject({
      requests: 2,
      successful: 1,
      failed: 1,
      audio_bytes: 100,
      avg_duration_ms: 150,
    });
  });
});
