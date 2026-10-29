import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveMemoryAccessToken } from "@/lib/memory-api-tokens.server";

const encoder = new TextEncoder();

export class UserAuthError extends Error {
  status = 401;

  constructor() {
    super("Authentication required");
  }
}

function tokenSecret() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function tokenHash(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function supabaseUserId(jwt: string) {
  if (jwt.split(".").length !== 3) return null;
  const { data, error } = await supabaseAdmin.auth.getClaims(jwt);
  const userId = data?.claims?.sub;
  return error || typeof userId !== "string" ? null : userId;
}

export async function requireSupabaseUser(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new UserAuthError();
  const userId = await supabaseUserId(authorization.slice(7));
  if (!userId) throw new UserAuthError();
  return userId;
}

export async function resolveApiUser(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  if (token.startsWith("spt_")) {
    const memoryToken = await resolveMemoryAccessToken(token);
    if (!memoryToken) throw new UserAuthError();
    return memoryToken.userId;
  }
  if (token.startsWith("spk_")) {
    const match = /^spk_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token);
    const id = match?.[1];
    if (!id) throw new UserAuthError();
    const { data, error } = await supabaseAdmin.from("user_api_tokens")
      .select("user_id, token_hash")
      .eq("id", id)
      .is("revoked_at", null)
      .maybeSingle();
    if (error || !data || !constantTimeEqual(data.token_hash, await tokenHash(token))) throw new UserAuthError();
    await supabaseAdmin.from("user_api_tokens").update({ last_used: new Date().toISOString() }).eq("id", id);
    return data.user_id;
  }
  const userId = await supabaseUserId(token);
  if (!userId) throw new UserAuthError();
  return userId;
}

export async function createUserApiToken(userId: string, label = "External agent") {
  const id = crypto.randomUUID();
  const token = `spk_${id}.${tokenSecret()}`;
  const { error } = await supabaseAdmin.from("user_api_tokens").insert({
    id,
    user_id: userId,
    token_hash: await tokenHash(token),
    label: label.trim().slice(0, 80) || "External agent",
  });
  if (error) throw new Error("Could not create API token");
  return { id, token };
}

export async function listUserApiTokens(userId: string) {
  const { data, error } = await supabaseAdmin.from("user_api_tokens")
    .select("id, label, created_at, last_used, revoked_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Could not list API tokens");
  return data || [];
}

export async function revokeUserApiToken(userId: string, id: string) {
  const { data, error } = await supabaseAdmin.from("user_api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", id)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new Error("Could not revoke API token");
  return Boolean(data?.length);
}
