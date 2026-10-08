import { describe, expect, it } from "vitest";
import {
  heartbeatIdFromOutput,
  heartbeatIdFromToolCall,
  isCreateHeartbeatToolCall,
} from "./heartbeat-tool-call";

describe("create_heartbeat tool calls", () => {
  it("recognizes the daemon tool under its MCP names only", () => {
    expect(isCreateHeartbeatToolCall("mcp__clisbot__create_heartbeat")).toBe(true);
    expect(isCreateHeartbeatToolCall("mcp__clisbot__create_schedule")).toBe(false);
    expect(isCreateHeartbeatToolCall("create_heartbeat")).toBe(false);
  });

  it("finds the schedule id in each result shape providers return", () => {
    expect(heartbeatIdFromOutput({ id: "s1", cadence: {} })).toBe("s1");
    expect(heartbeatIdFromOutput({ structuredContent: { id: "s2" } })).toBe("s2");
    expect(heartbeatIdFromOutput({ output: { id: "s5", target: { agentId: "a" } } })).toBe("s5");
    expect(heartbeatIdFromOutput({ content: [{ type: "text", text: '{"id":"s3"}' }] })).toBe("s3");
    expect(heartbeatIdFromOutput('{"id": "s4", "name": null}')).toBe("s4");
    expect(heartbeatIdFromOutput("created")).toBeNull();
    expect(heartbeatIdFromOutput(null)).toBeNull();
  });

  it("reads the heartbeat a shell `heartbeat create` made, as JSON or as the table", () => {
    const shell = (command: string, output: string) =>
      ({ type: "shell", command, output }) as const;
    const json =
      '09:46:14\n{\n  "id": "e1590bea",\n  "name": "hoi-tham-1-phut",\n  "status": "active"\n}';
    const command = 'date "+%H:%M:%S"; clisbot heartbeat create "Say hi" --cron "* * * * *" --json';
    expect(heartbeatIdFromToolCall("Bash", shell(command, json))).toBe("e1590bea");
    const table = "ID         NAME\nd3a308d8   Drink water\n";
    const devCli = 'clisbot-dev heartbeat create "Drink" --cron "*/2 * * * *"';
    expect(heartbeatIdFromToolCall("shell", shell(devCli, table))).toBe("d3a308d8");
    expect(heartbeatIdFromToolCall("Bash", shell("clisbot heartbeat ls", json))).toBeNull();
    // Searching for the words is not running the command.
    expect(heartbeatIdFromToolCall("Bash", shell('rg "heartbeat create" docs', json))).toBeNull();
  });
});
