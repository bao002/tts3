// Gemini returns mono 16-bit PCM inside JSON, not a playable audio file.
export function geminiAudioBlob(value: unknown): Blob {
  const result = value as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
  };
  const parts = result?.candidates?.[0]?.content?.parts
    ?.flatMap((part) => typeof part.inlineData?.data === "string" ? [part.inlineData] : []) ?? [];
  if (!parts.length) throw new Error("Gemini returned no audio data");
  const rate = Number(parts[0]?.mimeType?.match(/rate=(\d+)/)?.[1] ?? 24000);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 192000) throw new Error("Invalid Gemini audio sample rate");
  const chunks = parts.map((part) => Uint8Array.from(atob(part.data ?? ""), (c) => c.charCodeAt(0)));
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + length);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + length, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, length, true);
  const bytes = new Uint8Array(buffer);
  let offset = 44;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new Blob([buffer], { type: "audio/wav" });
}