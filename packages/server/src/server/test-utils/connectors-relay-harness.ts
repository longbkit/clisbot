import { readConnectorsOff } from "@clisbot/protocol/connectors/types";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import pino from "pino";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect } from "vitest";
import type { ConnectorGrant } from "@clisbot/protocol/connectors/types";
import type { AgentPermissionRequest, AgentPermissionResponse } from "../agent/agent-sdk-types.js";
import { ConnectorRelay } from "../connectors/connector-relay.js";
import { mountConnectorRelayBodyParser } from "../connectors/connectors-daemon.js";
import {
  ConnectorRuntime,
  CONNECTORS_RELAY_ROUTE,
  type ConnectorProjectDirectory,
} from "../connectors/connector-runtime.js";
import { ConnectorService } from "../connectors/connector-service.js";
import { createStdioServers } from "../connectors/connector-stdio.js";

/**
 * The whole Connector path against real HTTP, for the relay tests: a local stand-in for
 * Composio's REST API and its session MCP endpoint, the daemon relay mounted on express, and the
 * MCP SDK client an agent would use. Only Composio itself is faked.
 */

export const API_KEY = "ak_test_project_key";

export interface FakeComposio {
  url: string;
  calls: string[];
  accounts: { id: string; alias?: string; status: string; toolkit: string }[];
  /** What the session MCP endpoint does: answer, refuse with a status, or hold `initialize`. */
  mcp: { status?: number; holdInitialize?: Promise<void> };
  /** The project's own auth configs, the sessions created, and how REST calls misbehave. */
  authConfigs: { id: string; toolkit: { slug: string }; is_composio_managed: boolean }[];
  sessionsCreated: { auth_configs?: Record<string, string> }[];
  rest: {
    accountsStatus?: number;
    toolkitsStatus?: number;
    linkUrl?: string;
    linkError?: string;
    /** How many times the connected accounts were read. */
    accountReads: number;
  };
  /** The arguments of every `tools/call` that reached Composio, in order. */
  callArgs: unknown[];
  /** Drops every MCP session, as Composio does when one expires. */
  forgetSessions(): void;
  close(): Promise<void>;
}

export function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

