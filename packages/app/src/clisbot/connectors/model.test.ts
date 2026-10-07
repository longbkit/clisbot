import { describe, expect, it } from "vitest";
import type { ConnectorAppState } from "@clisbot/protocol/connectors/types";
import {
  buildMcpServerSave,
  joinCommandLine,
  parseSecretLines,
  splitCommandLine,
} from "./mcp-server-form";
import {
  appState,
  connectorUses,
  connectedOutsideCatalog,
  grantApp,
  grantMcpServer,
  accountSelectionLabel,
  revokeApp,
  setAppAccess,
  setAppAccounts,
  setAppEnabled,
  setMcpServerEnabled,
  setMcpServerTools,
  toolTitle,
  toggleTool,
  toolSelectionLabel,
} from "./model";
import { buildLists, buildSections } from "./screen-model";

const gmail: ConnectorAppState = {
  slug: "gmail",
  accounts: [
    { id: "ca_1", status: "INITIATED" },
    { id: "ca_2", alias: "work", status: "ACTIVE" },
  ],
};

describe("appState", () => {
  it("prefers a working account, then a pending sign-in, then a broken one", () => {
    expect(appState(gmail.accounts)).toBe("connected");
    expect(
      appState([
        { id: "a", status: "INITIATED" },
        { id: "b", status: "EXPIRED" },
      ]),
    ).toBe("pending");
    expect(appState([{ id: "a", status: "FAILED" }])).toBe("attention");
    expect(appState(undefined)).toBe("none");
  });
});

describe("Project grants", () => {
  it("adds an app read-only with every tool, widens it, and removes it", () => {
    const added = grantApp(undefined, "gmail");
    expect(added).toEqual({ apps: { gmail: { tools: "all", access: "read" } } });
    expect(setAppAccess(added, "gmail", "write").apps?.gmail?.access).toBe("write");
    expect(revokeApp(added, "gmail").apps).toEqual({});
  });

  it("toggles one tool out of all and back to all", () => {
    const all = ["A", "B", "C"];
    const without = toggleTool("all", "B", all);
    expect(without).toEqual(["A", "C"]);
    expect(toggleTool(without, "B", all)).toBe("all");
    expect(toolSelectionLabel(without, 3)).toBe("2 of 3 tools");
  });

  it("lists the Bots and Projects that use an app and how", () => {
    const grants = [
      {
        projectId: "p_bot",
        grant: { apps: { gmail: { tools: "all" as const, access: "write" as const } } },
      },
      {
        projectId: "p_app",
        grant: { apps: { gmail: { tools: ["A"], access: "read" as const, enabled: false } } },
      },
      { projectId: "p_none", grant: { mcpServers: { notes: { tools: "all" as const } } } },
    ];
    const owners = new Map([
      ["p_bot", { name: "Chief", botId: "b1" }],
      ["p_app", { name: "App" }],
    ]);
    expect(connectorUses(grants, owners, { app: "gmail" })).toEqual([
      { projectId: "p_app", name: "App", enabled: false, access: "read", tools: ["A"] },
      {
        projectId: "p_bot",
        name: "Chief",
        botId: "b1",
        enabled: true,
        access: "write",
        tools: "all",
      },
    ]);
  });
});

describe("pausing and tool names", () => {
  it("pauses an app without losing its settings and resumes it", () => {
    const granted = setAppAccess(grantApp(undefined, "gmail"), "gmail", "write");
    const paused = setAppEnabled(granted, "gmail", false);
    expect(paused.apps?.gmail).toEqual({ tools: "all", access: "write", enabled: false });
    expect(setAppEnabled(paused, "gmail", true).apps?.gmail).toEqual({
      tools: "all",
      access: "write",
    });
    const server = setMcpServerEnabled(grantMcpServer(undefined, "linear"), "linear", false);
    expect(setMcpServerTools(server, "linear", ["a"]).mcpServers?.linear).toEqual({
      tools: ["a"],
      enabled: false,
    });
  });

  it("changes only entries the grant has, and adding keeps an entry already set up", () => {
    // Applied to the Host's grant at save time: another device may have removed or set it up.
    expect(setAppEnabled(undefined, "gmail", false).apps?.gmail).toBeUndefined();
    expect(setMcpServerTools({}, "linear", ["a"]).mcpServers?.linear).toBeUndefined();
    const set = setAppAccess(grantApp(undefined, "gmail"), "gmail", "write");
    expect(grantApp(set, "gmail").apps?.gmail?.access).toBe("write");
  });

  it("reads a tool's title, else its name without the app prefix", () => {
    expect(toolTitle({ name: "GMAIL_SEND_EMAIL", title: "Send Email" }, "gmail")).toBe(
      "Send Email",
    );
    expect(toolTitle({ name: "GMAIL_SEND_EMAIL" }, "gmail")).toBe("Send email");
    expect(toolTitle({ name: "list_issues" })).toBe("List issues");
    expect(toolTitle({ name: "createPullRequest" })).toBe("Create pull request");
  });
});

