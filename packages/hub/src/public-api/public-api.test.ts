import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import { describe, it } from "vitest";
import { z } from "zod";
import type { ApiKeyScope } from "../auth/api-key-contract.js";
import type { OperationAuthenticator } from "../auth/operation-auth.js";
import { DatabaseUnavailableError } from "../db/errors.js";
import type { PublicOperations } from "../public-operations/index.js";
import {
  ConfigurationResourcesSchema,
  SetupResourcesSchema,
  createPublicApi,
  DispatchedManualRunSchema,
  EnrollmentTokenSchema,
  InstalledConfigurationSchema,
  ProjectListSchema,
  ProblemSchema,
  publicOperationManifest,
  publicOpenApiDocument,
  ValidatedConfigurationSchema,
} from "./index.js";

const authorization = {
  kind: "apiKey" as const,
  credentialId: "key-1",
  organizationId: "organization-1",
  scopes: [
    "projects:read",
    "configuration:validate",
    "configuration:install",
    "runs:dispatch",
    "daemons:enroll",
  ] as const,
};

describe("public API interface", () => {
  it("rejects an enabled composition without application operations", () => {
    assert.throws(
      () => createPublicApi({ status: "enabled", authenticator: authenticator() }, null),
      /enabled public API requires application operations/u,
    );
  });

  it("validates requests and returns structured RFC 9457 issues with one request ID", async () => {
    const api = createPublicApi(
      { status: "enabled", authenticator: authenticator() },
      successfulOperations(),
    );
    const response = await api.handle(
      request("/api/v1/configurations/install", {
        body: JSON.stringify({ projectSlug: "", unexpected: true }),
        requestId: "caller-request-id",
      }),
    );

    assert.equal(response.status, 400);
    assert.equal(response.headers.get("content-type"), "application/problem+json");
    assert.equal(response.headers.get("x-request-id"), "caller-request-id");
    const body = ProblemSchema.parse(await response.json());
    assert.equal(body.requestId, "caller-request-id");
    assert.equal(body.code, "invalid_request");
    assert.deepEqual(
      body.issues?.map(({ path }) => path),
      [["projectSlug"], ["files"], []],
    );
  });

  it("generates and returns a request ID on success", async () => {
    const api = createPublicApi(
      { status: "enabled", authenticator: authenticator() },
      successfulOperations(),
    );
    const response = await api.handle(
      request("/api/v1/daemons/enrollment-tokens", { contentType: false }),
    );
    assert.equal(response.status, 201);
    assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/u);
  });

  it("keeps existing-project validation responses compatible with strict clients", async () => {
    const api = createPublicApi(
      { status: "enabled", authenticator: authenticator() },
      successfulOperations(),
    );

    const response = await api.handle(installRequest("/api/v1/configurations/validate"));

    assert.deepEqual(await response.json(), { projectSlug: "project", valid: true });
  });

  it("returns RFC 9457 request-correlated 404 and 405 responses at the canonical router", async () => {
    const api = createPublicApi(
      { status: "enabled", authenticator: authenticator() },
      successfulOperations(),
    );
    const missing = await api.handle(request("/api/v1/not-a-route", { contentType: false }));
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("content-type"), "application/problem+json");
    assert.equal(ProblemSchema.parse(await missing.json()).code, "not_found");
    assert.ok(missing.headers.get("x-request-id"));

    const wrongMethod = await api.handle(
      new Request("https://hub.test/api/v1/manual-runs", { method: "GET" }),
    );
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "POST");
    assert.equal(ProblemSchema.parse(await wrongMethod.json()).code, "method_not_allowed");
    assert.ok(wrongMethod.headers.get("x-request-id"));
  });

  it("distinguishes invalid credentials, insufficient scope, and unavailable authentication", async () => {
    const operations = successfulOperations();
    for (const [name, auth, expectedStatus, code] of [
      ["missing", authenticator("unauthorized"), 401, "unauthorized"],
      ["malformed", authenticator("unauthorized"), 401, "unauthorized"],
      ["revoked", authenticator("unauthorized"), 401, "unauthorized"],
      ["scope", authenticator("forbidden"), 403, "insufficient_scope"],
      ["unavailable", authenticator("unavailable"), 503, "authentication_unavailable"],
    ] as const) {
      const api = createPublicApi({ status: "enabled", authenticator: auth }, operations);
      const response = await api.handle(
        request("/api/v1/daemons/enrollment-tokens", { requestId: name, contentType: false }),
      );
      assert.equal(response.status, expectedStatus, name);
      assert.equal(ProblemSchema.parse(await response.json()).code, code, name);
      if (expectedStatus === 401) assert.equal(response.headers.get("www-authenticate"), "Bearer");
    }
  });

  it("maps direct success representations and domain failures for every operation", async () => {
    const successApi = createPublicApi(
      { status: "enabled", authenticator: authenticator() },
      successfulOperations(),
    );
    InstalledConfigurationSchema.parse(
      await (await successApi.handle(installRequest("/api/v1/configurations/install"))).json(),
    );
    ProjectListSchema.parse(
      await (
        await successApi.handle(
          new Request("https://hub.test/api/v1/projects", {
            headers: { authorization: "Bearer valid" },
          }),
        )
      ).json(),
    );
    ConfigurationResourcesSchema.parse(
      await (
        await successApi.handle(
          new Request("https://hub.test/api/v1/configuration-resources", {
            headers: { authorization: "Bearer valid" },
          }),
        )
      ).json(),
    );
    assert.deepEqual(
      SetupResourcesSchema.parse(
        await (
          await successApi.handle(
            new Request("https://hub.test/api/v1/setup-resources", {
              headers: { authorization: "Bearer valid" },
            }),
          )
        ).json(),
      ),
      {
        github: [
          {
            slug: "github-connection",
            accountLogin: "octocat",
            accountType: "User",
            repositories: ["octocat/starter"],
          },
        ],
        discord: [{ guildId: "123456789", guildName: "Paseo Guild" }],
        slack: [{ teamId: "T01234567", teamName: "Paseo Workspace" }],
      },
    );
    ValidatedConfigurationSchema.parse(
      await (await successApi.handle(installRequest("/api/v1/configurations/validate"))).json(),
    );
    DispatchedManualRunSchema.parse(
      await (await successApi.handle(manualRequest("/api/v1/manual-runs"))).json(),
    );
    EnrollmentTokenSchema.parse(
      await (
        await successApi.handle(
          request("/api/v1/daemons/enrollment-tokens", { contentType: false }),
        )
      ).json(),
    );

    const cases: readonly {
      operations: PublicOperations;
      request: Request;
      status: number;
      code: string;
    }[] = [
      {
        operations: {
          ...successfulOperations(),
          installConfiguration: () =>
            Promise.resolve({
              status: "invalid_bundle",
              issues: [
                {
                  path: ["partials", 0, "path"],
                  message: "partial file is not referenced by the configuration",
                },
              ],
            }),
        },
        request: installRequest("/api/v1/configurations/install"),
        status: 422,
        code: "invalid_configuration_bundle",
      },
      {
        operations: {
          ...successfulOperations(),
          dispatchManualRun: () => Promise.resolve({ status: "daemon_offline" }),
        },
        request: manualRequest("/api/v1/manual-runs"),
        status: 409,
        code: "daemon_offline",
      },
      {
        operations: {
          ...successfulOperations(),
          issueEnrollmentToken: () => Promise.resolve({ status: "credential_revoked" }),
        },
        request: request("/api/v1/daemons/enrollment-tokens", { contentType: false }),
        status: 401,
        code: "unauthorized",
      },
    ];
    for (const testCase of cases) {
      const api = createPublicApi(
        { status: "enabled", authenticator: authenticator() },
        testCase.operations,
      );
      const response = await api.handle(testCase.request);
      assert.equal(response.status, testCase.status);
      assert.equal(ProblemSchema.parse(await response.json()).code, testCase.code);
    }
  });

  it("maps unexpected operation failures to a logged opaque internal_error boundary", async () => {
    const api = createPublicApi(
      { status: "enabled", authenticator: authenticator() },
      {
        ...successfulOperations(),
        installConfiguration: () =>
          Promise.reject(
            new Error("SQLSTATE 23505 constraint secret_table query insert into secret_table"),
          ),
      },
    );

    const response = await api.handle(installRequest("/api/v1/configurations/install"));
    const serialized = JSON.stringify(await response.json());
    assert.equal(response.status, 500);
    assert.equal(ProblemSchema.parse(JSON.parse(serialized)).code, "internal_error");
    assert.equal(serialized.includes("23505"), false);
    assert.equal(serialized.includes("constraint"), false);
    assert.equal(serialized.includes("insert into"), false);
  });
});

