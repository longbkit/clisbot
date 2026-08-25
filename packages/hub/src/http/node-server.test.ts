import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { describe, it } from "vitest";
import { z } from "zod";
import { createMemoryDatabase } from "../db/memory.js";
import { CliAuthorizations } from "../cli-authorizations/index.js";
import { createLogger } from "../logger.js";
import { createPublicApi } from "../public-api/index.js";
import type { PublicOperations } from "../public-operations/index.js";
import { createSlackWebhookSource } from "../triggers/slack/webhook.js";
import { createFetchServer } from "./node-server.js";
import { registerResponseFinishCleanup } from "./response-lifecycle.js";
import { TRUSTED_REQUEST_ORIGIN_HEADER } from "./request-origin.js";

describe("trusted request origin metadata", () => {
  it("overwrites a caller-supplied internal header with direct HTTP metadata", async () => {
    assert.equal(
      await observedOrigin(
        {},
        { host: "hub.example.test:4317", [TRUSTED_REQUEST_ORIGIN_HEADER]: "https://attacker.test" },
      ),
      "http://hub.example.test:4317",
    );
  });

  it("uses forwarded protocol and host only when proxy metadata is explicitly trusted", async () => {
    const headers = {
      host: "internal:3000",
      "x-forwarded-host": "hub.example.test",
      "x-forwarded-proto": "https",
    };
    assert.equal(await observedOrigin({}, headers), "http://internal:3000");
    assert.equal(
      await observedOrigin({ trustedClientIpHeader: "fly-client-ip" }, headers),
      "https://hub.example.test",
    );
  });
});

describe("CLI authorization client address", () => {
  it("uses the socket peer regardless of caller-supplied proxy headers or user agents", async () => {
    const hub = await CliAuthorizationServer.start();

    try {
      const statuses = [];
      for (let index = 0; index < 6; index += 1) {
        statuses.push(
          await hub.request({
            "cf-connecting-ip": `198.51.100.${index + 1}`,
            "x-forwarded-for": `203.0.113.${index + 1}`,
            "x-paseo-client-address": `192.0.2.${index + 1}`,
            "x-real-ip": `192.0.2.${index + 10}`,
            "user-agent": `rotating-agent-${index}`,
          }),
        );
      }

      assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429]);
    } finally {
      await hub.close();
    }
  });

  it("uses only the configured valid single-IP header", async () => {
    const hub = await CliAuthorizationServer.start("fly-client-ip");

    try {
      const statuses = [];
      for (let index = 0; index < 6; index += 1) {
        statuses.push(
          await hub.request({
            "fly-client-ip": "198.51.100.20",
            "x-forwarded-for": `203.0.113.${index + 1}`,
            "x-paseo-client-address": `192.0.2.${index + 1}`,
            "user-agent": `rotating-agent-${index}`,
          }),
        );
      }
      statuses.push(await hub.request({ "fly-client-ip": "198.51.100.21" }));

      assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429, 201]);
    } finally {
      await hub.close();
    }
  });

  it("falls back to the socket peer when the configured header is missing or invalid", async () => {
    const hub = await CliAuthorizationServer.start("fly-client-ip");
    const headers = [
      {},
      { "fly-client-ip": "not-an-ip" },
      { "fly-client-ip": "198.51.100.1, 198.51.100.2" },
      { "fly-client-ip": "198.51.100.999" },
      { "fly-client-ip": "[2001:db8::1]" },
      { "x-paseo-client-address": "203.0.113.50" },
    ];

    try {
      const statuses = [];
      for (const requestHeaders of headers) statuses.push(await hub.request(requestHeaders));

      assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429]);
    } finally {
      await hub.close();
    }
  });
});

describe("fetch response lifecycle", () => {
  it("runs completion cleanup only after the Node response finishes", async () => {
    let responseFinished = false;
    let cleanupRanAfterFinish = false;
    let resolveCleanup: (() => void) | undefined;
    const cleanup = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    const cleanupResponse = new Response("ok");
    const onCleanup = () => {
      cleanupRanAfterFinish = responseFinished;
      resolveCleanup?.();
    };
    const server = createFetchServer(() =>
      registerResponseFinishCleanup(cleanupResponse, onCleanup),
    );
    const onResponseFinish = () => {
      responseFinished = true;
    };
    const observeResponse = (_incoming: IncomingMessage, response: ServerResponse) => {
      response.once("finish", onResponseFinish);
    };
    server.on("request", observeResponse);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    try {
      await new Promise<void>((resolve, reject) => {
        const response = httpRequest(
          { host: "127.0.0.1", port: address.port, path: "/", method: "GET" },
          (incoming) => drainIncomingResponse(incoming, resolve),
        );
        response.once("error", reject);
        response.end();
      });
      await cleanup;
      assert.equal(responseFinished, true);
      assert.equal(cleanupRanAfterFinish, true);
    } finally {
      await closeServer(server);
    }
  });
});

