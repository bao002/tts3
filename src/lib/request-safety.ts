const SECRET_NAME = /^(authorization|proxy-authorization|cookie|set-cookie|(?:x-)?(?:provider-)?api[-_]?key|xi-api-key|x-goog-api-key|key|token|access_token|refresh_token)$/i;

export function redactUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (SECRET_NAME.test(key)) parsed.searchParams.set(key, "[redacted]");
    }
    return parsed.toString();
  } catch {
    return "[invalid URL]";
  }
}

export function redactHeaders(headers: HeadersInit | undefined) {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    result[key] = SECRET_NAME.test(key) ? "[redacted]" : value;
  });
  return result;
}

export function redactBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactBody);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, SECRET_NAME.test(key) ? "[redacted]" : redactBody(item),
    ]));
  }
  return value;
}

export function isRequestObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}