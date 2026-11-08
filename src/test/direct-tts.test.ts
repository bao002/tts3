import { describe, it, expect } from "vitest";
import { buildDirectRequest, isDirectProvider, redactSecretHeaders } from "@/lib/direct-tts";
import { geminiAudioBlob } from "@/lib/gemini-audio";

describe("direct speech", () => {
  it("supports Gemini with selected voice and header-only key", () => {
    expect(isDirectProvider("gemini")).toBe(true);
    const request = buildDirectRequest({ provider: "gemini", apiKey: "test-key", text: "Hello", lang: "en", voice: "Puck" });
    expect(request.url).toContain("gemini-2.5-flash-preview-tts:generateContent");
    expect(request.url).not.toContain("test-key");
    expect(request.headers["x-goog-api-key"]).toBe("test-key");
    expect(request.body).toMatchObject({ generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } } } });
    expect(redactSecretHeaders(request.headers)["x-goog-api-key"]).toBe("[redacted]");
  });
  it("keeps Google Translate server-only", () => { expect(isDirectProvider("google")).toBe(false); });
  it("wraps Gemini PCM in a playable WAV header", async () => {
    const blob = geminiAudioBlob({ candidates: [{ content: { parts: [{ inlineData: { data: btoa("\x01\x02\x03\x04"), mimeType: "audio/L16;rate=24000" } }] } }] });
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(48);
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error("No bytes"));
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
    expect(String.fromCharCode(...new Uint8Array(buffer).slice(0, 4))).toBe("RIFF");
    expect(new DataView(buffer).getUint32(24, true)).toBe(24000);
    expect(new DataView(buffer).getUint32(40, true)).toBe(4);
  });
  it("rejects Gemini responses without audio", () => { expect(() => geminiAudioBlob({ candidates: [] })).toThrow("no audio"); });
});