describe("HTTP failure ownership", () => {
  it("emits exactly one record for a reported expected 4xx response", async () => {
    const stream = new CaptureStream();
    const endpoint = createSlackWebhookSource({
      appId: "A_FAKE",
      signingSecret: "formatless-fake-signing-value-8d71",
      accept: () => Promise.reject(new Error("must not accept an unsigned request")),
    });
    const server = createFetchServer((request) => endpoint.handle(request), {
      logger: createLogger(stream),
    });

    await requestOnce(server, { method: "POST", body: "{}" });
    const records = stream.records();
    assert.equal(records.length, 1);
    assert.equal(records[0]?.["operation"], "slack.webhook.verify");
    assert.equal(records[0]?.["failureKind"], "authentication");
  });

  it("emits exactly one top-level record for a genuinely unreported 5xx response", async () => {
    const stream = new CaptureStream();
    const server = createFetchServer(() => new Response("failed", { status: 503 }), {
      logger: createLogger(stream),
    });

    await requestOnce(server);
    const records = stream.records();
    assert.equal(records.length, 1);
    assert.equal(records[0]?.["operation"], "http.response");
    assert.equal(records[0]?.["status"], 503);
  });

  it("does not duplicate a public API owner record with the HTTP fallback", async () => {
    const stream = new CaptureStream();
    const failure = new Error("storage exploded with formatless-secret-f09e");
    const failOperation = () => Promise.reject(failure);
    const operations: PublicOperations = {
      listProjects: failOperation,
      listConfigurationResources: failOperation,
      listSetupResources: failOperation,
      validateConfiguration: failOperation,
      installConfiguration: failOperation,
      dispatchManualRun: failOperation,
      issueEnrollmentToken: failOperation,
    };
    const api = createPublicApi(
      {
        status: "enabled",
        authenticator: {
          authorize: () =>
            Promise.resolve({
              status: "authorized" as const,
              access: {
                kind: "apiKey" as const,
                credentialId: "credential-fake",
                organizationId: "organization-fake",
                scopes: ["projects:read" as const],
              },
            }),
        },
      },
      operations,
    );
    const server = createFetchServer((request) => api.handle(request), {
      logger: createLogger(stream),
    });

    await requestOnce(
      server,
      { headers: { authorization: "Bearer fake-not-logged" } },
      "/api/v1/projects",
    );
    const records = stream.records();
    assert.equal(records.length, 1);
    assert.equal(records[0]?.["operation"], "public-api.listProjects");
    assert.equal(records[0]?.["status"], 500);
    assert.equal(stream.text().includes("formatless-secret-f09e"), false);
    assert.equal(stream.text().includes("fake-not-logged"), false);
  });
});

class CaptureStream extends Writable {
  private readonly chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  records(): Record<string, unknown>[] {
    return this.text()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => logRecordSchema.parse(JSON.parse(line)));
  }

  text(): string {
    return this.chunks.join("");
  }
}

const logRecordSchema = z.record(z.string(), z.unknown());

async function requestOnce(
  server: ReturnType<typeof createFetchServer>,
  init?: RequestInit,
  path = "/failure",
): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, init);
    await response.body?.cancel();
  } finally {
    await closeServer(server);
  }
}

function drainIncomingResponse(incoming: IncomingMessage, resolve: () => void): void {
  incoming.resume();
  incoming.once("end", resolve);
}

function closeServer(server: ReturnType<typeof createFetchServer>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

async function observedOrigin(
  options: { trustedClientIpHeader?: string },
  headers: Record<string, string>,
): Promise<string> {
  const server = createFetchServer(
    (request) => new Response(request.headers.get(TRUSTED_REQUEST_ORIGIN_HEADER)),
    options,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  try {
    return await new Promise<string>((resolve, reject) => {
      const outgoing = httpRequest(
        { host: "127.0.0.1", port: address.port, path: "/", headers },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
          incoming.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        },
      );
      outgoing.once("error", reject);
      outgoing.end();
    });
  } finally {
    await closeServer(server);
  }
}

class CliAuthorizationServer {
  private constructor(
    private readonly origin: string,
    private readonly server: ReturnType<typeof createFetchServer>,
  ) {}

  static async start(trustedClientIpHeader?: string): Promise<CliAuthorizationServer> {
    const database = createMemoryDatabase({ organizationIds: ["acme"] });
    const authorizations = new CliAuthorizations(database, undefined, "https://hub.paseo.test");
    const server = createFetchServer(
      (request) => authorizations.start(request),
      trustedClientIpHeader === undefined ? {} : { trustedClientIpHeader },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("CLI authorization server did not bind a TCP address");
    }
    return new CliAuthorizationServer(`http://127.0.0.1:${address.port}`, server);
  }

  async request(headers: Record<string, string>): Promise<number> {
    const response = await fetch(`${this.origin}/api/v1/cli-authorizations`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({}),
    });
    await response.body?.cancel();
    return response.status;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}
