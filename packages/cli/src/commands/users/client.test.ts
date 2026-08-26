import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "vitest";
import { HubCommandError } from "../hub/error.js";
import { addUser, editUser, listUsers, showUser } from "./client.js";
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

describe("users control-plane client", () => {
  it("GETs /api/v1/users and returns the user list", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/users") {
        return {
          status: 200,
          body: {
            users: [
              { username: "alice", name: "Alice", identities: ["slack:U1"], roles: ["operator"] },
              { username: "bob", name: null, identities: [], roles: [] },
            ],
          },
        };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);

    const users = await listUsers(target);

    assert.deepEqual(users, [
      { username: "alice", name: "Alice", identities: ["slack:U1"], roles: ["operator"] },
      { username: "bob", name: null, identities: [], roles: [] },
    ]);
    assert.deepEqual(requests, [
      { method: "GET", url: "/api/v1/users", authorization: null, body: "" },
    ]);
  });

  it("GETs the URL-encoded username for a single user", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/users/alice%2Fops") {
        return {
          status: 200,
          body: {
            username: "alice/ops",
            name: "Alice Ops",
            identities: ["tg:42"],
            roles: ["operator"],
          },
        };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);

    const user = await showUser(target, "alice/ops");

    assert.deepEqual(user, {
      username: "alice/ops",
      name: "Alice Ops",
      identities: ["tg:42"],
      roles: ["operator"],
    });
    assert.deepEqual(requests, [
      { method: "GET", url: "/api/v1/users/alice%2Fops", authorization: null, body: "" },
    ]);
  });

  it("POSTs /api/v1/users with the username and identities", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/users") {
        return { status: 200, body: { username: "alice", deployed: true } };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);

    const result = await addUser(target, {
      username: "alice",
      name: "Alice",
      identities: ["slack:U1", "tg:42"],
    });

    assert.deepEqual(result, { username: "alice", deployed: true });
    assert.deepEqual(requests, [
      {
        method: "POST",
        url: "/api/v1/users",
        authorization: null,
        body: JSON.stringify({
          username: "alice",
          name: "Alice",
          identities: ["slack:U1", "tg:42"],
        }),
      },
    ]);
  });

  it("omits the optional name from the add body when absent", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/users") {
        return { status: 200, body: { username: "bob", deployed: false } };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);

    await addUser(target, { username: "bob", identities: ["tg:7"] });

    assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
      username: "bob",
      identities: ["tg:7"],
    });
  });

  it("PUTs only the supplied fields for an edit", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/users/alice") {
        return { status: 200, body: { username: "alice", deployed: true } };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);

    const result = await editUser(target, "alice", { name: "Alice L.", identities: ["tg:1"] });

    assert.deepEqual(result, { username: "alice", deployed: true });
    assert.deepEqual(requests, [
      {
        method: "PUT",
        url: "/api/v1/users/alice",
        authorization: null,
        body: JSON.stringify({ name: "Alice L.", identities: ["tg:1"] }),
      },
    ]);
  });

  it("PUTs an empty body when no edit field is supplied", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/users/alice") {
        return { status: 200, body: { username: "alice", deployed: false } };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);

    await editUser(target, "alice", {});

    assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {});
  });

  it("sends the API key as a bearer token for remote targets", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/users") {
        return { status: 200, body: { users: [] } };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);

    await listUsers({ ...target, source: "remote", apiKey: "team-key" });

    assert.equal(requests[0]?.authorization, "Bearer team-key");
  });

  it("rejects a 404 with the missing control-plane message", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer(() => ({ status: 404, rawBody: "Not Found" }), requests);

    await assert.rejects(listUsers(target), (error: unknown) => {
      assert.ok(error instanceof HubCommandError);
      assert.equal(error.code, "HUB_NOT_FOUND");
      assert.ok(error.message.includes("does not expose the channel control plane"));
      return true;
    });
  });

  it("does not swallow non-404 failures", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer(() => ({ status: 500, rawBody: "boom" }), requests);

    await assert.rejects(showUser(target, "alice"), { code: "HUB_REQUEST_FAILED" });
  });
});
