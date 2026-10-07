import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTOR_CARD_METADATA,
  CONNECTORS_OFF_LABEL,
  type ConnectorGrant,
} from "@clisbot/protocol/connectors/types";
import type { AgentPermissionResponse } from "../agent/agent-sdk-types.js";
import { ConnectorConnectFlow } from "./connector-connect.js";
import {
  API_KEY,
  createRelayHarness,
  PROJECT_ID,
  type RelayHarness,
} from "../test-utils/connectors-relay-harness.js";

/** Connect cards, Project grants and per-session switches through the relay. */
describe("Connector cards and sessions", () => {
  let h: RelayHarness;

  beforeEach(async () => {
    h = await createRelayHarness();
  });

  afterEach(() => h.close());

  it("signs in with the project's own auth configs, and degrades on what a key may not do", async () => {
    h.composio.authConfigs.push({
      id: "ac_twitter",
      toolkit: { slug: "twitter" },
      is_composio_managed: false,
    });
    await h.service.setComposioKey(API_KEY);
    expect(h.composio.sessionsCreated.at(-1)?.auth_configs).toEqual({ twitter: "ac_twitter" });

    // A config made after the session exists is only used by a new session, made on Connect.
    h.composio.authConfigs.push({
      id: "ac_x",
      toolkit: { slug: "linkedin" },
      is_composio_managed: false,
    });
    await h.service.connect("linkedin");
    expect(h.composio.sessionsCreated.at(-1)?.auth_configs).toEqual({
      linkedin: "ac_x",
      twitter: "ac_twitter",
    });
    const created = h.composio.sessionsCreated.length;
    await h.service.connect("linkedin", "second");
    expect(h.composio.sessionsCreated).toHaveLength(created);

    // A key that may not list accounts still connects.
    h.composio.rest.accountsStatus = 403;
    await expect(h.service.connect("gmail")).resolves.toMatch(
      /^https:\/\/connect\.composio\.dev\//,
    );
    h.composio.rest.accountsStatus = undefined;

    h.composio.rest.linkError = "No auth config found for toolkit hubspot";
    await expect(h.service.connect("hubspot")).rejects.toThrow("Create an auth config");
    h.composio.rest.linkError = undefined;

    h.composio.rest.linkUrl = "https://composio-login.example.com/oauth";
    await expect(h.service.connect("gmail", "work")).rejects.toMatchObject({
      code: "upstream_unavailable",
    });
    h.composio.rest.linkUrl = undefined;

    // Composio slugs can start with "_".
    await expect(h.service.connect("_1password")).resolves.toMatch(
      /^https:\/\/connect\.composio\.dev\//,
    );
  });

  it("leaves off what one session turned off, and lets it turn it back on", async () => {
    await h.service.setComposioKey(API_KEY);
    await h.setGrant({ apps: { gmail: { tools: "all", access: "write" } } });
    // A session that starts with Gmail off still gets the server and its tool list, so turning
    // Gmail back on mid-session works.
    h.labels = { [CONNECTORS_OFF_LABEL]: "gmail" };
    const { client } = await h.connectAgent({ apps: { gmail: { tools: "all", access: "write" } } });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
      "COMPOSIO_MULTI_EXECUTE_TOOL",
    );
    h.labels = { [CONNECTORS_OFF_LABEL]: "gmail,mcp:notes" };
    const off = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS" }] },
    });
    expect(off.isError).toBe(true);
    expect(JSON.stringify(off.content)).toContain("turned off");
    h.labels = {};
    const on = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS" }] },
    });
    expect(on.isError).toBeFalsy();
    await client.close();
  });

  it("holds a call to an app with no account behind a connect card, then runs it", async () => {
    await h.service.setComposioKey(API_KEY);
    const grant: ConnectorGrant = { apps: { gmail: { tools: "all", access: "read" } } };
    await h.setGrant(grant);
    const { client } = await h.connectAgent(grant);
    h.composio.accounts.length = 0;
    h.whileAsked = async () => {
      // The person presses Connect and finishes the sign-in.
      h.composio.accounts.push({ id: "ca_new", status: "ACTIVE", toolkit: "gmail" });
    };
    const read = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS" }] },
    });
    expect(read.isError).toBeFalsy();
    expect(h.asked[0]?.title).toBe("Connect Gmail to continue");
    expect(h.asked[0]?.metadata?.[CONNECTOR_CARD_METADATA]).toMatchObject({
      action: "connect",
      app: "gmail",
      projectId: PROJECT_ID,
    });
    expect(h.closed).toEqual([{ requestId: h.asked[0]!.id, response: { behavior: "allow" } }]);

    h.composio.accounts.length = 0;
    h.whileAsked = async () => undefined;
    h.answer = { behavior: "deny" };
    const declined = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS" }] },
    });
    expect(JSON.stringify(declined.content)).toContain("chose not to connect Gmail");
    expect(
      h.composio.calls.filter((call) => call === "call:COMPOSIO_MULTI_EXECUTE_TOOL"),
    ).toHaveLength(1);
    await client.close();
  });

  it("runs an app that needs no sign-in without a connect card", async () => {
    await h.service.setComposioKey(API_KEY);
    const grant: ConnectorGrant = { apps: { hackernews: { tools: "all", access: "read" } } };
    await h.setGrant(grant);
    const { client } = await h.connectAgent(grant);
    // Composio keeps no account for such an app (checked live on 2026-10-06).
    h.composio.accounts.length = 0;
    const read = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "HACKERNEWS_GET_MAX_ITEM_ID" }] },
    });
    expect(read.isError).toBeFalsy();
    expect(h.asked).toEqual([]);
    await client.close();
  });

  it("asks before using an app the Project lacks; Allow counts only if the grant changed", async () => {
    await h.service.setComposioKey(API_KEY);
    const { client } = await h.connectAgent({ apps: { gmail: { tools: "all", access: "read" } } });
    h.composio.accounts.push({ id: "ca_gh", status: "ACTIVE", toolkit: "github" });
    const listIssues = {
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "GITHUB_LIST_ISSUES" }] },
    };
    // Allow from someone who could not change the grant changes nothing.
    const notChanged = await client.callTool(listIssues);
    expect(notChanged.isError).toBe(true);
    expect(h.asked.at(-1)?.metadata?.[CONNECTOR_CARD_METADATA]).toMatchObject({ action: "grant" });

    h.whileAsked = async () => {
      await h.setGrant({
        apps: {
          gmail: { tools: "all", access: "read" },
          github: { tools: "all", access: "read" },
        },
      });
    };
    expect((await client.callTool(listIssues)).isError).toBeFalsy();

    // An agent asking Composio to connect an app gets the card and a plain answer.
    h.composio.accounts.length = 0;
    h.whileAsked = async () => {
      h.composio.accounts.push({ id: "ca_gh2", status: "ACTIVE", toolkit: "github" });
    };
    const connected = await client.callTool({
      name: "COMPOSIO_MANAGE_CONNECTIONS",
      arguments: { toolkits: ["github"] },
    });
    expect(JSON.stringify(connected.content)).toContain("Connected: github");
    expect(h.composio.calls).not.toContain("call:COMPOSIO_MANAGE_CONNECTIONS");
    await client.close();
  });

  it("lets one Allow send once: the same send again asks again", async () => {
    await h.service.setComposioKey(API_KEY);
    const { client } = await h.connectAgent({ apps: { gmail: { tools: "all", access: "write" } } });
    const send = {
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { to: "a@b.c" } }] },
    };
    expect((await client.callTool(send)).isError).toBeFalsy();
    expect((await client.callTool(send)).isError).toBeFalsy();
    expect(h.asked).toHaveLength(2);
    expect(new Set(h.asked.map((request) => request.id)).size).toBe(2);

    await client.close();
  });

  it("ends a card cleanly when its agent is gone", async () => {
    await h.service.setComposioKey(API_KEY);
    const grant: ConnectorGrant = { apps: { trello: { tools: "all", access: "read" } } };
    const { client } = await h.connectAgent(grant);
    h.composio.accounts.length = 0;
    h.runtime.setPermissionHost({
      requestDaemonPermission: () => Promise.reject(new Error("Agent has no managed session")),
    });
    const read = await client.callTool({
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "TRELLO_GET_BOARDS" }] },
    });
    expect(read.isError).toBe(true);
    expect(JSON.stringify(read.content)).toContain("ended");
    await client.close();
  });

  it("lets a retry wait on the open connect card and keeps waiting through a failed read", async () => {
    await h.service.setComposioKey(API_KEY);
    const asked: string[] = [];
    const closed: AgentPermissionResponse[] = [];
    const sleeps: (() => void)[] = [];
    const flow = new ConnectorConnectFlow({
      service: h.service,
      host: () => ({
        requestDaemonPermission: (_agentId, request) => {
          asked.push(request.id);
          return new Promise(() => undefined);
        },
        resolveDaemonPermission: async (_agentId, _requestId, response) => {
          closed.push(response);
        },
      }),
      sleep: () => new Promise((resolve) => sleeps.push(() => resolve())),
      pollMs: 1,
      waitMs: 1_000,
    });
    let reads = 0;
    const accounts = h.service.accounts.bind(h.service);
    vi.spyOn(h.service, "accounts").mockImplementation(async (...args) => {
      const answer = await accounts(...args);
      reads += 1;
      return answer;
    });
    const ticket = { agentId: "agent-1", projectId: PROJECT_ID };
    // The agent's MCP client gave up on the first call and sent it again.
    const first = flow.awaitAccounts(ticket, ["gmail"]);
    const retry = flow.awaitAccounts(ticket, ["gmail"]);
    await vi.waitFor(() => {
      expect(reads).toBeGreaterThanOrEqual(3);
      expect(sleeps).toHaveLength(1);
    });

    // Composio fails one look: the card stays and the wait goes on.
    h.composio.rest.accountsStatus = 500;
    sleeps[0]!();
    await vi.waitFor(() => expect(sleeps).toHaveLength(2));
    delete h.composio.rest.accountsStatus;
    h.composio.accounts.push({ id: "ca_new", status: "ACTIVE", toolkit: "gmail" });
    sleeps[1]!();
    await expect(first).resolves.toEqual({ ok: true });
    await expect(retry).resolves.toEqual({ ok: true });
    expect(asked).toHaveLength(1);
    expect(closed).toEqual([{ behavior: "allow" }]);
  });
});
