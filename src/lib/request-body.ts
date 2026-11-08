export class RequestBodyError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function readJsonBody(request: Request, maximumBytes = 65_536): Promise<unknown> {
  if (Number(request.headers.get("Content-Length")) > maximumBytes) {
    throw new RequestBodyError("Request body is too large", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError("Invalid JSON body", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new RequestBodyError("Request body is too large", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new RequestBodyError("Invalid JSON body", 400); }
}