describe("generated public OpenAPI", () => {
  it("contains only public v1 operations with complete auth, scopes, statuses, and schemas", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "paseo-openapi-"));
    const documentPath = join(temporaryDirectory, "openapi.json");
    try {
      await writeFile(documentPath, JSON.stringify(publicOpenApiDocument), "utf8");
      await SwaggerParser.validate(documentPath);
    } finally {
      await rm(temporaryDirectory, { recursive: true });
    }
    assert.deepEqual(Object.keys(publicOpenApiDocument.paths ?? {}).sort(), [
      "/api/v1/cli-authorizations",
      "/api/v1/cli-authorizations/poll",
      "/api/v1/configuration-resources",
      "/api/v1/configurations/install",
      "/api/v1/configurations/validate",
      "/api/v1/daemons/enrollment-tokens",
      "/api/v1/manual-runs",
      "/api/v1/projects",
      "/api/v1/setup-resources",
    ]);
    const expectations = {
      "/api/v1/configurations/install": [
        "configuration:install",
        ["201", "400", "401", "403", "404", "422", "500", "503"],
      ],
      "/api/v1/configurations/validate": [
        "configuration:validate",
        ["200", "400", "401", "403", "404", "422", "500", "503"],
      ],
      "/api/v1/configuration-resources": [
        "configuration:validate",
        ["200", "401", "403", "500", "503"],
      ],
      "/api/v1/setup-resources": ["configuration:validate", ["200", "401", "403", "500", "503"]],
      "/api/v1/projects": ["projects:read", ["200", "401", "403", "500", "503"]],
      "/api/v1/manual-runs": [
        "runs:dispatch",
        ["200", "400", "401", "403", "404", "409", "500", "503"],
      ],
      "/api/v1/daemons/enrollment-tokens": ["daemons:enroll", ["201", "401", "403", "500", "503"]],
    } as const;
    for (const [path, [scope, statuses]] of Object.entries(expectations)) {
      const operation =
        path === "/api/v1/projects" ||
        path === "/api/v1/configuration-resources" ||
        path === "/api/v1/setup-resources"
          ? publicOpenApiDocument.paths?.[path]?.get
          : publicOpenApiDocument.paths?.[path]?.post;
      assert.ok(operation?.operationId);
      assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
      assert.deepEqual(Reflect.get(operation, "x-required-scopes"), [scope]);
      assert.deepEqual(Object.keys(operation.responses ?? {}).sort(), [...statuses].sort());
      const documentedResponses = z
        .record(
          z.string(),
          z
            .object({ headers: z.object({ "X-Request-ID": z.unknown() }).passthrough() })
            .passthrough(),
        )
        .parse(operation.responses);
      assert.deepEqual(Object.keys(documentedResponses).sort(), [...statuses].sort());
      const unauthorized = z
        .object({ headers: z.record(z.string(), z.unknown()) })
        .parse(Reflect.get(operation.responses ?? {}, "401"));
      assert.ok(unauthorized.headers["WWW-Authenticate"]);
    }
    assert.deepEqual(publicOpenApiDocument.servers, [
      { url: "/", description: "This Hub instance" },
    ]);
    const fileSchema = publicOpenApiDocument.components?.schemas?.["ConfigurationFile"];
    assert.ok(fileSchema);
    assert.deepEqual(Reflect.get(fileSchema, "required"), ["path", "content"]);
    assert.deepEqual(Reflect.get(fileSchema, "properties"), {
      path: { type: "string", minLength: 1, maxLength: 512 },
      content: { type: "string", maxLength: 1000000 },
    });
  });

  it("keeps runtime dispatch and OpenAPI registration in parity with the operation manifest", () => {
    assert.deepEqual(
      publicOperationManifest.map(({ id, method, path, scope, responses }) => ({
        id,
        method,
        path,
        scope,
        responses: Object.keys(responses).sort(),
      })),
      Object.entries(publicOpenApiDocument.paths ?? {})
        .filter(([path]) => !path.startsWith("/api/v1/cli-authorizations"))
        .map(([path, item]) => {
          const method = item?.get === undefined ? "post" : "get";
          const operation = item?.[method];
          const extension = z.object({ "x-required-scopes": z.array(z.string()) }).parse(operation);
          return {
            id: operation?.operationId,
            method,
            path,
            scope: extension["x-required-scopes"][0],
            responses: Object.keys(operation?.responses ?? {}).sort(),
          };
        }),
    );
  });

  it("keeps documented runtime success and error bodies on the executable schemas", async () => {
    const api = createPublicApi(
      { status: "enabled", authenticator: authenticator() },
      successfulOperations(),
    );
    const success = await api.handle(manualRequest("/api/v1/manual-runs"));
    DispatchedManualRunSchema.parse(await success.json());
    const failure = await createPublicApi(
      { status: "enabled", authenticator: authenticator("forbidden") },
      successfulOperations(),
    ).handle(manualRequest("/api/v1/manual-runs"));
    ProblemSchema.parse(await failure.json());
  });
});

