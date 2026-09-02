import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "vitest";
import { HubCommandError } from "../hub/error.js";
import { addChannel, channelStatus, listChannels } from "./client.js";
import type { ControlPlaneTarget } from "../control-plane.js";

const localTarget: ControlPlaneTarget = { origin: "", source: "local" };

const servers: Array<ReturnType<typeof createServer>> = [];

interface RecordedRequest {
  method: string;
  url: string | undefined;
  authorization: string | null;
  body: string;
}

interface TestResponse {
  status: number;
  body?: unknown;
  rawBody?: string;
  contentType?: string;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

function startServer(
  responseFor: (method: string, url: string | undefined) => TestResponse,
  requests: RecordedRequest[],
): Promise<ControlPlaneTarget> {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({
        method: request.method ?? "",
        url: request.url,
        authorization: request.headers.authorization ?? null,
        body,
      });
      const configured = responseFor(request.method ?? "", request.url);
      response.writeHead(configured.status, {
        "content-type": configured.contentType ?? "application/json",
      });
      response.end(configured.rawBody ?? JSON.stringify(configured.body));
    });
  });
  servers.push(server);
  return new Promise<ControlPlaneTarget>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ ...localTarget, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  server.closeAllConnections();
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe("channels control-plane client", () => {
  it("POSTs the account and canonical connection id to /api/v1/channels", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/channels") {
        return {
          status: 200,
          body: {
            channel: "slack",
            account: "main",
            installed: true,
            revision: true,
            transport: "started",
            detail: "Socket Mode connected",
          },
        };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);

    const result = await addChannel(target, {
      channel: "slack",
      account: "main",
      connectionId: "00000000-0000-4000-8000-000000000001",
    });

    assert.deepEqual(result, {
      channel: "slack",
      account: "main",
      installed: true,
      revision: true,
      transport: "started",
      detail: "Socket Mode connected",
    });
    assert.deepEqual(requests, [
      {
        method: "POST",
        url: "/api/v1/channels",
        authorization: null,
        body: JSON.stringify({
          channel: "slack",
          account: "main",
          connectionId: "00000000-0000-4000-8000-000000000001",
        }),
      },
    ]);
  });

  it("sends the API key as a bearer token for remote targets", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/channels") {
        return {
          status: 200,
          body: {
            channel: "slack",
            account: "main",
            installed: false,
            revision: false,
            transport: "deferred",
          },
        };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);

    await addChannel(
      { ...target, source: "remote", apiKey: "team-key" },
      {
        channel: "slack",
        account: "main",
        connectionId: "00000000-0000-4000-8000-000000000001",
      },
    );

    assert.equal(requests[0]?.authorization, "Bearer team-key");
  });

  it("GETs /api/v1/channels and returns the account list", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/channels") {
        return {
          status: 200,
          body: {
            accounts: [
              { channel: "slack", account: "main", enabled: true, transport: "socket-mode" },
              { channel: "telegram", account: "dev", enabled: false, transport: "polling" },
            ],
          },
        };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);

    const accounts = await listChannels(target);

    assert.deepEqual(accounts, [
      { channel: "slack", account: "main", enabled: true, transport: "socket-mode" },
      { channel: "telegram", account: "dev", enabled: false, transport: "polling" },
    ]);
    assert.deepEqual(requests, [
      { method: "GET", url: "/api/v1/channels", authorization: null, body: "" },
    ]);
  });

  it("GETs /api/v1/channels/status and returns the per-account detail", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/channels/status") {
        return {
          status: 200,
          body: {
            accounts: [
              {
                channel: "slack",
                account: "main",
                pin: "openclaw-slack@1.0.0",
                integrity: "ok",
                loadTrace: "ok",
                transport: "socket-mode",
              },
            ],
          },
        };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);

    const accounts = await channelStatus(target);

    assert.deepEqual(accounts, [
      {
        channel: "slack",
        account: "main",
        pin: "openclaw-slack@1.0.0",
        integrity: "ok",
        loadTrace: "ok",
        transport: "socket-mode",
      },
    ]);
    assert.deepEqual(requests, [
      { method: "GET", url: "/api/v1/channels/status", authorization: null, body: "" },
    ]);
  });

  it("rejects a 404 with the missing control-plane message", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer(() => ({ status: 404, rawBody: "Not Found" }), requests);

    await assert.rejects(listChannels(target), (error: unknown) => {
      assert.ok(error instanceof HubCommandError);
      assert.equal(error.code, "HUB_NOT_FOUND");
      assert.ok(error.message.includes("does not expose the channel control plane"));
      assert.ok(error.message.includes("/api/v1/channels and /api/v1/users are absent"));
      return true;
    });
  });

  it("rejects a malformed success body as an invalid response", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/channels") {
        return { status: 200, rawBody: "not-json" };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);

    await assert.rejects(listChannels(target), { code: "HUB_INVALID_RESPONSE" });
  });

  it("rejects a schema-invalid success body as an invalid response", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/channels") {
        // The list shape is valid JSON but the add endpoint expects the install result.
        return { status: 200, body: { accounts: [] } };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);

    await assert.rejects(
      addChannel(target, { channel: "slack", account: "main", connectionId: "connection" }),
      {
        code: "HUB_INVALID_RESPONSE",
      },
    );
  });

  it("does not swallow non-404 failures", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer(() => ({ status: 500, rawBody: "boom" }), requests);

    await assert.rejects(listChannels(target), { code: "HUB_REQUEST_FAILED" });
  });
});
