import { describe, expect, it } from "vitest";
import {
  CONNECTORS_OFF_LABEL,
  readConnectorsOff,
  type ConnectorGrant,
} from "@clisbot/protocol/connectors/types";
import { agentToolAccess } from "./connector-agent-tools.js";
import type { ConnectorProjectDirectory } from "./connector-runtime.js";

const PROJECT = "prj_tools";

function directory(labels: Record<string, string> = {}): ConnectorProjectDirectory {
  return {
    projectForCwd: async (cwd) => (cwd === "/p" ? { projectId: PROJECT, rootPath: "/p" } : null),
    project: async () => null,
    agentLabels: () => labels,
    offList: async () => readConnectorsOff(labels),
    allowOwners: (agentId) => [agentId],
    agentCwd: () => "/p",
    agentState: () => "active",
  };
}

function access(
  grant: ConnectorGrant | undefined,
  labels?: Record<string, string>,
  sessionAllows: string[] = [],
) {
  return agentToolAccess({
    agentId: "agent-1",
    base: { policy: { disabledTools: ["kill_agent"] }, browserTools: false },
    projects: directory(labels),
    grants: async () => (grant ? { [PROJECT]: grant } : {}),
    sessionAllows: new Set(sessionAllows),
  });
}

describe("agentToolAccess", () => {
  it("keeps what the launch and the Host give when the Project makes no choice", async () => {
    expect(await access(undefined)).toEqual({
      policy: { disabledTools: ["kill_agent"] },
      browserTools: false,
    });
  });

  it("adds the Project's disabled tools and the groups and tools the session turned off", async () => {
    const result = await access(
      { agentTools: { disabledTools: ["create_terminal"] }, browserTools: true },
      { [CONNECTORS_OFF_LABEL]: "gmail,tools:schedules,tool:list_agents" },
    );
    expect(result.browserTools).toBe(true);
    expect(result.policy?.disabledTools).toEqual(
      expect.arrayContaining([
        "kill_agent",
        "create_terminal",
        "create_schedule",
        "run_schedule_once",
        "list_agents",
      ]),
    );
    expect(result.policy?.disabledTools).not.toContain("create_agent");
  });

  it("gives back what the daemon allows this one session, and never the Host's own blocks", async () => {
    const result = await access(
      { agentTools: { disabledTools: ["create_terminal", "kill_terminal"] } },
      undefined,
      ["tool:create_terminal", "tool:kill_agent", "tool:browser_navigate"],
    );
    expect(result.policy?.disabledTools).toContain("kill_terminal");
    expect(result.policy?.disabledTools).not.toContain("create_terminal");
    expect(result.policy?.disabledTools).toContain("kill_agent");
    // The browser is off for the Project: the session gets it with only the allowed tool.
    expect(result.browserTools).toBe(true);
    expect(result.policy?.disabledTools).toContain("browser_click");
    expect(result.policy?.disabledTools).not.toContain("browser_navigate");
  });

  it("follows the Bot's settings in a Chat, except what the Chat itself turned off", async () => {
    let grant: ConnectorGrant = {
      agentTools: { disabledTools: ["create_terminal", "list_agents"] },
    };
    const read = () =>
      agentToolAccess({
        agentId: "agent-1",
        base: { policy: undefined, browserTools: false },
        projects: { ...directory(), offList: async () => new Set(["tool:list_agents"]) },
        grants: async () => ({ [PROJECT]: grant }),
        sessionAllows: new Set(),
      });
    expect((await read()).policy?.disabledTools).toEqual(
      expect.arrayContaining(["create_terminal", "list_agents"]),
    );
    // The Bot's settings turn both back on: the Chat keeps off only what it turned off.
    grant = {};
    const after = await read();
    expect(after.policy?.disabledTools).toEqual(["list_agents"]);
  });

  it("withholds every tool from the next call once the Project turns them off", async () => {
    expect(await access({ agentTools: { enabled: false } })).toEqual({
      policy: { enabled: false },
      browserTools: false,
    });
  });
});
