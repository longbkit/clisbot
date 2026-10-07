import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectorStore, ConnectorStoreError } from "./connector-store.js";

describe("ConnectorStore", () => {
  let directory: string;
  let store: ConnectorStore;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "connectors-store-"));
    store = new ConnectorStore(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps the Composio key out of settings and in a private file", async () => {
    await store.setComposio({
      apiKey: "ak_secret_value_1234",
      userId: "clisbot_u",
      sessionId: "trs_1",
    });
    const settings = await store.settings();
    expect(settings.composio).toEqual({ configured: true, keyHint: "ak_…1234" });
    expect(JSON.stringify(settings)).not.toContain("secret_value");
    const config = await readFile(path.join(directory, "connectors.json"), "utf8");
    expect(config).not.toContain("ak_secret");
    if (process.platform !== "win32") {
      const mode = (await stat(path.join(directory, "secrets.json"))).mode & 0o777;
      expect(mode).toBe(0o600);
    }
    expect(await store.composioApiKey()).toBe("ak_secret_value_1234");
  });

  it("gives a new server none of the secrets a crash left under its name", async () => {
    // A removal that stopped between its two writes: the config is gone, the secrets are not.
    await writeFile(
      path.join(directory, "secrets.json"),
      JSON.stringify({ version: 1, mcpServers: { notes: { headers: { Authorization: "old" } } } }),
    );
    await store.saveMcpServer({
      server: { name: "notes", transport: "http", url: "https://mcp.example.com/notes" },
    });
    expect((await store.mcpServer("notes"))?.secrets.headers).toEqual({});
  });

  it("keeps a renamed server's secrets under its new name only", async () => {
    await store.saveMcpServer({
      server: { name: "notes", transport: "http", url: "https://mcp.example.com/notes" },
      headers: { Authorization: "Bearer n" },
    });
    await store.saveMcpServer({
      previousName: "notes",
      server: { name: "notes2", transport: "http", url: "https://mcp.example.com/notes" },
    });
    expect((await store.mcpServer("notes2"))?.secrets.headers).toEqual({
      Authorization: "Bearer n",
    });
    const secrets = await readFile(path.join(directory, "secrets.json"), "utf8");
    expect(Object.keys(JSON.parse(secrets).mcpServers)).toEqual(["notes2"]);
  });

  it("forgets the key but keeps the Composio user so accounts are found again", async () => {
    await store.setComposio({
      apiKey: "ak_secret_value_1234",
      userId: "clisbot_u",
      sessionId: "trs_1",
    });
    await store.setComposio(null);
    expect((await store.settings()).composio).toEqual({ configured: false });
    expect(await store.composioIdentity()).toEqual({ userId: "clisbot_u" });
  });

  it("saves an MCP server with header names shown and values kept, and renames it", async () => {
    await store.saveMcpServer({
      server: { name: "linear", transport: "http", url: "https://mcp.linear.app/mcp" },
      headers: { Authorization: "Bearer lin_123" },
    });
    expect((await store.settings()).mcpServers).toEqual([
      {
        name: "linear",
        transport: "http",
        url: "https://mcp.linear.app/mcp",
        headerKeys: ["Authorization"],
        envKeys: [],
      },
    ]);
    // An edit without header values keeps the stored ones.
    await store.saveMcpServer({
      previousName: "linear",
      server: { name: "issues", transport: "http", url: "https://mcp.linear.app/mcp" },
    });
    const renamed = await store.mcpServer("issues");
    expect(renamed?.secrets.headers).toEqual({ Authorization: "Bearer lin_123" });
    expect(await store.mcpServer("linear")).toBeNull();
    await store.saveMcpServer({
      previousName: "issues",
      server: { name: "issues", transport: "http", url: "https://mcp.linear.app/mcp" },
      headers: { Authorization: null },
    });
    expect((await store.mcpServer("issues"))?.secrets.headers).toEqual({});
  });

  it("refuses bad names, plain http to another host, and credentials in the URL", async () => {
    const attempts = [
      { name: "Linear", transport: "http" as const, url: "https://x.dev" },
      { name: "linear", transport: "http" as const, url: "http://example.com/mcp" },
      { name: "linear", transport: "http" as const, url: "https://user:pw@example.com/mcp" },
      { name: "files", transport: "stdio" as const, command: "  " },
    ];
    for (const server of attempts) {
      await expect(store.saveMcpServer({ server })).rejects.toBeInstanceOf(ConnectorStoreError);
    }
    await expect(
      store.saveMcpServer({
        server: { name: "local", transport: "http", url: "http://127.0.0.1:9000/mcp" },
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps Clisbot's variables, multi-line headers and oversized servers out", async () => {
    const refused: Parameters<ConnectorStore["saveMcpServer"]>[0][] = [
      { server: { name: "a", transport: "stdio", command: "x" }, env: { CLISBOT_HOME: "/" } },
      { server: { name: "a", transport: "stdio", command: "x" }, env: { clisbot_token: "1" } },
      {
        server: { name: "a", transport: "http", url: "https://mcp.example.com" },
        headers: { Authorization: "Bearer a\r\nX-Evil: 1" },
      },
      {
        server: { name: "a", transport: "stdio", command: "x", args: Array(65).fill("-v") },
      },
      {
        server: { name: "a", transport: "stdio", command: "x" },
        env: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`V${i}`, "1"])),
      },
    ];
    for (const input of refused) {
      await expect(store.saveMcpServer(input)).rejects.toMatchObject({ code: "invalid_request" });
    }
  });

  it("keeps a paused server paused on edit, and moves or drops grants with a rename or removal", async () => {
    await store.saveMcpServer({
      server: { name: "notes", transport: "stdio", command: "notes", enabled: false },
    });
    await store.setProjectGrant("prj_1", { mcpServers: { notes: { tools: ["read"] } } });
    await store.saveMcpServer({
      previousName: "notes",
      server: { name: "notebook", transport: "stdio", command: "notes --v2" },
    });
    expect((await store.settings()).mcpServers).toMatchObject([
      { name: "notebook", enabled: false },
    ]);
    expect((await store.projectGrants()).prj_1?.mcpServers).toEqual({
      notebook: { tools: ["read"] },
    });
    await store.removeMcpServer("notebook");
    expect((await store.projectGrants()).prj_1?.mcpServers).toEqual({});
    await expect(
      store.saveMcpServer({ server: { name: "x", transport: "sse", url: "https://x.dev" } }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("refuses a rename onto an existing server and removes servers with their secrets", async () => {
    await store.saveMcpServer({
      server: { name: "a", transport: "stdio", command: "a-server" },
      env: { TOKEN: "1" },
    });
    await store.saveMcpServer({ server: { name: "b", transport: "stdio", command: "b-server" } });
    await expect(
      store.saveMcpServer({
        previousName: "a",
        server: { name: "b", transport: "stdio", command: "x" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await store.removeMcpServer("a");
    expect((await store.settings()).mcpServers.map((server) => server.name)).toEqual(["b"]);
    const secrets = await readFile(path.join(directory, "secrets.json"), "utf8");
    expect(secrets).not.toContain("TOKEN");
    await expect(store.removeMcpServer("a")).rejects.toMatchObject({ code: "not_found" });
  });
});
