import { describe, expect, it } from "vitest";
import type { ConnectorTool } from "@clisbot/protocol/connectors/types";
import { TOOL_GROUPS } from "./agent-tools-model";
import {
  allowAppTool,
  allowGroupTool,
  allowServerTool,
  connectorToolRefusal,
} from "./project-allow-tool";

const tool = (name: string, kind: string): ConnectorTool => ({ name, kind });
const calendar = [
  tool("EVENTS_LIST", "read"),
  tool("EVENTS_GET", "read"),
  tool("EVENTS_CREATE", "write"),
  tool("ACL_DELETE", "write"),
];
const aclDelete = calendar[3]!;

describe("turning on a tool the Project leaves off", () => {
  it("says why the Project leaves a tool off", () => {
    expect(connectorToolRefusal(aclDelete, { tools: "all", access: "read" })).toBe("reads-only");
    expect(connectorToolRefusal(calendar[1]!, { tools: ["EVENTS_LIST"], access: "read" })).toBe(
      "not-picked",
    );
    expect(connectorToolRefusal(aclDelete, { tools: "all", access: "write" })).toBeNull();
  });

  it("adds one change to a read-only app and keeps its other changes off", () => {
    const grant = { apps: { googlecalendar: { tools: "all" as const, access: "read" } } };
    const next = allowAppTool(grant, "googlecalendar", aclDelete, calendar);
    expect(next.apps?.googlecalendar).toEqual({
      access: "write",
      tools: ["ACL_DELETE", "EVENTS_GET", "EVENTS_LIST"],
    });
    expect(connectorToolRefusal(calendar[2]!, next.apps?.googlecalendar)).toBe("not-picked");
  });

  it("adds a read to a picked list, and becomes all tools when the list covers them", () => {
    const grant = {
      apps: { googlecalendar: { tools: ["EVENTS_LIST"], access: "read" } },
      sends: "allow" as const,
    };
    const next = allowAppTool(grant, "googlecalendar", calendar[1]!, calendar);
    expect(next.apps?.googlecalendar).toEqual({
      tools: ["EVENTS_GET", "EVENTS_LIST"],
      access: "read",
    });
    expect(next.sends).toBe("allow");
    const server = allowServerTool(
      { mcpServers: { notes: { tools: ["read_note"] } } },
      "notes",
      "send_note",
      ["read_note", "send_note"],
    );
    expect(server.mcpServers?.notes).toEqual({ tools: "all" });
  });

  it("adds one Clisbot tool to its group", () => {
    const terminals = TOOL_GROUPS.find((group) => group.id === "terminals")!;
    const grant = { agentTools: { disabledTools: ["kill_terminal", "send_terminal_keys"] } };
    const next = allowGroupTool(grant, terminals, "kill_terminal", {
      agentTools: true,
      browserTools: false,
    });
    expect(next.agentTools?.disabledTools).toEqual(["send_terminal_keys"]);
  });
});