describe("account selection", () => {
  it("limits an app to some accounts, labels it, and returns to every account", () => {
    const accounts = [
      { id: "ca_1", alias: "work", status: "ACTIVE" },
      { id: "ca_2", alias: "personal", status: "ACTIVE" },
    ];
    const limited = setAppAccounts(grantApp(undefined, "gmail"), "gmail", ["ca_1"]);
    expect(limited.apps?.gmail?.accounts).toEqual(["ca_1"]);
    expect(accountSelectionLabel(["ca_1"], accounts)).toBe("work");
    expect(accountSelectionLabel(["ca_1", "ca_2"], accounts)).toBe("2 accounts");
    expect(accountSelectionLabel(undefined, accounts)).toBe("All accounts");
    expect(setAppAccounts(limited, "gmail", "all").apps?.gmail).toEqual({
      tools: "all",
      access: "read",
    });
  });
});

describe("the Connectors list", () => {
  const items = [
    { slug: "notion", name: "Notion" },
    { slug: "gmail", name: "Gmail" },
  ];

  it("puts connected apps first and keeps an app connected outside the catalog page", () => {
    const accounts = [gmail, { slug: "bland_ai", accounts: [{ id: "x", status: "ACTIVE" }] }];
    expect(connectedOutsideCatalog(items, accounts)).toEqual([
      { slug: "bland_ai", name: "Bland Ai" },
    ]);
    const map = new Map(accounts.map((app) => [app.slug, app] as const));
    const lists = buildLists(items, accounts, map, "");
    expect(lists.connected.map((item) => item.slug)).toEqual(["gmail", "bland_ai"]);
    const sections = buildSections({
      filter: "all",
      search: "",
      lists,
      servers: [],
      accountMap: map,
      shown: 100,
    });
    const keys = (rows: { key: string }[]) => rows.map((row) => row.key);
    expect(sections.map((section) => [section.title, keys(section.rows)])).toEqual([
      ["Connected", ["app:gmail", "app:bland_ai"]],
      ["All apps", ["app:notion"]],
    ]);
  });

  it("shows MCP servers alone under their filter", () => {
    const lists = buildLists(items, [], new Map(), "");
    const sections = buildSections({
      filter: "mcp",
      search: "",
      lists,
      servers: [{ name: "linear", transport: "http", url: "https://x" }],
      accountMap: new Map(),
      shown: 100,
    });
    expect(sections).toEqual([
      {
        title: "MCP servers",
        rows: [{ key: "mcp:linear", slug: "linear", name: "linear", state: "server" }],
      },
    ]);
  });
});

describe("the MCP server form", () => {
  it("reads header and variable lines, and keeps stored values when the field is empty", () => {
    expect(parseSecretLines("Authorization: Bearer a:b\n\nX-Team: 1", ":")).toEqual({
      Authorization: "Bearer a:b",
      "X-Team": "1",
    });
    expect(parseSecretLines("  ", "=")).toBeUndefined();
    expect(() => parseSecretLines("TOKEN", "=")).toThrow("NAME=value");
  });

  it("writes the stored command back so saving it unchanged keeps every argument", () => {
    const words = ["npx", "-y", "@scope/server", "--root", "/Users/me/My Notes", `it's "x"`, ""];
    expect(splitCommandLine(joinCommandLine(words))).toEqual(words);
    expect(joinCommandLine(["npx", "-y", "server"])).toBe("npx -y server");
  });

  it("splits a command line with quotes", () => {
    expect(splitCommandLine(`npx -y "@scope/server name" '~/my notes'`)).toEqual([
      "npx",
      "-y",
      "@scope/server name",
      "~/my notes",
    ]);
  });

  it("builds the save request for each transport", () => {
    expect(
      buildMcpServerSave({
        name: " linear ",
        transport: "http",
        url: "https://mcp.linear.app/mcp ",
        command: "",
        secrets: "",
      }),
    ).toEqual({ server: { name: "linear", transport: "http", url: "https://mcp.linear.app/mcp" } });
    expect(
      buildMcpServerSave({
        previousName: "fs",
        name: "files",
        transport: "stdio",
        url: "",
        command: "npx -y fs ~/notes",
        secrets: "ROOT=/tmp",
      }),
    ).toEqual({
      previousName: "fs",
      server: { name: "files", transport: "stdio", command: "npx", args: ["-y", "fs", "~/notes"] },
      env: { ROOT: "/tmp" },
    });
  });
});
