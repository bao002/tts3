import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ synthesize: vi.fn(), resolveApiUser: vi.fn(), record: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (config: unknown) => config }));
vi.mock("@/lib/tts.server", () => ({ synthesize: mocks.synthesize, HttpError: class extends Error {}, bytesToB64: () => "AQID" }));
vi.mock("@/lib/user-account.server", () => ({ resolveApiUser: mocks.resolveApiUser, UserAuthError: class extends Error {} }));
vi.mock("@/lib/monitor.server", () => ({ record: mocks.record, cacheGet: () => undefined, cacheSet: vi.fn() }));
import { Route } from "@/routes/api/public/tts";
const handlers = (Route as unknown as { server: { handlers: Record<string, (context: { request: Request }) => Promise<Response>> } }).server.handlers;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveApiUser.mockResolvedValue(null);
  mocks.synthesize.mockResolvedValue({ audio: new Uint8Array([1, 2, 3]), mime: "audio/mpeg", text: "Hello", lang: "en", provider: "google" });
});

async function post(body: unknown, query = "") {
  return handlers.POST({ request: new Request(`https://example.com/api/public/tts${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
}

describe("custom TTS requests", () => {
  it("allows Google without Authorization", async () => {
    const response = await post({ text: "Hello", lang: "en", provider: "google" });
    expect(response.status).toBe(200);
    expect(mocks.resolveApiUser.mock.calls[0][0].headers.has("Authorization")).toBe(false);
    expect(mocks.synthesize).toHaveBeenCalledWith(expect.objectContaining({ provider: "google", userId: undefined }));
  });
  it("accepts debug=on in the POST query and reports the actual provider and audio details", async () => {
    const response = await post({ text: "Hello", lang: "en", debug: false }, "?debug=on");
    expect(await response.json()).toMatchObject({ provider: "google", debug: { provider: "google", audio_bytes: 3, cached: false, lang: "en", mime: "audio/mpeg", response_time_ms: expect.any(Number) }, server_log: { provider_calls: [] } });
  });
  it("passes only the requested provider choices and scoped settings", async () => {
    await post({ text: "Hello", lang: "en", providers: ["openai", "google"], provider_options: { openai: { model: "gpt-4o-mini-tts" } } });
    expect(mocks.synthesize).toHaveBeenCalledWith(expect.objectContaining({ providers: ["openai", "google"], providerOptions: { openai: { model: "gpt-4o-mini-tts" } } }));
  });
  it("rejects unknown providers", async () => {
    expect((await post({ text: "Hello", lang: "en", providers: ["unknown"] })).status).toBe(400);
    expect(mocks.synthesize).not.toHaveBeenCalled();
  });
  it("accepts comma-separated provider choices on GET", async () => {
    const response = await handlers.GET({ request: new Request("https://example.com/api/public/tts?text=Hello&lang=en&providers=openai,google&debug=on") });
    expect(response.status).toBe(200);
    expect(mocks.synthesize).toHaveBeenCalledWith(expect.objectContaining({ providers: ["openai", "google"] }));
  });
});