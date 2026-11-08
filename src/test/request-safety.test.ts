import { describe, it, expect } from "vitest";
import { redactBody, redactHeaders, redactUrl, isRequestObject } from "@/lib/request-safety";
import { readJsonBody } from "@/lib/request-body";

describe("request safety", () => {
  it("hides all credentials in incoming trace headers", () => {
    expect(redactHeaders({ Cookie: "session-secret", "X-Provider-API-Key": "provider-secret", Authorization: "Bearer secret", "Set-Cookie": "private-cookie" })).toEqual({
      cookie: "[redacted]", "x-provider-api-key": "[redacted]", authorization: "[redacted]", "set-cookie": "[redacted]",
    });
  });
  it("hides URL credentials and query keys regardless of casing", () => {
    const safe = redactUrl("https://user:password@example.com/tts?API_KEY=provider-secret&access_token=token-secret&lang=en");
    expect(safe).not.toContain("provider-secret");
    expect(safe).not.toContain("token-secret");
    expect(safe).not.toContain("password");
    expect(new URL(safe).searchParams.get("lang")).toBe("en");
  });
  it("recursively redacts credential fields", () => {
    expect(redactBody({ options: { api_key: "private" }, items: [{ token: "private" }] })).toEqual({ options: { api_key: "[redacted]" }, items: [{ token: "[redacted]" }] });
  });
  it("rejects null and array request bodies", () => {
    expect(isRequestObject(null)).toBe(false);
    expect(isRequestObject([])).toBe(false);
    expect(isRequestObject({ text: "Hello" })).toBe(true);
  });
  it("rejects oversized streamed JSON even without content length", async () => {
    const request = new Request("https://example.com", { method: "POST", body: JSON.stringify({ text: "a".repeat(65_536) }) });
    await expect(readJsonBody(request)).rejects.toMatchObject({ status: 413 });
  });
  it("parses valid JSON within the body limit", async () => {
    await expect(readJsonBody(new Request("https://example.com", { method: "POST", body: '{"text":"Hello"}' }))).resolves.toEqual({ text: "Hello" });
  });
});