function authenticator(
  outcome: "authorized" | "unauthorized" | "forbidden" | "unavailable" = "authorized",
): OperationAuthenticator {
  return {
    authorize(_request: Request, requiredScope: ApiKeyScope) {
      if (outcome === "unavailable") return Promise.reject(new DatabaseUnavailableError());
      if (outcome !== "authorized") return Promise.resolve({ status: outcome });
      return Promise.resolve({
        status: "authorized",
        access: { ...authorization, scopes: [requiredScope] },
      });
    },
  };
}

function successfulOperations(): PublicOperations {
  return {
    listProjects: () =>
      Promise.resolve({
        status: "listed",
        projects: [
          {
            id: "84af3583-23ff-4fcc-9838-ed3262499be2",
            name: "Project",
            slug: "project",
          },
        ],
      }),
    listConfigurationResources: () =>
      Promise.resolve({
        status: "listed",
        daemons: [],
        github: [],
        discord: [],
        slack: [],
      }),
    listSetupResources: () =>
      Promise.resolve({
        status: "listed",
        github: [
          {
            slug: "github-connection",
            accountLogin: "octocat",
            accountType: "User",
            repositories: ["octocat/starter"],
          },
        ],
        discord: [{ guildId: "123456789", guildName: "Paseo Guild" }],
        slack: [{ teamId: "T01234567", teamName: "Paseo Workspace" }],
      }),
    validateConfiguration: () =>
      Promise.resolve({
        status: "valid",
        projectSlug: "project",
        valid: true,
      }),
    installConfiguration: () =>
      Promise.resolve({
        status: "installed",
        projectSlug: "project",
        versionId: "84af3583-23ff-4fcc-9838-ed3262499be2",
        version: 1,
        active: true,
      }),
    dispatchManualRun: (_authorization, input) =>
      Promise.resolve({
        status: "dispatched",
        deliveryKey: input.deliveryKey,
        providerEventReceiptId: "845e9d26-7977-45e1-bc69-d80a7b55a9cc",
        triggerRunId: "f83dc934-02a0-4849-8de7-699110be24ed",
        configuredTriggerName: input.trigger,
        workflowStatus: "running",
      }),
    issueEnrollmentToken: () =>
      Promise.resolve({
        status: "issued",
        token: "a".repeat(43),
        expiresAt: new Date("2026-08-06T18:10:00.000Z"),
      }),
  };
}

function request(
  path: string,
  options: { body?: string; requestId?: string; contentType?: boolean } = {},
): Request {
  return new Request(`https://hub.test${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer valid",
      ...(options.contentType === false ? {} : { "content-type": "application/json" }),
      ...(options.requestId === undefined ? {} : { "x-request-id": options.requestId }),
    },
    ...(options.body === undefined ? {} : { body: options.body }),
  });
}

function installRequest(path: string, requestId: string = randomUUID()): Request {
  return request(path, {
    requestId,
    body: JSON.stringify({
      projectSlug: "project",
      files: [
        {
          path: ".paseo/hub.yml",
          content: "environments:\n  runner:\n    kind: docker\n    image: paseo/test\nagents: {}",
        },
      ],
    }),
  });
}

function manualRequest(path: string, requestId?: string): Request {
  return request(path, {
    ...(requestId === undefined ? {} : { requestId }),
    body: JSON.stringify({
      projectSlug: "project",
      trigger: "deploy",
      actor: "alice",
      deliveryKey: "delivery-1",
      input: {},
    }),
  });
}
