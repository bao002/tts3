import type { Database } from "@/integrations/supabase/types";

export const QUARANTINE_AFTER = 10;
export const QUARANTINE_MS = 15 * 60 * 1000;
export const KEY_SERVICES = [
  "openrouter",
  "lovable",
  "gemini",
  "openai",
  "elevenlabs",
  "deepgram",
] as const;
export type KeyService = (typeof KEY_SERVICES)[number];
type Row = Database["public"]["Tables"]["provider_api_keys"]["Row"];
type UserRow = Database["public"]["Tables"]["user_provider_api_keys"]["Row"];
const encoder = new TextEncoder();
export function hasSupabaseAdminConfig() {
  return Boolean(process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"]);
}
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const base64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

async function encryptionKey() {
  const secret = process.env["OPENROUTER_KEY_ENCRYPTION_SECRET"];
  if (!secret) throw new Error("Key encryption is not configured");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptProviderKey(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const result = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    encoder.encode(value),
  );
  return `${base64(iv)}.${base64(new Uint8Array(result))}`;
}
export async function decryptKey(row: Pick<Row, "ciphertext"> | Pick<UserRow, "ciphertext">) {
  const [iv, ciphertext] = row.ciphertext.split(".");
  if (!iv || !ciphertext) throw new Error("Invalid encrypted key");
  const result = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes(iv) },
    await encryptionKey(),
    bytes(ciphertext),
  );
  return new TextDecoder().decode(result);
}
export async function fingerprintProviderKey(value: string) {
  // Internal keyed digest for deduplication; never returned to clients.
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(process.env["OPENROUTER_KEY_ENCRYPTION_SECRET"] || ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}
export function environmentKeys(service: KeyService = "openrouter") {
  const names: Record<KeyService, string> = {
    openrouter: "OPENROUTER",
    lovable: "LOVABLE",
    gemini: "GEMINI",
    openai: "OPENAI",
    elevenlabs: "ELEVENLABS",
    deepgram: "DEEPGRAM",
  };
  const name = names[service];
  const values = [
    process.env[`${name}_API_KEY`] || "",
    ...(process.env[`${name}_API_KEYS`] || "").split(/[\s,]+/),
  ];
  return [...new Set(values.map((k) => k.trim()).filter(Boolean))];
}
export async function authorizeManagement(request: Request) {
  const supplied = request.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
  const allowed = [
    process.env["PROVIDER_MANAGEMENT_TOKEN"] || process.env["OPENROUTER_MANAGEMENT_TOKEN"] || "",
    ...KEY_SERVICES.flatMap(environmentKeys),
  ].filter(Boolean);
  if (!supplied || !allowed.length) return false;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(supplied)));
  for (const value of allowed) {
    const expected = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
    let difference = 0;
    for (let i = 0; i < digest.length; i++) difference |= (digest[i] ?? 0) ^ (expected[i] ?? 0);
    if (difference === 0) return true;
  }
  return false;
}
export function addKey(value: string, source?: string): Promise<boolean>;
export function addKey(service: KeyService, value: string, source?: string): Promise<boolean>;
export async function addKey(serviceOrValue: string, valueOrSource = "saved", source = "saved") {
  const hasService = (KEY_SERVICES as readonly string[]).includes(serviceOrValue);
  const service: KeyService = hasService ? (serviceOrValue as KeyService) : "openrouter";
  const value = hasService ? valueOrSource : serviceOrValue;
  const keySource = hasService ? source : valueOrSource;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const key = value.trim();
  const { error } = await supabaseAdmin.from("provider_api_keys").insert({
    service,
    fingerprint: await fingerprintProviderKey(key),
    ciphertext: await encryptProviderKey(key),
    source: keySource,
  });
  if (error?.code === "23505") return false;
  if (error) throw new Error("Could not save provider key");
  return true;
}
export async function poolRows(service?: KeyService) {
  const services: readonly KeyService[] = service ? [service] : KEY_SERVICES;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const environmentRows = await Promise.all(
    services.flatMap((current) =>
      environmentKeys(current).map(async (key) => ({
        service: current,
        fingerprint: await fingerprintProviderKey(key),
        ciphertext: await encryptProviderKey(key),
        source: "env",
      })),
    ),
  );
  if (environmentRows.length) {
    const { error: syncError } = await supabaseAdmin
      .from("provider_api_keys")
      .upsert(environmentRows, {
        onConflict: "service,fingerprint",
        ignoreDuplicates: true,
      });
    if (syncError) throw new Error("Could not synchronize provider keys");
  }
  const base = supabaseAdmin.from("provider_api_keys").select("*");
  const query = service ? base.eq("service", service) : base;
  const { data, error } = await query.order("created_at");
  if (error) throw new Error("Could not load provider keys");
  return data || [];
}
export function publicKey(row: Row) {
  const until = row.quarantined_until ? Date.parse(row.quarantined_until) : undefined;
  return {
    id: row.id,
    service: row.service,
    key: "Configured key",
    source: row.source,
    status:
      until && until > Date.now()
        ? "quarantined"
        : row.status === "quarantined"
          ? "unknown"
          : row.status,
    code: row.code,
    failures: row.failures,
    lastUsed: row.last_used ? Date.parse(row.last_used) : undefined,
    quarantinedUntil: until,
  };
}
export async function listKeys(service?: KeyService) {
  return (await poolRows(service)).map(publicKey);
}
export async function reserveKey(service: KeyService, excluded: string[] = []) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("reserve_provider_key", {
    service_name: service,
    excluded_keys: excluded,
  });
  if (error) throw new Error("Could not reserve provider keys");
  return { key: data?.[0] || null };
}
export async function reserveAnyKey(excluded: string[] = []) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("reserve_any_provider_key", {
    excluded_keys: excluded,
  });
  if (error) throw new Error("Could not reserve a provider key");
  return data?.[0] || null;
}
export async function markKey(id: string, code: number) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc("mark_provider_key", {
    key_id: id,
    response_code: code,
  });
  if (error) throw new Error("Could not save provider key status");
}
export async function removeKey(id: string, service?: KeyService) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let query = supabaseAdmin.from("provider_api_keys").delete().eq("id", id).neq("source", "env");
  if (service) query = query.eq("service", service);
  const { data, error } = await query.select("id");
  if (error) throw new Error("Could not remove OpenRouter key");
  return Boolean(data?.length);
}
export async function addUserKey(userId: string, service: KeyService, value: string) {
  const key = value.trim();
  if (!key) throw new Error("Provider key is required");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("user_provider_api_keys").insert({
    user_id: userId,
    service,
    fingerprint: await fingerprintProviderKey(key),
    ciphertext: await encryptProviderKey(key),
  });
  if (error?.code === "23505") return false;
  if (error) throw new Error("Could not save provider key");
  return true;
}
export async function listUserKeys(userId: string) {
  return Promise.all(
    (await userKeyRows(userId)).map(async (row) => {
      const key = await decryptKey(row);
      const quarantined = row.quarantined_until && Date.parse(row.quarantined_until) > Date.now();
      return {
        id: row.id,
        service: row.service,
        key_suffix: key.slice(-4),
        status: quarantined
          ? "quarantined"
          : row.status === "unknown" && row.failures === 0 && row.code === null
            ? "untested"
            : row.status === "quarantined"
              ? "unknown"
              : row.status,
        failures: row.failures,
        code: row.code,
        created_at: row.created_at,
        last_used: row.last_used,
        quarantined_until: row.quarantined_until,
      };
    }),
  );
}
export async function userKeyRows(userId: string, service?: KeyService) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const base = supabaseAdmin.from("user_provider_api_keys").select("*").eq("user_id", userId);
  const query = service ? base.eq("service", service) : base;
  const { data, error } = await query.order("created_at");
  if (error) throw new Error("Could not load your provider keys");
  return data || [];
}
export async function removeUserKey(userId: string, id: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_provider_api_keys")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .select("id");
  if (error) throw new Error("Could not remove provider key");
  return Boolean(data?.length);
}
export async function reserveUserKey(userId: string, service: KeyService, excluded: string[] = []) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("reserve_user_provider_key", {
    owner_id: userId,
    service_name: service,
    excluded_keys: excluded,
  });
  if (error) throw new Error("Could not reserve your provider key");
  return data?.[0] || null;
}
export async function reserveAnyUserKey(userId: string, excluded: string[] = []) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("reserve_any_user_provider_key", {
    owner_id: userId,
    excluded_keys: excluded,
  });
  if (error) throw new Error("Could not reserve one of your provider keys");
  return data?.[0] || null;
}
export async function markUserKey(
  userId: string,
  id: string,
  code: number,
  action: "request" | "test" = "request",
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc("mark_user_provider_key", {
    owner_id: userId,
    key_id: id,
    response_code: code,
    action_name: action,
  });
  if (error) throw new Error("Could not update your provider key status");
}