export async function startFakeComposio(): Promise<FakeComposio> {
  const calls: string[] = [];
  const accounts: FakeComposio["accounts"] = [];
  const mcp: FakeComposio["mcp"] = {};
  const sessions = new Set<string>();
  const authConfigs: FakeComposio["authConfigs"] = [];
  const sessionsCreated: FakeComposio["sessionsCreated"] = [];
  const rest: FakeComposio["rest"] = { accountReads: 0 };
  const callArgs: unknown[] = [];
  const app = express();
  // Composio takes whole emails and documents; the default 100 KB would refuse them.
  app.use(express.json({ limit: "16mb" }));
  let base = "";
  app.use((req, res, next) => {
    if (req.header("x-api-key") !== API_KEY) {
      res.status(401).json({ error: { message: "bad key" } });
      return;
    }
    next();
  });
  const session = () => ({
    session_id: `trs_${sessionsCreated.length}`,
    mcp: { type: "http", url: `${base}/mcp` },
    config: { auth_configs: sessionsCreated.at(-1)?.auth_configs },
  });
  app.post("/tool_router/session", (req, res) => {
    sessionsCreated.push({ auth_configs: req.body.auth_configs });
    res.json(session());
  });
  app.get("/tool_router/session/:id", (_req, res) => res.json(session()));
  app.get("/auth_configs", (_req, res) => res.json({ items: authConfigs, next_cursor: null }));
  app.get("/toolkits", (req, res) =>
    rest.toolkitsStatus
      ? res.status(rest.toolkitsStatus).json({ error: { message: "catalog down" } })
      : res.json({
          items: [
            {
              slug: "gmail",
              name: "Gmail",
              meta: { description: "Email", logo: "https://logos/gmail.png", tools_count: 3 },
            },
            {
              slug: "notion",
              name: "Notion",
              meta: { description: "Docs", logo: "http://insecure/logo.png" },
            },
            {
              slug: "hackernews",
              name: "Hacker News",
              no_auth: true,
              meta: { description: "News" },
            },
            { slug: "googlecalendar", name: "Google Calendar", meta: { description: "Calendar" } },
          ].filter((item) => !req.query.search || item.slug.includes(String(req.query.search))),
          next_cursor: null,
          total_items: 2,
        }),
  );
  app.get("/connected_accounts", (_req, res) =>
    ++rest.accountReads && rest.accountsStatus
      ? res.status(rest.accountsStatus).json({ error: { message: "scope" } })
      : res.json({
          items: accounts.map((account) => ({ ...account, toolkit: { slug: account.toolkit } })),
          next_cursor: null,
        }),
  );
  app.post("/tool_router/session/:id/link", (req, res) => {
    if (rest.linkError) {
      res.status(400).json({ error: { message: rest.linkError } });
      return;
    }
    if (rest.linkUrl) {
      res.json({ redirect_url: rest.linkUrl });
      return;
    }
    const id = `ca_${accounts.length + 1}`;
    accounts.push({ id, alias: req.body.alias, status: "INITIATED", toolkit: req.body.toolkit });
    res.json({ redirect_url: `https://connect.composio.dev/link/${id}` });
  });
  app.delete("/connected_accounts/:id", (req, res) => {
    const index = accounts.findIndex((account) => account.id === req.params.id);
    accounts.splice(index, 1);
    res.json({ success: true });
  });
  app.get("/tools", (req, res) =>
    res.json({
      // Calendar's tools carry Composio's hints, as the real catalog does (checked 2026-10-06).
      items:
        req.query.toolkit_slug === "googlecalendar"
          ? [
              { slug: "GOOGLECALENDAR_EVENTS_LIST", tags: ["readOnlyHint", "Events Management"] },
              { slug: "GOOGLECALENDAR_CREATE_EVENT", tags: ["createHint", "openWorldHint"] },
            ]
          : [{ slug: "GMAIL_FETCH_EMAILS" }, { slug: "GMAIL_SEND_EMAIL" }],
      next_cursor: null,
    }),
  );
  async function answerMcp(req: express.Request, res: express.Response): Promise<void> {
    const frame = req.body as {
      id?: unknown;
      method: string;
      params?: { name?: string; arguments?: unknown };
    };
    calls.push(frame.method === "tools/call" ? `call:${frame.params?.name}` : frame.method);
    if (frame.method === "tools/call") callArgs.push(frame.params?.arguments);
    if (mcp.status) {
      res.status(mcp.status).json({ error: { message: "refused" } });
      return;
    }
    if (frame.method === "initialize") {
      await mcp.holdInitialize;
      const id = `mcs_${sessions.size + 1}_${calls.length}`;
      sessions.add(id);
      res.setHeader("mcp-session-id", id);
      res.json(
        rpcResult(frame.id, {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-composio", version: "1" },
        }),
      );
      return;
    }
    if (!sessions.has(req.header("mcp-session-id") ?? "")) {
      res.status(404).json({ error: { message: "Session not found" } });
      return;
    }
    if (frame.method === "tools/list") {
      res.json(
        rpcResult(frame.id, {
          tools: [
            "COMPOSIO_SEARCH_TOOLS",
            "COMPOSIO_MULTI_EXECUTE_TOOL",
            "COMPOSIO_REMOTE_WORKBENCH",
            "COMPOSIO_FUTURE_TOOL",
          ].map((name) => ({ name, inputSchema: { type: "object" } })),
        }),
      );
      return;
    }
    if (frame.method === "tools/call") {
      res.json(
        rpcResult(frame.id, { content: [{ type: "text", text: `ran ${frame.params?.name}` }] }),
      );
      return;
    }
    res.status(202).end();
  }
  app.post("/mcp", (req, res) => {
    void answerMcp(req, res);
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: base,
    calls,
    accounts,
    mcp,
    authConfigs,
    sessionsCreated,
    rest,
    callArgs,
    forgetSessions: () => sessions.clear(),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export const PROJECT_ID = "prj_1";
export const ROOT = "/projects/chief";

/** One relay with its fakes; tests change the mutable fields to steer it. */
export interface RelayHarness {
  home: string;
  composio: FakeComposio;
  service: ConnectorService;
  runtime: ConnectorRuntime;
  daemonUrl: string;
  /** The Project's root; sessions whose cwd is this belong to it. */
  root: string;
  /** The agent's labels, for the per-session off list. */
  labels: Record<string, string>;
  /** Whether the agent is running, closed or deleted, for its token. */
  agentState: "active" | "closed" | "gone";
  asked: AgentPermissionRequest[];
  closed: { requestId: string; response: AgentPermissionResponse }[];
  /** How the person answers a request the daemon raises. */
  answer: AgentPermissionResponse;
  /** What the person does in the app while a card is open, before answering it. */
  whileAsked: (request: Omit<AgentPermissionRequest, "provider">) => Promise<void>;
  setGrant(grant: ConnectorGrant | null): Promise<void>;
  connectAccounts(grant: ConnectorGrant): void;
  connectAgent(
    grant: ConnectorGrant,
  ): Promise<{ client: Client; servers: Record<string, unknown> }>;
  close(): Promise<void>;
}

export async function createRelayHarness(): Promise<RelayHarness> {
  const home = await mkdtemp(path.join(os.tmpdir(), "connectors-relay-"));
  const composio = await startFakeComposio();
  const service = new ConnectorService({
    config: { enabled: true, composioApiUrl: composio.url },
    clisbotHome: home,
    logger: pino({ level: "silent" }),
  });
  const h = { home, composio, service } as RelayHarness;
  h.root = ROOT;
  h.labels = {};
  h.agentState = "active";
  h.asked = [];
  h.closed = [];
  h.answer = { behavior: "allow" };
  h.whileAsked = async () => undefined;
  const directory: ConnectorProjectDirectory = {
    projectForCwd: async (cwd) =>
      cwd === h.root ? { projectId: PROJECT_ID, rootPath: h.root } : null,
    project: async (id) => (id === PROJECT_ID ? { projectId: id, rootPath: h.root } : null),
    agentLabels: () => h.labels,
    offList: async () => readConnectorsOff(h.labels),
    allowOwners: (agentId) => [agentId],
    agentCwd: () => h.root,
    agentState: () => h.agentState,
  };
  // The connect card polls quickly here: four looks, no real waiting.
  h.runtime = new ConnectorRuntime(service, directory, undefined, {
    pollMs: 1,
    waitMs: 4,
    sleep: () => Promise.resolve(),
  });
  h.runtime.setPermissionHost({
    requestDaemonPermission: async (_agentId, request) => {
      h.asked.push({ ...request, provider: "codex" });
      await h.whileAsked(request);
      return h.answer;
    },
    resolveDaemonPermission: async (_agentId, requestId, response) => {
      h.closed.push({ requestId, response });
    },
  });
  const app = express();
  // As in bootstrap.ts: the relay's own body limit first, then the default parser.
  mountConnectorRelayBodyParser(app, { enabled: true });
  app.use(express.json());
  const stdio = createStdioServers({ logger: pino({ level: "silent" }) });
  new ConnectorRelay(h.runtime, stdio, pino({ level: "silent" })).mount(app);
  const daemon = http.createServer(app);
  await new Promise<void>((resolve) => daemon.listen(0, "127.0.0.1", resolve));
  h.daemonUrl = `http://127.0.0.1:${(daemon.address() as AddressInfo).port}`;
  h.runtime.setRelayBaseUrl(`${h.daemonUrl}${CONNECTORS_RELAY_ROUTE}`);
  h.setGrant = (grant) => service.store.setProjectGrant(PROJECT_ID, grant);

  /** A working account for every granted app, as after a finished sign-in. */
  h.connectAccounts = (grant) => {
    for (const toolkit of Object.keys(grant.apps ?? {})) {
      if (!h.composio.accounts.some((account) => account.toolkit === toolkit)) {
        h.composio.accounts.push({ id: `ca_${toolkit}`, status: "ACTIVE", toolkit });
      }
    }
  };

  h.connectAgent = async (grant) => {
    await h.setGrant(grant);
    h.connectAccounts(grant);
    const { servers, preapproved } = await h.runtime.mcpServersForAgent({
      agentId: "agent-1",
      cwd: h.root,
    });
    expect(preapproved.map((ref) => ref.tool)).toContain("COMPOSIO_MULTI_EXECUTE_TOOL");
    expect(preapproved.map((ref) => ref.tool)).not.toContain("COMPOSIO_REMOTE_WORKBENCH");
    const entry = servers.connectors_composio;
    if (!entry || entry.type !== "http") throw new Error("no composio entry");
    const client = new Client({ name: "agent", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(entry.url), {
        requestInit: { headers: entry.headers },
      }),
    );
    return { client, servers };
  };
  h.close = async () => {
    await stdio.stopAll();
    await new Promise<void>((resolve) => daemon.close(() => resolve()));
    await composio.close();
    await rm(home, { recursive: true, force: true });
  };
  return h;
}
