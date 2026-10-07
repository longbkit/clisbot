import { describe, expect, it } from "vitest";
import { CONNECTORS_OFF_LABEL } from "@clisbot/protocol/connectors/types";
import {
  renameServerInChatLists,
  renameServerInOffLists,
  renameServerKeys,
} from "./connector-off-lists.js";

function fakeAgents(labels: Record<string, Record<string, string>>) {
  const written: Record<string, Record<string, string>> = {};
  return {
    written,
    listAgents: () =>
      Object.entries(labels).map(([id, agentLabels]) => ({ id, labels: agentLabels })),
    setLabels: async (agentId: string, next: Record<string, string>) => {
      written[agentId] = next;
    },
  };
}

describe("renameServerInOffLists", () => {
  it("follows a renamed server and forgets a removed one, leaving other sessions alone", async () => {
    const agents = fakeAgents({
      a: { [CONNECTORS_OFF_LABEL]: "gmail,mcp:notes" },
      b: { [CONNECTORS_OFF_LABEL]: "mcp:other" },
      c: {},
    });
    await renameServerInOffLists(agents, { from: "notes", to: "notes2" });
    expect(agents.written).toEqual({ a: { [CONNECTORS_OFF_LABEL]: "gmail,mcp:notes2" } });

    const removed = fakeAgents({ a: { [CONNECTORS_OFF_LABEL]: "gmail,mcp:notes" } });
    await renameServerInOffLists(removed, { from: "notes", to: null });
    expect(removed.written).toEqual({ a: { [CONNECTORS_OFF_LABEL]: "gmail" } });

    const unchanged = fakeAgents({ a: { [CONNECTORS_OFF_LABEL]: "mcp:notes" } });
    await renameServerInOffLists(unchanged, { from: "notes", to: "notes" });
    expect(unchanged.written).toEqual({});
  });
});

describe("renameServerKeys", () => {
  it("moves a server's own key and its tools' keys, and leaves a server with a longer name", () => {
    const keys = ["mcp:notes", "mcp:notes/send", "mcp:notes2/send", "gmail/GMAIL_SEND_EMAIL"];
    expect(renameServerKeys(keys, { from: "notes", to: "memo" })).toEqual([
      "mcp:memo",
      "mcp:memo/send",
      "mcp:notes2/send",
      "gmail/GMAIL_SEND_EMAIL",
    ]);
    expect(renameServerKeys(keys, { from: "notes", to: null })).toEqual([
      "mcp:notes2/send",
      "gmail/GMAIL_SEND_EMAIL",
    ]);
    expect(renameServerKeys(["gmail"], { from: "notes", to: "memo" })).toBeNull();
  });

  it("renames the server in the Chats' lists that name it", async () => {
    const written: Record<string, string[]> = {};
    await renameServerInChatLists(
      {
        list: async () => [
          { chatId: "a", off: ["mcp:notes/send"] },
          { chatId: "b", off: ["gmail"] },
        ],
        set: async (chatId, off) => {
          written[chatId] = off;
        },
      },
      { from: "notes", to: "memo" },
    );
    expect(written).toEqual({ a: ["mcp:memo/send"] });
  });
});