export async function listUserProviderKeyEvents(userId: string, limit = 200) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_provider_key_events")
    .select("id, key_id, occurred_at, action, response_code")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .limit(Math.max(1, Math.min(500, limit)));
  if (error) throw new Error("Could not load your provider key history");
  return data || [];
}

export async function testUserProviderKey(userId: string, id: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await supabaseAdmin
    .from("user_provider_api_keys")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Could not load your provider key");
  if (!row || !KEY_SERVICES.includes(row.service as KeyService)) {
    return { valid: false, status: "not_found", message: "Provider key not found." };
  }

  const key = await decryptKey(row);
  const endpoints: Record<KeyService, { url: string; headers: (key: string) => HeadersInit }> = {
    openrouter: {
      url: "https://openrouter.ai/api/v1/key",
      headers: (value) => ({ Authorization: `Bearer ${value}` }),
    },
    lovable: {
      url: "https://ai.gateway.lovable.dev/v1/models",
      headers: (value) => ({ Authorization: `Bearer ${value}` }),
    },
    gemini: {
      url: "https://generativelanguage.googleapis.com/v1beta/models",
      headers: (value) => ({ "x-goog-api-key": value }),
    },
    openai: {
      url: "https://api.openai.com/v1/models",
      headers: (value) => ({ Authorization: `Bearer ${value}` }),
    },
    elevenlabs: {
      url: "https://api.elevenlabs.io/v1/user",
      headers: (value) => ({ "xi-api-key": value }),
    },
    deepgram: {
      url: "https://api.deepgram.com/v1/projects",
      headers: (value) => ({ Authorization: `Token ${value}` }),
    },
  };
  const provider = row.service as KeyService;
  const endpoint = endpoints[provider];
  let response: Response;
  try {
    response = await fetch(endpoint.url, {
      headers: endpoint.headers(key),
    });
  } catch {
    await markUserKey(userId, id, 599, "test");
    return {
      valid: false,
      status: "unreachable",
      service: provider,
      message: `Could not reach ${provider} to test this key. Try again later.`,
    };
  }

  if (!response.ok) {
    await response.body?.cancel();
    await markUserKey(userId, id, response.status, "test");
    const invalid = response.status === 401 || response.status === 403;
    return {
      valid: false,
      status: invalid ? "invalid" : "unavailable",
      service: provider,
      http_status: response.status,
      message: invalid
        ? `${provider} rejected this key.`
        : `${provider} key check failed (HTTP ${response.status}).`,
    };
  }

  let account: Record<string, unknown> | undefined;
  let status = "valid";
  if (provider === "openrouter") {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    const data =
      typeof payload === "object" && payload !== null && "data" in payload
        ? payload.data
        : undefined;
    account =
      typeof data === "object" && data !== null
        ? Object.fromEntries(
            ["label", "limit", "limit_remaining", "usage", "is_free_tier", "rate_limit"]
              .filter((name) => name in data)
              .map((name) => [name, Reflect.get(data, name)]),
          )
        : undefined;
    if (!account) status = "valid_status_unavailable";
  } else {
    await response.body?.cancel();
  }
  await markUserKey(userId, id, response.status, "test");
  return {
    valid: true,
    status,
    service: provider,
    ...(account ? { account } : {}),
    ...(!account ? { message: `${provider} accepted this API key.` } : {}),
  };
}
export async function resetKey(id: string, service?: KeyService) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let query = supabaseAdmin
    .from("provider_api_keys")
    .update({ status: "unknown", code: null, failures: 0, quarantined_until: null })
    .eq("id", id);
  if (service) query = query.eq("service", service);
  const { data, error } = await query.select("id");
  if (error) throw new Error("Could not reset OpenRouter status");
  return Boolean(data?.length);
}
