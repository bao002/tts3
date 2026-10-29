import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";

const state = vi.hoisted(() => ({
  tokens: new Map<string, Record<string, unknown>>(),
  claimsError: null as Error | null,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: {
      getClaims: async () => ({ data: { claims: null }, error: state.claimsError || new Error("invalid JWT") }),
    },
    from: (table: string) => {
      let selectedId = "";
      let userId = "";
      let requireUnrevoked = false;
      let updateValues: Record<string, unknown> | null = null;
      const query = {
        insert: async (row: Record<string, unknown>) => {
          if (table === "user_api_tokens") state.tokens.set(String(row["id"]), { revoked_at: null, ...row });
          return { error: null };
        },
        select: () => {
          if (updateValues) {
            const row = state.tokens.get(selectedId);
            if (row && row["user_id"] === userId && (!requireUnrevoked || row["revoked_at"] === null)) {
              Object.assign(row, updateValues);
              return Promise.resolve({ data: [{ id: selectedId }], error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }
          return query;
        },
        eq: (column: string, value: string) => {
          if (column === "user_id") userId = value;
          if (column === "id") {
            selectedId = value;
            const row = state.tokens.get(selectedId);
            if (row && updateValues && !("revoked_at" in updateValues)) Object.assign(row, updateValues);
          }
          return query;
        },
        is: (column: string, value: null) => {
          if (column === "revoked_at" && value === null) requireUnrevoked = true;
          return query;
        },
        maybeSingle: async () => {
          const row = state.tokens.get(selectedId);
          return { data: row && (!requireUnrevoked || row["revoked_at"] === null) ? row : null, error: null };
        },
        update: (values: Record<string, unknown>) => {
          updateValues = values;
          return query;
        },
        order: async () => ({ data: Array.from(state.tokens.values()), error: null }),
      };
      return query;
    },
  },
}));

import { createUserApiToken, listUserApiTokens, resolveApiUser, revokeUserApiToken, UserAuthError } from "@/lib/user-account.server";
import {
  createMemoryAccessToken,
  memoryProviderKeys,
  revokeMemoryAccessToken,
  validateMemoryProviderKeys,
} from "@/lib/memory-api-tokens.server";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  state.tokens.clear();
  state.claimsError = null;
});

describe("personal API tokens", () => {
  it("stores only a token hash and returns the secret once to its owner", async () => {
    const created = await createUserApiToken("owner-1", "My agent");
    const stored = state.tokens.get(created.id);

    expect(created.token).toMatch(/^spk_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(stored?.["token_hash"]).not.toBe(created.token);
    expect(await resolveApiUser(new Request("https://example.test", { headers: { Authorization: `Bearer ${created.token}` } }))).toBe("owner-1");
    expect(stored?.["last_used"]).toEqual(expect.any(String));
    expect(await listUserApiTokens("owner-1")).toMatchObject([{ id: created.id, label: "My agent" }]);
  });

  it("revokes tokens and rejects their next use", async () => {
    const created = await createUserApiToken("owner-2");
    expect(await revokeUserApiToken("owner-2", created.id)).toBe(true);

    await expect(resolveApiUser(new Request("https://example.test", { headers: { Authorization: `Bearer ${created.token}` } })))
      .rejects.toBeInstanceOf(UserAuthError);
  });

  it("fails closed for invalid session bearer tokens", async () => {
    await expect(resolveApiUser(new Request("https://example.test", { headers: { Authorization: "Bearer not-a-session" } })))
      .rejects.toBeInstanceOf(UserAuthError);
  });
});

describe("temporary API tokens", () => {
  it("issues an opaque, expiring token for provider-key arrays without using Supabase", async () => {
    const providerKeys = { openai: ["openai-secret-a", "openai-secret-b"], deepgram: ["deepgram-secret"] };
    const created = await createMemoryAccessToken(providerKeys);
    const identity = await resolveApiUser(
      new Request("https://example.test", {
        headers: { Authorization: `Bearer ${created.token}` },
      }),
    );

    expect(created.token).toMatch(/^spt_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(created.token).not.toContain("openai-secret");
    expect(created.expires_at).toEqual(expect.any(String));
    expect(created.providers).toEqual([
      { service: "openai", key_count: 2 },
      { service: "deepgram", key_count: 1 },
    ]);
    expect(identity).toBe(`memory:${created.id}`);
    if (!identity) throw new Error("Expected the temporary token to resolve.");
    expect(memoryProviderKeys(identity, "openai")).toEqual(providerKeys.openai);
    expect(state.tokens.size).toBe(0);
  });

  it("rejects invalid or expired temporary tokens and revokes valid tokens", async () => {
    const created = await createMemoryAccessToken({ openai: ["key"] });
    await expect(
      resolveApiUser(
        new Request("https://example.test", {
          headers: { Authorization: `Bearer ${created.token.slice(0, -1)}x` },
        }),
      ),
    ).rejects.toBeInstanceOf(UserAuthError);
    expect(await revokeMemoryAccessToken(created.token)).toBe(true);
    await expect(
      resolveApiUser(
        new Request("https://example.test", {
          headers: { Authorization: `Bearer ${created.token}` },
        }),
      ),
    ).rejects.toBeInstanceOf(UserAuthError);
  });

  it("accepts only supported provider key arrays within the configured limits", () => {
    expect(validateMemoryProviderKeys({ openai: [" key-1 ", "key-2", "key-1"] })).toEqual({
      openai: ["key-1", "key-2"],
    });
    expect(validateMemoryProviderKeys({ unknown: ["secret"] })).toBeNull();
    expect(validateMemoryProviderKeys({ openai: "secret" })).toBeNull();
    expect(validateMemoryProviderKeys({ openai: [""] })).toBeNull();
    expect(validateMemoryProviderKeys({ openai: Array(11).fill("secret") })).toBeNull();
  });
});
