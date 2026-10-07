import { describe, expect, it } from "vitest";
import type { ConnectorGrant } from "@clisbot/protocol/connectors/types";
import { pinComposioAccounts } from "./connector-accounts.js";

const accounts = new Map([
  [
    "gmail",
    [
      { id: "ca_work", alias: "work" },
      { id: "ca_home", alias: "personal" },
    ],
  ],
]);

function execute(entries: Record<string, unknown>[]) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "COMPOSIO_MULTI_EXECUTE_TOOL", arguments: { tools: entries } },
  };
}

function grantWith(selection: "all" | string[] | undefined): ConnectorGrant {
  return {
    apps: {
      gmail: { tools: "all", access: "write", ...(selection ? { accounts: selection } : {}) },
    },
  };
}

describe("pinComposioAccounts", () => {
  it("leaves calls alone when the Bot may use every account", () => {
    const frame = execute([{ tool_slug: "GMAIL_FETCH_EMAILS" }]);
    expect(
      pinComposioAccounts({ frame, grant: grantWith(undefined), accountsBySlug: accounts }),
    ).toEqual({
      kind: "ok",
      frame,
    });
  });

  it("names the only allowed account for the agent", () => {
    const result = pinComposioAccounts({
      frame: execute([{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} }]),
      grant: grantWith(["ca_work"]),
      accountsBySlug: accounts,
    });
    expect(result).toMatchObject({
      kind: "ok",
      frame: {
        params: { arguments: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", account: "ca_work" }] } },
      },
    });
  });

  it("accepts an allowed alias and refuses an account the Bot may not use", () => {
    const grant = grantWith(["ca_work", "ca_home"]);
    expect(
      pinComposioAccounts({
        frame: execute([{ tool_slug: "GMAIL_SEND_EMAIL", account: "Personal" }]),
        grant,
        accountsBySlug: accounts,
      }),
    ).toMatchObject({
      kind: "ok",
      frame: { params: { arguments: { tools: [{ account: "ca_home" }] } } },
    });
    const refused = pinComposioAccounts({
      frame: execute([{ tool_slug: "GMAIL_SEND_EMAIL", account: "personal" }]),
      grant: grantWith(["ca_work"]),
      accountsBySlug: accounts,
    });
    expect(refused).toMatchObject({ kind: "deny" });
    expect((refused as { message: string }).message).toContain("may use: work");
  });

  it("asks for an account when several are allowed and none is named", () => {
    const result = pinComposioAccounts({
      frame: execute([{ tool_slug: "GMAIL_FETCH_EMAILS" }]),
      grant: grantWith(["ca_work", "ca_home"]),
      accountsBySlug: accounts,
    });
    expect(result).toMatchObject({ kind: "deny" });
    expect((result as { message: string }).message).toContain("one of: work, personal");
  });

  it("refuses a direct app-tool call for an app limited to some accounts", () => {
    const frame = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "GMAIL_FETCH_EMAILS", arguments: {} },
    };
    expect(
      pinComposioAccounts({ frame, grant: grantWith(["ca_work"]), accountsBySlug: accounts }).kind,
    ).toBe("deny");
  });
});
