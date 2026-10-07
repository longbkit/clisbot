import { describe, expect, it } from "vitest";
import type { ConnectorGrant } from "@clisbot/protocol/connectors/types";
import { classifyConnectorTool, connectorCallKind } from "./connector-tool-kind.js";
import {
  filterToolsListResult,
  judgeComposioFrame,
  judgeMcpServerFrame,
  toolkitOfTool,
} from "./connector-verdict.js";

function call(name: string, args?: unknown) {
  return { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } };
}

const grant: ConnectorGrant = {
  apps: {
    gmail: { tools: "all", access: "write" },
    github: { tools: ["GITHUB_LIST_ISSUES", "GITHUB_CREATE_ISSUE"], access: "read" },
    bland_ai: { tools: "all", access: "write" },
  },
  mcpServers: { linear: { tools: ["list_issues"] } },
};

describe("classifyConnectorTool", () => {
  it.each([
    ["GMAIL_FETCH_EMAILS", "gmail", "read"],
    ["GMAIL_SEND_EMAIL", "gmail", "send"],
    ["GMAIL_CREATE_EMAIL_DRAFT", "gmail", "write"],
    ["GITHUB_CREATE_AN_ISSUE_COMMENT", "github", "send"],
    ["GITHUB_CREATE_ISSUE", "github", "write"],
    ["REDDIT_GET_POST", "reddit", "read"],
    ["SLACK_POST_MESSAGE", "slack", "send"],
    ["sendMessage", undefined, "send"],
    ["list_issues", undefined, "read"],
    ["update_issue", undefined, "write"],
    ["COMPOSIO_PROXY_EXECUTE", undefined, "send"],
    // A query that names what it reads is a read; one that runs whatever text it gets is not.
    ["NOTION_QUERY_DATABASE", "notion", "read"],
    ["GOOGLEBIGQUERY_QUERY", "googlebigquery", "write"],
    ["query_sql", undefined, "write"],
    ["get_graphql", undefined, "write"],
  ] as const)("%s is %s", (name, toolkit, kind) => {
    expect(classifyConnectorTool(name, toolkit)).toBe(kind);
  });
});

describe("connectorCallKind", () => {
  it("trusts a tool's read-only hint over its name", () => {
    // Calendar names its verbs last; the name alone reads EVENTS_LIST as a change.
    expect(classifyConnectorTool("GOOGLECALENDAR_EVENTS_LIST", "googlecalendar")).toBe("write");
    expect(
      classifyConnectorTool("GOOGLECALENDAR_EVENTS_LIST", "googlecalendar", { readOnly: true }),
    ).toBe("read");
    expect(classifyConnectorTool("get_and_reset", undefined, { readOnly: false })).toBe("write");
  });

  it("makes a call that names people to notify a send, but not a draft", () => {
    const event = { name: "GOOGLECALENDAR_CREATE_EVENT", toolkit: "googlecalendar" };
    expect(connectorCallKind(event, { summary: "Focus" })).toBe("write");
    expect(connectorCallKind(event, { summary: "Sync", attendees: ["a@b.co"] })).toBe("send");
    expect(connectorCallKind(event, { attendees: [] })).toBe("write");
    const draft = { name: "GMAIL_CREATE_EMAIL_DRAFT", toolkit: "gmail" };
    expect(connectorCallKind(draft, { to: "a@b.co" })).toBe("write");
    expect(
      connectorCallKind({ name: "GOOGLECALENDAR_ACL_INSERT", toolkit: "googlecalendar" }, {}),
    ).toBe("send");
  });
});

