import { describe, expect, it } from "vitest";
import {
  TOOL_GROUPS,
  disabledToolsOf,
  enabledToolsOf,
  groupSummary,
  projectGroupTools,
  saveGroupTools,
  setClisbotToolsChoice,
  setGroupOn,
  setGroupTools,
  groupToolSet,
  toolsChoiceOf,
  toolsOn,
} from "./agent-tools-model";
import { sessionKeptTools, setSessionKeptTools } from "./session-connectors";

const group = (id: string) => TOOL_GROUPS.find((entry) => entry.id === id)!;
const terminals = group("terminals");
const schedules = group("schedules");
const browser = group("browser");
const hostOff = { agentTools: true, browserTools: false };
const hostOn = { agentTools: true, browserTools: true };

describe("agent tools model", () => {
  it("lists the browser first among the Clisbot tools", () => {
    expect(TOOL_GROUPS[0]?.id).toBe("browser");
  });

  it("follows the Host until the Project chooses, and back", () => {
    const on = setClisbotToolsChoice(undefined, "on");
    expect(on.agentTools).toEqual({ enabled: true });
    expect(toolsOn(on.agentTools?.enabled, false)).toBe(true);
    expect(toolsChoiceOf(setClisbotToolsChoice(on, "host").agentTools?.enabled)).toBe("host");
    expect(toolsOn(undefined, true)).toBe(true);
  });

  it("turns one group off without touching another group's choices", () => {
    const some = setGroupTools(undefined, schedules, ["list_schedules"]);
    const both = setGroupOn(some, terminals, false, hostOff);
    expect(enabledToolsOf(terminals, disabledToolsOf(both))).toEqual([]);
    expect(groupSummary(both, schedules, hostOff)).toBe(`1 of ${schedules.tools.length} tools`);
    expect(groupSummary(both, terminals, hostOff)).toBe("Off");
    const back = setGroupOn(both, terminals, true, hostOff);
    expect(groupSummary(back, terminals, hostOff)).toBe(`All ${terminals.tools.length} tools`);
  });

  it("switches the browser against the Host's default and follows it again when they agree", () => {
    expect(projectGroupTools(undefined, browser, hostOff)).toEqual([]);
    const on = setGroupOn(undefined, browser, true, hostOff);
    expect(on.browserTools).toBe(true);
    expect(projectGroupTools(on, browser, hostOff)).toHaveLength(browser.tools.length);
    expect(setGroupOn(on, browser, false, hostOff)).toEqual({});
    expect(setGroupOn(undefined, browser, false, hostOn)).toEqual({ browserTools: false });
    expect(groupSummary(undefined, browser, hostOn)).toBe(
      `All ${browser.tools.length} tools · Host default`,
    );
  });

  it("keeps the browser's tool list when it is turned off, and turns it on when tools are picked", () => {
    const picked = saveGroupTools(undefined, browser, ["browser_navigate"], hostOff);
    expect(picked.browserTools).toBe(true);
    expect(projectGroupTools(picked, browser, hostOff)).toEqual(["browser_navigate"]);
    const off = saveGroupTools(picked, browser, [], hostOff);
    expect(off.browserTools).toBeUndefined();
    expect(enabledToolsOf(browser, disabledToolsOf(off))).toEqual(["browser_navigate"]);
  });

  it("keeps the Project's other choices when its tools change", () => {
    const grant = { sends: "allow" as const, agentTools: { enabled: true } };
    expect(setGroupOn(grant, terminals, false, hostOff)).toMatchObject({
      sends: "allow",
      agentTools: { enabled: true },
    });
  });
});

describe("session tool switches", () => {
  const set = groupToolSet(terminals, ["create_terminal", "list_terminals", "capture_terminal"]);

  it("turns single tools off, the whole group off, and back on", () => {
    const some = setSessionKeptTools(new Set(["gmail"]), set, ["list_terminals"]);
    expect(sessionKeptTools(set, some)).toEqual(["list_terminals"]);
    expect(some.has("gmail")).toBe(true);
    const none = setSessionKeptTools(some, set, []);
    expect([...none].sort()).toEqual(["gmail", "tools:terminals"]);
    expect(sessionKeptTools(set, none)).toEqual([]);
    const all = setSessionKeptTools(none, set, set.given);
    expect([...all]).toEqual(["gmail"]);
  });
});
