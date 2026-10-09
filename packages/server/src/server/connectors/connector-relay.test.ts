import http from "node:http";
import type { AddressInfo } from "node:net";
import { realpath } from "node:fs/promises";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONNECTORS_OFF_LABEL } from "@clisbot/protocol/connectors/types";
import { ConnectorRuntime, CONNECTORS_RELAY_ROUTE } from "./connector-runtime.js";
import {
  API_KEY,
  createRelayHarness,
  PROJECT_ID,
  rpcResult,
  type RelayHarness,
} from "../test-utils/connectors-relay-harness.js";

/** The relay against real HTTP and a local Composio stand-in (`connectors-relay-harness.ts`). */
describe("Connector relay", () => {
  let h: RelayHarness;

  beforeEach(async () => {
    h = await createRelayHarness();
  });

  afterEach(() => h.close());

  it("reads a Project's Clisbot tools choice", async () => {
    expect(await h.runtime.clisbotToolsChoice(h.root)).toBeUndefined();
    await h.setGrant({ agentTools: { enabled: true } });
    expect(await h.runtime.clisbotToolsChoice(h.root)).toBe(true);
    await h.setGrant({ agentTools: { enabled: false } });
    expect(await h.runtime.clisbotToolsChoice(h.root)).toBe(false);
    expect(await h.runtime.clisbotToolsChoice("/elsewhere")).toBeUndefined();
    expect(await h.runtime.clisbotToolsChoice(undefined)).toBeUndefined();
  });

  it("checks the key with Composio, lists the catalog and runs the connect flow", async () => {
    await expect(h.service.setComposioKey("not-a-key")).rejects.toMatchObject({
      code: "invalid_request",
    });
    const settings = await h.service.setComposioKey(API_KEY);
    expect(settings.composio).toMatchObject({ configured: true });

    const page = await h.service.catalogPage({});
    expect(page.items).toEqual([
      {
        slug: "gmail",
        name: "Gmail",
        description: "Email",
        logo: "https://logos/gmail.png",
        toolsCount: 3,
      },
      { slug: "notion", name: "Notion", description: "Docs" },
      { slug: "hackernews", name: "Hacker News", description: "News", noAuth: true },
      { slug: "googlecalendar", name: "Google Calendar", description: "Calendar" },
    ]);

    const url = await h.service.connect("gmail");
    expect(url).toBe("https://connect.composio.dev/link/ca_1");
    // A second account needs a name once the first one works.
    h.composio.accounts[0]!.status = "ACTIVE";
    await expect(h.service.connect("gmail")).rejects.toMatchObject({ code: "invalid_request" });
    // Another app's accounts never ask for a name, even if Composio ignores its filter.
    await expect(h.service.connect("notion")).resolves.toMatch(/^https:/);
    await h.service.connect("gmail", "work");
    expect((await h.service.accounts()).find((app) => app.slug === "gmail")?.accounts).toHaveLength(
      2,
    );

    await h.service.removeAccount("ca_1");
    await expect(h.service.removeAccount("ca_404")).rejects.toMatchObject({ code: "not_found" });
    const tools = await h.service.tools({ app: "gmail" });
    expect(tools).toEqual([
      { name: "GMAIL_FETCH_EMAILS", kind: "read" },
      { name: "GMAIL_SEND_EMAIL", kind: "send" },
    ]);
  });

  it("gives an agent of a granted Project only the Composio tools it may see and call", async () => {
    await h.service.setComposioKey(API_KEY);
    const { client } = await h.connectAgent({ apps: { gmail: { tools: "all", access: "write" } } });

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "COMPOSIO_SEARCH_TOOLS",
      "COMPOSIO_MULTI_EXECUTE_TOOL",
    ]);

    const read = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} }] },
    });
    expect(read.isError).toBeFalsy();
    expect(h.asked).toHaveLength(0);

    const other = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "NOTION_SEARCH" }] },
    });
    expect(other.isError).toBe(true);
    expect(h.composio.calls).not.toContain("call:NOTION_SEARCH");

    // A meta-tool Clisbot does not know yet is neither shown nor run.
    const unknown = await client.callTool({ name: "COMPOSIO_FUTURE_TOOL", arguments: {} });
    expect(unknown.isError).toBe(true);
    expect(h.composio.calls).not.toContain("call:COMPOSIO_FUTURE_TOOL");

    // Models write the tool under other keys; the grant reads them all.
    const renamed = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ slug: "NOTION_SEARCH" }] },
    });
    expect(renamed.isError).toBe(true);
    expect(
      h.composio.calls.filter((call) => call === "call:COMPOSIO_MULTI_EXECUTE_TOOL"),
    ).toHaveLength(1);
    await client.close();
  });

  it("tells the agent what its Connectors are, and drops a paused app from the session", async () => {
    await h.service.setComposioKey(API_KEY);
    const { client } = await h.connectAgent({
      apps: {
        gmail: { tools: "all", access: "write" },
        github: { tools: "all", access: "read", enabled: false },
      },
    });
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain("Clisbot Connectors");
    expect(instructions).toContain("gmail (read and write)");
    expect(instructions).not.toContain("github");
    await client.close();

    await h.setGrant({ apps: { gmail: { tools: "all", access: "read", enabled: false } } });
    expect(
      (await h.runtime.mcpServersForAgent({ agentId: "agent-9", cwd: h.root })).servers,
    ).toEqual({});
  });

  it("refuses a tool the session turned off on its own, and keeps the app's other tools", async () => {
    await h.service.setComposioKey(API_KEY);
    const { client } = await h.connectAgent({ apps: { gmail: { tools: "all", access: "read" } } });
    h.labels = { [CONNECTORS_OFF_LABEL]: "gmail/GMAIL_FETCH_EMAILS" };
    const call = (tool: string) =>
      client.callTool({
        name: "COMPOSIO_MULTI_EXECUTE_TOOL",
        arguments: { tools: [{ tool_slug: tool }] },
      });
    const before = h.composio.calls.length;
    const refused = await call("GMAIL_FETCH_EMAILS");
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain("turned off for this session");
    expect(h.composio.calls.slice(before)).toEqual([]);
    expect((await call("GMAIL_GET_PROFILE")).isError).toBeFalsy();
    await client.close();
  });

  it("lets one session use a tool its Project does not give, when the daemon allows it", async () => {
    await h.service.setComposioKey(API_KEY);
    const { client } = await h.connectAgent({ apps: { gmail: { tools: "all", access: "read" } } });
    const archive = () =>
      client.callTool({
        name: "COMPOSIO_MULTI_EXECUTE_TOOL",
        arguments: { tools: [{ tool_slug: "GMAIL_DELETE_DRAFT" }] },
      });
    expect(JSON.stringify((await archive()).content)).toContain("may only read");
    await h.service.setSessionAllows("agent-1", ["gmail/GMAIL_DELETE_DRAFT"]);
    expect(JSON.stringify((await archive()).content)).not.toContain("may only read");
    // The session's own off list still wins.
    h.labels = { [CONNECTORS_OFF_LABEL]: "gmail/GMAIL_DELETE_DRAFT" };
    expect(JSON.stringify((await archive()).content)).toContain("turned off for this session");
    await client.close();
  });

  it("asks before a send, honours a decline, and counts sends when the Project allows them", async () => {
    await h.service.setComposioKey(API_KEY);
    const { client } = await h.connectAgent({ apps: { gmail: { tools: "all", access: "write" } } });
    const send = {
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { to: "a@b.c" } }] },
    };

    h.answer = { behavior: "deny", message: "not now" };
    const declined = await client.callTool(send);
    expect(declined.isError).toBe(true);
    expect(h.asked[0]?.title).toBe("Gmail: Send email");
    expect(h.asked[0]?.input).toEqual({ to: "a@b.c" });
    expect(
      h.composio.calls.filter((call) => call === "call:COMPOSIO_MULTI_EXECUTE_TOOL"),
    ).toHaveLength(0);
    await client.close();

    const allowing = await h.connectAgent({
      apps: { gmail: { tools: "all", access: "write" } },
      sends: "allow",
      dailySendLimit: 1,
    });
    const first = await allowing.client.callTool(send);
    const second = await allowing.client.callTool(send);
    expect(first.isError).toBeFalsy();
    expect(second.isError).toBe(true);
    expect(JSON.stringify(second.content)).toContain("limit of 1");
    await allowing.client.close();

    // The count survives a daemon restart.
    const restarted = new ConnectorRuntime(h.service, h.directory);
    const decision = await restarted.decideSends({
      ticket: { agentId: "agent-1", projectId: PROJECT_ID },
      grant: (await h.service.store.projectGrants())[PROJECT_ID]!,
      tools: [{ name: "GMAIL_SEND_EMAIL", toolkit: "gmail", kind: "send" }],
      args: {},
      serverLabel: "Composio",
    });
    expect(decision.allowed).toBe(false);
  });

  it("turns off the agent's own apps for a Project that asks, even without Connectors", async () => {
    await h.setGrant({ builtInApps: false });
    expect(await h.runtime.mcpServersForAgent({ agentId: "agent-7", cwd: h.root })).toEqual({
      servers: {},
      preapproved: [],
      builtInApps: false,
    });
    await h.setGrant(null);
    expect(
      (await h.runtime.mcpServersForAgent({ agentId: "agent-8", cwd: h.root })).builtInApps,
    ).toBeUndefined();
  });

  it("refuses requests without the agent's token and gives other agents no servers", async () => {
    await h.service.setComposioKey(API_KEY);
    const response = await fetch(`${h.daemonUrl}${CONNECTORS_RELAY_ROUTE}/composio`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer guessed" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    await h.setGrant({ apps: { gmail: { tools: "all", access: "read" } } });
    expect(
      (await h.runtime.mcpServersForAgent({ agentId: "a", cwd: "/elsewhere" })).servers,
    ).toEqual({});
  });

  it("relays a user's remote MCP server with its stored header, filtered to the grant", async () => {
    const upstream = express();
    upstream.use(express.json());
    const seen: string[] = [];
    upstream.post("/mcp", (req, res) => {
      seen.push(req.header("authorization") ?? "");
      const frame = req.body as { id?: unknown; method: string };
      if (frame.method === "initialize") {
        res.json(
          rpcResult(frame.id, {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "linear", version: "1" },
          }),
        );
      } else if (frame.method === "tools/list") {
        res.json(
          rpcResult(frame.id, {
            tools: [
              { name: "list_issues", inputSchema: { type: "object" } },
              { name: "delete_issue", inputSchema: { type: "object" } },
            ],
          }),
        );
      } else if (frame.method === "tools/call") {
        res.json(rpcResult(frame.id, { content: [{ type: "text", text: "ok" }] }));
      } else res.status(202).end();
    });
    const server = http.createServer(upstream);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    await h.service.saveMcpServer({
      server: { name: "linear", transport: "http", url },
      headers: { Authorization: "Bearer lin_secret" },
    });
    await h.setGrant({ mcpServers: { linear: { tools: ["list_issues"] } } });
    const { servers, preapproved } = await h.runtime.mcpServersForAgent({
      agentId: "agent-2",
      cwd: h.root,
    });
    expect(preapproved).toEqual([]);
    const entry = servers.connectors_linear;
    if (!entry || entry.type !== "http") throw new Error("no linear entry");
    expect(JSON.stringify(entry)).not.toContain("lin_secret");
    const client = new Client({ name: "agent", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(entry.url), {
        requestInit: { headers: entry.headers },
      }),
    );
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["list_issues"]);
    expect((await client.callTool({ name: "list_issues", arguments: {} })).isError).toBeFalsy();
    expect((await client.callTool({ name: "delete_issue", arguments: {} })).isError).toBe(true);
    expect(seen.every((header) => header === "Bearer lin_secret")).toBe(true);
    await client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("mounts the server while Composio hangs, and answers its failures as tool results", async () => {
    await h.service.setComposioKey(API_KEY);
    let release = () => {};
    h.composio.mcp.holdInitialize = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { client } = await h.connectAgent({ apps: { gmail: { tools: "all", access: "write" } } });
    expect(client.getInstructions()).toContain("Clisbot Connectors");
    await client.ping();
    release();
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
      "COMPOSIO_SEARCH_TOOLS",
    );

    // Composio refusing must not reach the agent as HTTP 401: its MCP client would start a
    // sign-in against the daemon. A failed call is a tool result the agent can read.
    h.composio.mcp.status = 401;
    const failed = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS" }] },
    });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed.content)).toContain("Composio answered HTTP 401: refused");
    await expect(client.listTools()).rejects.toThrow("Composio answered HTTP 401");
    await client.close();
  });

  it("opens a new Composio session when Composio forgets the old one", async () => {
    await h.service.setComposioKey(API_KEY);
    const { client } = await h.connectAgent({ apps: { gmail: { tools: "all", access: "write" } } });
    await client.listTools();
    h.composio.forgetSessions();
    const read = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS" }] },
    });
    expect(read.isError).toBeFalsy();
    expect(h.composio.calls.filter((call) => call === "initialize")).toHaveLength(2);
    await client.close();
  });

  it("reads the grant again after the person approves a send", async () => {
    await h.service.setComposioKey(API_KEY);
    const { client } = await h.connectAgent({ apps: { gmail: { tools: "all", access: "write" } } });
    h.runtime.setPermissionHost({
      requestDaemonPermission: async () => {
        // The person turns Gmail off for this Project while the approval card is open.
        await h.setGrant({ apps: { gmail: { tools: "all", access: "write", enabled: false } } });
        return { behavior: "allow" };
      },
    });
    const send = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { to: "a@b.c" } }] },
    });
    expect(send.isError).toBe(true);
    expect(JSON.stringify(send.content)).toContain("turned off");
    expect(h.composio.calls).not.toContain("call:COMPOSIO_MULTI_EXECUTE_TOOL");
    await client.close();
  });

  it("runs a local MCP server itself, in the Project's folder, without Clisbot's variables", async () => {
    const script = [
      "const rl = require('node:readline').createInterface({ input: process.stdin });",
      "const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');",
      "rl.on('line', (line) => {",
      "  const m = JSON.parse(line);",
      "  if (m.id === undefined) return;",
      "  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'notes', version: '1' } } });",
      "  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'read_note', inputSchema: { type: 'object' } }, { name: 'delete_note', inputSchema: { type: 'object' } }] } });",
      "  else if (m.method === 'tools/call') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: [m.params.name, process.env.NOTES_TOKEN, process.env.CLISBOT_PROBE ?? 'none', process.env.OPENAI_API_KEY ?? 'none', process.cwd()].join(' ') }] } });",
      "  else send({ jsonrpc: '2.0', id: m.id, result: {} });",
      "});",
    ].join("\n");
    await h.service.saveMcpServer({
      server: {
        name: "notes",
        transport: "stdio",
        command: process.execPath,
        args: ["-e", script],
      },
      env: { NOTES_TOKEN: "notes_secret" },
    });
    await expect(
      h.service.saveMcpServer({
        server: { name: "bad", transport: "stdio", command: "node" },
        env: { CLISBOT_HOME: "/tmp" },
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    h.root = h.home;
    await h.setGrant({ mcpServers: { notes: { tools: ["read_note"] } } });
    const { servers } = await h.runtime.mcpServersForAgent({ agentId: "agent-3", cwd: h.home });
    const entry = servers.connectors_notes;
    if (!entry || entry.type !== "http") throw new Error("no notes entry");
    expect(JSON.stringify(entry)).not.toContain("notes_secret");

    // Only a minimal environment reaches a local server: not Clisbot's, not provider keys.
    const openAiKey = process.env.OPENAI_API_KEY;
    process.env.CLISBOT_PROBE = "leaked";
    process.env.OPENAI_API_KEY = "sk-leaked";
    try {
      const client = new Client({ name: "agent", version: "1" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(entry.url), {
          requestInit: { headers: entry.headers },
        }),
      );
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["read_note"]);
      const read = await client.callTool({ name: "read_note", arguments: {} });
      const realHome = await realpath(h.home);
      expect(read.content).toEqual([
        { type: "text", text: `read_note notes_secret none none ${realHome}` },
      ]);
      expect((await client.callTool({ name: "delete_note", arguments: {} })).isError).toBe(true);
      await client.close();
    } finally {
      delete process.env.CLISBOT_PROBE;
      if (openAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = openAiKey;
    }
  });

  it("reaches no upstream for a target the session may not use, and serves only tool methods", async () => {
    await h.service.setComposioKey(API_KEY);
    await h.service.saveMcpServer({
      server: { name: "linear", transport: "http", url: `${h.composio.url}/mcp` },
    });
    h.composio.accounts.push({ id: "ca_notion", status: "ACTIVE", toolkit: "notion" });
    const { client } = await h.connectAgent({ apps: { gmail: { tools: "all", access: "read" } } });

    // Composio: only tool methods; connections read only within the grant, answered here.
    const frame = (method: string) => ({ jsonrpc: "2.0", id: 9, method, params: {} });
    const post = (route: string, body: unknown, token: string) =>
      fetch(`${h.daemonUrl}${CONNECTORS_RELAY_ROUTE}/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: token },
        body: JSON.stringify(body),
      }).then((response) => response.json() as Promise<{ error?: { code: number } }>);
    const token = String(
      (
        (await h.runtime.mcpServersForAgent({ agentId: "agent-1", cwd: h.root })).servers
          .connectors_composio as { headers: Record<string, string> }
      ).headers.Authorization,
    );
    expect((await post("composio", frame("resources/read"), token)).error?.code).toBe(-32601);
    const listed = await client.callTool({
      name: "COMPOSIO_MANAGE_CONNECTIONS",
      arguments: { action: "list" },
    });
    expect(JSON.stringify(listed.content)).toContain("ca_gmail");
    expect(JSON.stringify(listed.content)).not.toContain("ca_notion");

    // A server the Project was never granted: nothing reaches it.
    const before = h.composio.calls.length;
    expect((await post("server/linear", frame("initialize"), token)).error).toBeUndefined();
    const tools = (await post("server/linear", frame("tools/list"), token)) as {
      result?: { tools: unknown[] };
    };
    expect(tools.result?.tools).toEqual([]);
    const call = (await post(
      "server/linear",
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_issues" } },
      token,
    )) as { result?: { isError?: boolean } };
    expect(call.result?.isError).toBe(true);
    expect(h.composio.calls.slice(before)).toEqual([]);
    await client.close();
  });

  it("refuses a closed agent's token, drops a deleted agent's, and mounts what the Project has", async () => {
    await h.service.setComposioKey(API_KEY);
    const { client } = await h.connectAgent({ apps: { gmail: { tools: "all", access: "read" } } });
    const read = {
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS" }] },
    };
    h.agentState = "closed";
    await expect(client.callTool(read)).rejects.toThrow();
    h.agentState = "active";
    expect((await client.callTool(read)).isError).toBeFalsy();
    h.agentState = "gone";
    await expect(client.callTool(read)).rejects.toThrow();
    h.agentState = "active";
    await expect(client.callTool(read)).rejects.toThrow();
    await client.close().catch(() => undefined);

    // Servers follow the Project's grant; a session's off list applies to its calls only.
    h.labels = { [CONNECTORS_OFF_LABEL]: "gmail" };
    const launched = await h.runtime.mcpServersForAgent({ agentId: "agent-new", cwd: h.root });
    expect(Object.keys(launched.servers)).toEqual(["connectors_composio"]);
  });
});
