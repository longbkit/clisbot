import { realpath } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONNECTOR_CARD_METADATA } from "@clisbot/protocol/connectors/types";
import { CONNECTORS_RELAY_ROUTE } from "./connector-runtime.js";
import {
  API_KEY,
  createRelayHarness,
  type RelayHarness,
} from "../test-utils/connectors-relay-harness.js";

/** What a call cannot slip past the relay, against real HTTP and a local Composio stand-in. */
describe("Connector relay refusals", () => {
  let h: RelayHarness;

  beforeEach(async () => {
    h = await createRelayHarness();
  });

  afterEach(() => h.close());

  it("forwards no tools/call sent without an id, and shows every send on the card", async () => {
    await h.service.setComposioKey(API_KEY);
    const { client, servers } = await h.connectAgent({
      apps: { gmail: { tools: "all", access: "write" } },
    });
    const token = (servers.connectors_composio as { headers: Record<string, string> }).headers
      .Authorization!;
    const response = await fetch(`${h.daemonUrl}${CONNECTORS_RELAY_ROUTE}/composio`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: token },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "COMPOSIO_REMOTE_WORKBENCH", arguments: { code: "print(1)" } },
      }),
    });
    expect(response.status).toBe(202);
    expect(h.composio.calls).not.toContain("call:COMPOSIO_REMOTE_WORKBENCH");

    // Two sends through one tool: the card lists both, and declining stops both.
    h.answer = { behavior: "deny" };
    const twice = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: {
        tools: [
          { tool_slug: "GMAIL_SEND_EMAIL", arguments: { to: "boss@co" } },
          { tool_slug: "GMAIL_SEND_EMAIL", arguments: { to: "someone@else" } },
        ],
      },
    });
    expect(twice.isError).toBe(true);
    expect(h.asked.at(-1)?.input).toEqual({
      sends: [
        { tool: "GMAIL_SEND_EMAIL", arguments: { to: "boss@co" } },
        { tool: "GMAIL_SEND_EMAIL", arguments: { to: "someone@else" } },
      ],
    });
    // The send card names the app and lists both recipients.
    expect(h.asked.at(-1)?.metadata?.[CONNECTOR_CARD_METADATA]).toMatchObject({
      action: "send",
      app: "gmail",
      appName: "Gmail",
      fields: [
        { label: "1 · To", value: "boss@co" },
        { label: "2 · To", value: "someone@else" },
      ],
    });
    await client.close();
  });

  it("refuses a multi-execute without a tools list, checks accounts, and takes large calls", async () => {
    await h.service.setComposioKey(API_KEY);
    h.composio.accounts.push(
      { id: "ca_work", alias: "work", status: "ACTIVE", toolkit: "gmail" },
      { id: "ca_home", alias: "home", status: "ACTIVE", toolkit: "gmail" },
    );
    const { client } = await h.connectAgent({
      apps: { gmail: { tools: "all", access: "read", accounts: ["ca_work"] } },
    });
    // Composio requires the `tools` list; a tool named at the top level is not judged or sent.
    const topLevel = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tool_slug: "GMAIL_FETCH_EMAILS", account: "home" },
    });
    expect(topLevel.isError).toBe(true);
    const other = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", account: "home" }] },
    });
    expect(JSON.stringify(other.content)).toContain("may not use");

    // The one account it may use is pinned; a body past the daemon's 100 KB default still arrives.
    const query = "x".repeat(300_000);
    const pinned = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: { query } }] },
    });
    expect(pinned.isError).toBeFalsy();
    expect(h.composio.callArgs.at(-1)).toMatchObject({ tools: [{ account: "ca_work" }] });
    const sent = h.composio.calls.filter((name) => name === "call:COMPOSIO_MULTI_EXECUTE_TOOL");
    expect(sent).toHaveLength(1);
    await client.close();
  });

  it("reads Calendar on a read-only grant and asks before an event that invites people", async () => {
    await h.service.setComposioKey(API_KEY);
    const { client } = await h.connectAgent({
      apps: { googlecalendar: { tools: "all", access: "read" } },
    });
    const run = (tool: string, args: unknown) =>
      client.callTool({
        name: "COMPOSIO_MULTI_EXECUTE_TOOL",
        arguments: { tools: [{ tool_slug: tool, arguments: args }] },
      });
    // Composio tags EVENTS_LIST read-only, though its verb comes last.
    expect(
      (await run("GOOGLECALENDAR_EVENTS_LIST", { calendar_id: "primary" })).isError,
    ).toBeFalsy();
    expect((await run("GOOGLECALENDAR_CREATE_EVENT", { summary: "Focus" })).isError).toBe(true);
    await client.close();

    const writing = await h.connectAgent({
      apps: { googlecalendar: { tools: "all", access: "write" } },
    });
    h.answer = { behavior: "deny" };
    const own = await writing.client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: {
        tools: [{ tool_slug: "GOOGLECALENDAR_CREATE_EVENT", arguments: { summary: "Focus" } }],
      },
    });
    expect(own.isError).toBeFalsy();
    expect(h.asked).toEqual([]);
    const invite = await writing.client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: {
        tools: [
          {
            tool_slug: "GOOGLECALENDAR_CREATE_EVENT",
            arguments: { summary: "Sync", attendees: ["boss@co"] },
          },
        ],
      },
    });
    expect(invite.isError).toBe(true);
    expect(h.asked.map((card) => card.title)).toEqual(["Google Calendar: Create event"]);
    await writing.client.close();
  });

  it("refuses a key that may not read Composio's app list", async () => {
    h.composio.rest.toolkitsStatus = 403;
    await expect(h.service.setComposioKey(API_KEY)).rejects.toThrow("Toolkits: Read");
    expect(h.composio.sessionsCreated).toEqual([]);
  });

  it("refuses app tools while Composio's app list cannot be read", async () => {
    await h.service.setComposioKey(API_KEY);
    h.composio.rest.toolkitsStatus = 500;
    const { client } = await h.connectAgent({ apps: { zoho: { tools: "all", access: "write" } } });
    const call = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "ZOHO_MAIL_SEND_EMAIL" }] },
    });
    expect(call.isError).toBe(true);
    expect(JSON.stringify(call.content)).toContain("app list");
    expect(h.asked).toEqual([]);
    // Searching needs no app list.
    const search = await client.callTool({ name: "COMPOSIO_SEARCH_TOOLS", arguments: {} });
    expect(search.isError).toBeFalsy();
    await client.close();
  });

  it("keeps a local server through a stray stdout line and answers the server's own ping", async () => {
    // The server pings back with the id of the call it is answering, then answers the call.
    const script = [
      "const rl = require('node:readline').createInterface({ input: process.stdin });",
      "const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');",
      "let calling = null;",
      "rl.on('line', (line) => {",
      "  const m = JSON.parse(line);",
      "  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'notes', version: '1' } } });",
      "  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'read_note', inputSchema: { type: 'object' } }] } });",
      "  else if (m.method === 'tools/call') { process.stdout.write('reading notes...\\n'); calling = m.id; send({ jsonrpc: '2.0', id: m.id, method: 'ping' }); }",
      "  else if (m.method === undefined && m.id === calling) send({ jsonrpc: '2.0', id: calling, result: { content: [{ type: 'text', text: 'pong ' + JSON.stringify(m.result) }] } });",
      "});",
    ].join("\n");
    await h.service.saveMcpServer({
      server: {
        name: "notes",
        transport: "stdio",
        command: process.execPath,
        args: ["-e", script],
      },
    });
    h.root = await realpath(h.home);
    await h.setGrant({ mcpServers: { notes: { tools: "all" } } });
    const { servers } = await h.runtime.mcpServersForAgent({ agentId: "agent-1", cwd: h.root });
    const entry = servers.connectors_notes;
    if (!entry || entry.type !== "http") throw new Error("no notes entry");
    const client = new Client({ name: "agent", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(entry.url), {
        requestInit: { headers: entry.headers },
      }),
    );
    for (let round = 0; round < 2; round += 1) {
      const read = await client.callTool({ name: "read_note", arguments: {} });
      expect(read.content).toEqual([{ type: "text", text: "pong {}" }]);
    }
    await client.close();
  });
});