describe("judgeComposioFrame", () => {
  it("reads the tool of an entry under any key a model uses, and refuses two different ones", () => {
    const judge = (entry: Record<string, unknown>) =>
      judgeComposioFrame({
        frame: call("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [entry] }),
        grant,
        knownSlugs: [],
      });
    for (const key of ["tool_slug", "slug", "tool", "name"]) {
      expect(judge({ [key]: "GMAIL_FETCH_EMAILS" })).toMatchObject({ kind: "tools" });
    }
    expect(judge({ tool_slug: "GMAIL_FETCH_EMAILS", slug: "GMAIL_SEND_EMAIL" })).toMatchObject({
      kind: "deny",
    });
  });

  it("matches a tool to the longest app slug Composio knows, not to a granted shorter one", () => {
    expect(toolkitOfTool("ZOHO_MAIL_SEND_EMAIL", ["zoho", "zoho_mail"])).toBe("zoho_mail");
    const verdict = judgeComposioFrame({
      frame: call("COMPOSIO_MULTI_EXECUTE_TOOL", {
        tools: [{ tool_slug: "ZOHO_MAIL_SEND_EMAIL" }],
      }),
      grant: { apps: { zoho: { tools: "all", access: "write" } } },
      knownSlugs: ["zoho", "zoho_mail"],
    });
    expect(verdict).toMatchObject({ kind: "deny", missingApps: ["zoho_mail"] });
  });

  it("treats an access level it does not know as read only", () => {
    const verdict = judgeComposioFrame({
      frame: call("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "GMAIL_SEND_EMAIL" }] }),
      grant: { apps: { gmail: { tools: "all", access: "admin" } } },
      knownSlugs: [],
    });
    expect(verdict).toMatchObject({ kind: "deny" });
  });

  it("refuses Composio meta-tools it does not know, and shows only the ones it does", () => {
    expect(
      judgeComposioFrame({ frame: call("COMPOSIO_FUTURE_TOOL"), grant, knownSlugs: [] }),
    ).toMatchObject({ kind: "deny" });
    expect(
      judgeComposioFrame({ frame: call("COMPOSIO_SEARCH_TOOLS"), grant, knownSlugs: [] }),
    ).toEqual({ kind: "pass" });
  });

  it("lets frames that are not tool calls through", () => {
    expect(judgeComposioFrame({ frame: { method: "tools/list" }, grant, knownSlugs: [] })).toEqual({
      kind: "pass",
    });
  });

  it("reads the target tools of a multi-execute call and classifies them", () => {
    const verdict = judgeComposioFrame({
      frame: call("COMPOSIO_MULTI_EXECUTE_TOOL", {
        tools: [{ tool_slug: "GMAIL_FETCH_EMAILS" }, { tool_slug: "GMAIL_SEND_EMAIL" }],
      }),
      grant,
      knownSlugs: [],
    });
    expect(verdict).toEqual({
      kind: "tools",
      tools: [
        { name: "GMAIL_FETCH_EMAILS", toolkit: "gmail", kind: "read" },
        { name: "GMAIL_SEND_EMAIL", toolkit: "gmail", kind: "send" },
      ],
    });
  });

  it("refuses a tool of an app the Bot may not use", () => {
    const verdict = judgeComposioFrame({
      frame: call("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "NOTION_SEARCH" }] }),
      grant,
      knownSlugs: [],
    });
    expect(verdict.kind).toBe("deny");
  });

  it("refuses a tool outside the picked list and a write on a read-only app", () => {
    const outside = judgeComposioFrame({
      frame: call("GITHUB_DELETE_REPO"),
      grant,
      knownSlugs: [],
    });
    const write = judgeComposioFrame({
      frame: call("GITHUB_CREATE_ISSUE"),
      grant,
      knownSlugs: [],
    });
    expect(outside).toMatchObject({ kind: "deny" });
    expect(write).toMatchObject({ kind: "deny" });
    expect((write as { message: string }).message).toContain("may only read");
  });

  it("refuses a multi-execute call whose targets cannot be read", () => {
    const verdict = judgeComposioFrame({
      frame: call("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{}] }),
      grant,
      knownSlugs: [],
    });
    expect(verdict.kind).toBe("deny");
  });

  it("refuses the workbench, never forwards the connection tools the relay answers itself", () => {
    expect(
      judgeComposioFrame({ frame: call("COMPOSIO_REMOTE_WORKBENCH"), grant, knownSlugs: [] }).kind,
    ).toBe("deny");
    expect(
      judgeComposioFrame({
        frame: call("COMPOSIO_MANAGE_CONNECTIONS", { action: "add", toolkit: "gmail" }),
        grant,
        knownSlugs: [],
      }).kind,
    ).toBe("deny");
    expect(
      judgeComposioFrame({
        frame: call("COMPOSIO_MANAGE_CONNECTIONS", { action: "list" }),
        grant,
        knownSlugs: [],
      }).kind,
    ).toBe("deny");
    expect(
      judgeComposioFrame({ frame: call("COMPOSIO_SEARCH_TOOLS"), grant, knownSlugs: [] }).kind,
    ).toBe("pass");
  });

  it("names every app a call needs that the grant lacks", () => {
    const verdict = judgeComposioFrame({
      frame: call("COMPOSIO_MULTI_EXECUTE_TOOL", {
        tools: [{ tool_slug: "NOTION_SEARCH" }, { tool_slug: "SLACK_LIST_CHANNELS" }],
      }),
      grant,
      knownSlugs: ["notion", "slack"],
    });
    expect(verdict).toMatchObject({ kind: "deny", missingApps: ["notion", "slack"] });
  });

  it("refuses every app tool when the Bot has no grant", () => {
    expect(
      judgeComposioFrame({ frame: call("GMAIL_FETCH_EMAILS"), grant: undefined, knownSlugs: [] })
        .kind,
    ).toBe("deny");
  });

  it("files an underscored app under its own slug", () => {
    expect(toolkitOfTool("BLAND_AI_MAKE_CALL", ["bland", "bland_ai"])).toBe("bland_ai");
    expect(
      judgeComposioFrame({ frame: call("BLAND_AI_MAKE_CALL"), grant, knownSlugs: ["bland_ai"] })
        .kind,
    ).toBe("tools");
  });
});

describe("paused Connectors", () => {
  it("refuses an app or server the Bot has turned off but keeps the rest", () => {
    const paused: ConnectorGrant = {
      apps: {
        gmail: { tools: "all", access: "write", enabled: false },
        github: { tools: "all", access: "read" },
      },
      mcpServers: { linear: { tools: "all", enabled: false } },
    };
    const gmail = judgeComposioFrame({
      frame: call("GMAIL_FETCH_EMAILS"),
      grant: paused,
      knownSlugs: [],
    });
    expect(gmail).toMatchObject({ kind: "deny" });
    expect((gmail as { message: string }).message).toContain("turned off");
    expect(
      judgeComposioFrame({ frame: call("GITHUB_LIST_ISSUES"), grant: paused, knownSlugs: [] }).kind,
    ).toBe("tools");
    expect(
      judgeMcpServerFrame({ frame: call("list_issues"), server: "linear", grant: paused }).kind,
    ).toBe("deny");
  });
});

describe("judgeMcpServerFrame", () => {
  it("allows only the picked tools of a granted server", () => {
    expect(judgeMcpServerFrame({ frame: call("list_issues"), server: "linear", grant }).kind).toBe(
      "tools",
    );
    expect(judgeMcpServerFrame({ frame: call("delete_issue"), server: "linear", grant }).kind).toBe(
      "deny",
    );
    expect(judgeMcpServerFrame({ frame: call("x"), server: "files", grant }).kind).toBe("deny");
  });
});

describe("filterToolsListResult", () => {
  it("keeps the allowed tools only", () => {
    const result = { tools: [{ name: "a" }, { name: "b" }], nextCursor: "c" };
    expect(filterToolsListResult(result, (name) => name === "b")).toEqual({
      tools: [{ name: "b" }],
      nextCursor: "c",
    });
  });
});
