import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import type { AddressInfo } from "node:net";
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "vitest";
import { HubCommandError } from "../hub/error.js";
import { addChannel, channelStatus, listChannels } from "./client.js";
import {
  createChannelsCommand,
  runChannelsAddCommand,
  runChannelsListCommand,
  runChannelsRemoveCommand,
} from "./index.js";
import type { ControlPlaneTarget } from "../control-plane.js";

const localTarget: ControlPlaneTarget = { origin: "", source: "local" };
const DISCORD_BOT_TOKEN = "MTE4MDAwMDAwMDAwMDAwMDAwOQ.discord.cli-secret-token";

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

  it("reads the Discord bot token from a secret file and never puts it in argv", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/channels") {
        return {
          status: 200,
          body: {
            channel: "discord",
            account: "guild",
            installed: true,
            revision: true,
            transport: "started",
          },
        };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);
    const directory = mkdtempSync(join(tmpdir(), "channels-secret-"));
    const secretFile = join(directory, "discord.json");
    writeFileSync(secretFile, JSON.stringify({ botToken: DISCORD_BOT_TOKEN }), { mode: 0o600 });
    try {
      const result = await runChannelsAddCommand(
        "discord",
        { hub: target.origin, account: "guild", secretFile },
        new Command(),
      );
      assert.equal(result.data.channel, "discord");
      assert.deepEqual(requests, [
        {
          method: "POST",
          url: "/api/v1/channels",
          authorization: null,
          body: JSON.stringify({
            channel: "discord",
            account: "guild",
            botToken: DISCORD_BOT_TOKEN,
          }),
        },
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reads each channel's credential from its secret file, never from argv", async () => {
    const cases = [
      {
        channel: "zalo",
        file: JSON.stringify({ botToken: "zalo-token", webhookSecret: "zalo-webhook-secret" }),
        body: {
          channel: "zalo",
          account: "oa",
          botToken: "zalo-token",
          webhookSecret: "zalo-webhook-secret",
        },
      },
      {
        channel: "zalo",
        // A raw token file is the preferred shape for a bot-token channel.
        file: "  zalo-token\n",
        body: { channel: "zalo", account: "oa", botToken: "zalo-token" },
      },
      {
        channel: "feishu",
        file: JSON.stringify({
          appId: "cli_fusion",
          appSecret: "feishu-secret",
          verificationToken: "verify",
          encryptKey: "encrypt",
          domain: "lark",
        }),
        body: {
          channel: "feishu",
          account: "oa",
          appId: "cli_fusion",
          appSecret: "feishu-secret",
          verificationToken: "verify",
          encryptKey: "encrypt",
          domain: "lark",
        },
      },
      {
        channel: "googlechat",
        // The file the Google Cloud console downloads IS the credential.
        file: '{"type":"service_account","client_email":"bot@x.iam.gserviceaccount.com"}',
        body: {
          channel: "googlechat",
          account: "oa",
          serviceAccount:
            '{"type":"service_account","client_email":"bot@x.iam.gserviceaccount.com"}',
        },
      },
      {
        channel: "googlechat",
        file: JSON.stringify({ serviceAccountFile: "/run/secrets/googlechat.json" }),
        body: {
          channel: "googlechat",
          account: "oa",
          serviceAccountFile: "/run/secrets/googlechat.json",
        },
      },
    ];
    const directory = mkdtempSync(join(tmpdir(), "channels-secret-"));
    try {
      for (const [index, testCase] of cases.entries()) {
        const requests: RecordedRequest[] = [];
        const target = await startServer((_method, url) => {
          if (url === "/api/v1/channels") {
            return {
              status: 200,
              body: {
                channel: testCase.channel,
                account: "oa",
                installed: true,
                revision: true,
                transport: "started",
              },
            };
          }
          return { status: 404, rawBody: "Not Found" };
        }, requests);
        const secretFile = join(directory, `${testCase.channel}-${index}.json`);
        writeFileSync(secretFile, testCase.file, { mode: 0o600 });
        const result = await runChannelsAddCommand(
          testCase.channel,
          { hub: target.origin, account: "oa", secretFile },
          new Command(),
        );
        assert.equal(result.data.channel, testCase.channel);
        assert.equal(requests[0]?.body, JSON.stringify(testCase.body));
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("names the missing field when a secret file has the wrong shape", async () => {
    const directory = mkdtempSync(join(tmpdir(), "channels-secret-"));
    try {
      const secretFile = join(directory, "feishu.json");
      writeFileSync(secretFile, JSON.stringify({ appId: "cli_fusion" }), { mode: 0o600 });
      await assert.rejects(
        () =>
          runChannelsAddCommand(
            "feishu",
            { hub: "http://127.0.0.1:1", account: "oa", secretFile },
            new Command(),
          ),
        (error: unknown) => {
          const failure = error as { code?: string; message?: string };
          assert.equal(failure.code, "SECRET_FILE_INVALID");
          assert.match(failure.message ?? "", /`appId` and `appSecret`/u);
          // The file's contents are never echoed back.
          assert.equal((failure.message ?? "").includes("cli_fusion"), false);
          return true;
        },
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a channel the control plane does not install", async () => {
    await assert.rejects(
      () =>
        runChannelsAddCommand(
          "matrix",
          { hub: "http://127.0.0.1:1", account: "main" },
          new Command(),
        ),
      (error: unknown) => (error as { code?: string }).code === "INVALID_CHANNEL",
    );
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

  it("lists the accounts under `ls`, with `list` still routing to it", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/channels") {
        return {
          status: 200,
          body: {
            accounts: [{ channel: "slack", account: "main", enabled: true, transport: "socket" }],
          },
        };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);

    const result = await runChannelsListCommand({ hub: target.origin }, new Command());

    assert.deepEqual(result.data, [
      { channel: "slack", account: "main", enabled: true, transport: "socket" },
    ]);
    const list = createChannelsCommand().commands.find((command) => command.name() === "ls");
    assert.deepEqual(list?.aliases(), ["list"]);
  });

  it("DELETEs the account only once the removal is confirmed", async () => {
    const requests: RecordedRequest[] = [];
    const target = await startServer((_method, url) => {
      if (url === "/api/v1/channels") {
        return {
          status: 200,
          body: {
            channel: "telegram",
            account: "dev",
            removed: true,
            revision: true,
            connectionId: "00000000-0000-4000-8000-000000000002",
          },
        };
      }
      return { status: 404, rawBody: "Not Found" };
    }, requests);

    // Without --yes the verb must not reach the Hub at all.
    await assert.rejects(
      runChannelsRemoveCommand("telegram", { hub: target.origin, account: "dev" }, new Command()),
      (error: unknown) => (error as { code?: string }).code === "CONFIRMATION_REQUIRED",
    );
    assert.deepEqual(requests, []);

    const result = await runChannelsRemoveCommand(
      "telegram",
      { hub: target.origin, account: "dev", yes: true },
      new Command(),
    );

    assert.equal(result.data.removed, true);
    assert.equal(result.data.connectionId, "00000000-0000-4000-8000-000000000002");
    assert.deepEqual(requests, [
      {
        method: "DELETE",
        url: "/api/v1/channels",
        authorization: null,
        body: JSON.stringify({ channel: "telegram", account: "dev" }),
      },
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
