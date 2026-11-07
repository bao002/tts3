import { describe, it, expect } from "vitest";
import { resolveVoice } from "@/lib/tts.server";

describe("auto voice routing", () => {
  it("does not forward a Gemini voice to OpenRouter under auto", () => {
    expect(resolveVoice("openrouter", { voice: "Kore" }, true)).toBeUndefined();
  });
  it("forwards a Gemini voice to Gemini under auto", () => {
    expect(resolveVoice("gemini", { voice: "Kore" }, true)).toBe("Kore");
  });
  it("per-provider map wins", () => {
    expect(resolveVoice("openai", { voice: "Kore", voices: { openai: "nova" } }, true)).toBe("nova");
  });
});
