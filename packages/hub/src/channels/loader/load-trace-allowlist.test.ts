import { describe, expect, it } from "vitest";
import { isAdmitted } from "./load-channel.js";

// A packaged Hub: every Clisbot package sits in the node_modules that also holds
// the verticals' hoisted third-party deps.
const modules = "file:///app.asar/node_modules";
const allowlist = {
  packageRoots: [
    `${modules}/@clisbot/channels-zalo`,
    `${modules}/@clisbot/channels-shared`,
    "file:///app.asar/node_modules/@clisbot/hub/dist/channels/loader",
  ],
  dependencyRoots: [modules],
};

describe("load-trace allowlist", () => {
  it("admits the vertical, its contract packages and hoisted third-party deps", () => {
    expect(isAdmitted(`${modules}/@clisbot/channels-zalo/dist/plugin.js`, allowlist)).toBe(true);
    expect(isAdmitted(`${modules}/@clisbot/channels-shared/dist/index.js`, allowlist)).toBe(true);
    expect(isAdmitted(`${modules}/grammy/out/mod.js`, allowlist)).toBe(true);
    expect(isAdmitted("node:fs/promises", allowlist)).toBe(true);
  });

  it("refuses other Clisbot packages reached through the shared node_modules", () => {
    expect(isAdmitted(`${modules}/@clisbot/server/dist/index.js`, allowlist)).toBe(false);
    expect(isAdmitted(`${modules}/@clisbot/channels-slack/dist/plugin.js`, allowlist)).toBe(false);
    expect(isAdmitted(`${modules}/@clisbot/hub/dist/index.js`, allowlist)).toBe(false);
  });
});
