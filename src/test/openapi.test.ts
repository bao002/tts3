import { describe, expect, it } from "vitest";
import { openApiSpec } from "@/lib/openapi";

describe("public OpenAPI specification", () => {
  it("documents every TTS provider and the provider returned by Auto", () => {
    const tts = openApiSpec.paths["/api/public/tts"];
    const schema = tts.post.requestBody.content["application/json"].schema;
    const provider = schema.properties.provider;

    expect(provider.enum).toEqual([
      "auto",
      "google",
      "lovable",
      "openrouter",
      "gemini",
      "openai",
      "elevenlabs",
      "deepgram",
    ]);
    expect(
      openApiSpec.paths["/api/public/tts"].post.responses["200"].content["audio/*"],
    ).toBeDefined();
    expect(
      openApiSpec.paths["/api/public/tts"].get.responses["200"].headers["X-Provider"],
    ).toMatchObject({
      schema: { enum: expect.arrayContaining(["deepgram"]) },
    });
    expect(
      openApiSpec.paths["/api/public/tts"].post.responses["200"].headers["X-Response-Time-Ms"],
    ).toBeDefined();
    expect(openApiSpec.paths["/api/public/tts"].post.responses["502"].description).toContain(
      "does not by itself mean the key is invalid",
    );
    expect(openApiSpec.paths["/api/public/tts"].post.parameters[0]?.name).toBe(
      "X-Provider-API-Key",
    );
    expect(
      openApiSpec.paths["/api/public/tts"].post.requestBody.content["application/json"].schema
        .properties.api_key.description,
    ).toContain("takes precedence");
    expect(openApiSpec.servers[0]?.url).toBe("https://tts2.lovable.app");
    expect(tts.post.operationId).toBe("synthesizeSpeech");
    expect(schema.properties.text).toMatchObject({ minLength: 1, maxLength: 5000 });
    expect(schema.properties.lang).toMatchObject({ minLength: 2, maxLength: 20 });
    expect(schema.properties.target_lang).toMatchObject({ maxLength: 20 });
    expect(schema.properties.api_key).toMatchObject({ maxLength: 500 });
    expect(schema.properties.voice).toMatchObject({ maxLength: 50 });
    expect(
      tts.get.parameters.find((parameter) => parameter.name === "options")?.schema,
    ).toMatchObject({ type: "string", maxLength: 2000 });
    expect(
      tts.post.parameters.find((parameter) => parameter.name === "X-Provider-API-Key")?.schema,
    ).toMatchObject({ type: "string", maxLength: 500 });
  });

  it("documents authenticated machine-readable usage aggregates", () => {
    const usage = openApiSpec.paths["/api/report/usage"].get;
    const report = usage.responses["200"].content["application/json"].schema;

    expect(usage.operationId).toBe("getProviderUsageReport");
    expect(usage.summary).toBe("Get provider usage report");
    expect(usage.description).toContain("Playable audio history");
    expect(usage.security).toEqual([
      { personalApiTokenAuth: [] },
      { supabaseSessionAuth: [] },
      { bearerAuth: [] },
    ]);
    expect(usage.parameters).toContainEqual({
      name: "hours",
      in: "query",
      required: false,
      schema: { type: "integer", minimum: 1, maximum: 720, default: 24 },
    });
    expect(report.properties.totals.properties.input_chars).toBeDefined();
    expect(report.properties.totals.properties.provider_output_tokens).toBeDefined();
    expect(report.properties.services.items.properties.service).toBeDefined();
    expect(usage.responses["200"].content["application/json"].schema).toBe(report);
  });

  it("documents every API route, including the canonical document endpoint", () => {
    expect(Object.keys(openApiSpec.paths).sort()).toEqual([
      "/api/public/access-token",
      "/api/public/info",
      "/api/public/openapi.json",
      "/api/public/openrouter-keys",
      "/api/public/tts",
      "/api/public/usage",
      "/api/report/usage",
      "/api/user/provider-keys",
      "/api/user/token",
    ]);
    expect(openApiSpec.paths["/api/public/openapi.json"].get.operationId).toBe(
      "getOpenApiDocument",
    );
    expect(openApiSpec.paths["/api/public/tts"].get.security).toEqual([
      { personalApiTokenAuth: [] },
      {},
    ]);
    expect(openApiSpec.paths["/api/public/tts"].post.security).toEqual([
      { personalApiTokenAuth: [] },
      {},
    ]);
    expect(openApiSpec.paths["/api/public/openapi.json"].get.security).toEqual([]);
    expect(openApiSpec.paths["/api/public/access-token"].post.operationId).toBe(
      "createTemporaryAccessToken",
    );
    expect(openApiSpec.paths["/api/public/info"].get.operationId).toBe("getPublicServiceInfo");
  });

  it("documents the secured shared-provider key management API without exposing credentials", () => {
    const keyManagement = openApiSpec.paths["/api/public/openrouter-keys"];

    expect(keyManagement.get.security).toEqual([{ bearerAuth: [] }]);
    expect(keyManagement.post.security).toEqual([{ bearerAuth: [] }]);
    expect(keyManagement.delete.security).toEqual([{ bearerAuth: [] }]);
    expect(
      keyManagement.get.parameters.find((parameter) => parameter.name === "service")?.schema.enum,
    ).toContain("deepgram");
    expect(
      keyManagement.post.requestBody.content["application/json"].schema.properties.service.enum,
    ).toContain("deepgram");
    expect(
      keyManagement.delete.parameters.find((parameter) => parameter.name === "service")?.schema
        .enum,
    ).toContain("deepgram");
    const personalKeyBody =
      openApiSpec.paths["/api/user/provider-keys"].post.requestBody.content["application/json"]
        .schema;
    expect(personalKeyBody.properties.service.enum).toContain("deepgram");
    expect(personalKeyBody.properties.key).toMatchObject({ type: "string", maxLength: 500 });
    expect(personalKeyBody.properties.test).toMatchObject({ type: "boolean", const: true });
    expect(personalKeyBody.properties.test.description).toContain(
      "provider-specific non-billing authentication endpoint",
    );
    expect(personalKeyBody.anyOf).toContainEqual({ required: ["test", "id"] });
    expect(
      openApiSpec.paths["/api/user/provider-keys"].post.responses["200"].content["application/json"]
        .schema.properties.test.properties.service.enum,
    ).toEqual(["openrouter", "lovable", "gemini", "openai", "elevenlabs", "deepgram"]);
    expect(
      openApiSpec.paths["/api/user/provider-keys"].get.responses["200"].content["application/json"]
        .schema.properties.history.items.properties,
    ).toMatchObject({
      key_id: { type: "string", format: "uuid" },
      action: { type: "string", enum: ["request", "test"] },
      response_code: { type: "integer" },
    });
    expect(
      keyManagement.get.responses["200"].content["application/json"].schema.properties.keys.items
        .properties,
    ).toMatchObject({
      id: { type: "string", format: "uuid" },
      key: { type: "string", const: "Configured key" },
    });
    expect(
      keyManagement.get.responses["200"].content["application/json"].schema.properties.keys.items
        .properties,
    ).not.toHaveProperty("fingerprint");
    expect(
      keyManagement.post.requestBody.content["application/json"].schema.properties.key,
    ).toMatchObject({
      type: "string",
      maxLength: 500,
    });
    expect(keyManagement.post.requestBody.content["application/json"].schema.anyOf).toEqual([
      { required: ["key"] },
      { required: ["reset"] },
    ]);
  });

  it("keeps every operation's request body and responses at the correct OpenAPI level", () => {
    const methods = ["get", "post", "put", "patch", "delete"];

    for (const [path, pathItem] of Object.entries(openApiSpec.paths)) {
      for (const method of methods) {
        const operation = Reflect.get(pathItem, method);
        if (!operation || typeof operation !== "object") continue;

        expect(operation, `${method.toUpperCase()} ${path}`).toHaveProperty("responses");
        const requestBody = Reflect.get(operation, "requestBody");
        if (requestBody) expect(requestBody).not.toHaveProperty("responses");
      }
    }

    expect(openApiSpec.paths["/api/user/token"].post.responses["201"]).toBeDefined();
    expect(openApiSpec.paths["/api/user/token"].delete.operationId).toBe("revokePersonalApiToken");
    expect(openApiSpec.paths["/api/user/provider-keys"].post.responses["201"]).toBeDefined();
  });

  it("serializes as valid JSON for the openapi.json route", () => {
    expect(() => JSON.parse(JSON.stringify(openApiSpec))).not.toThrow();
  });
});
