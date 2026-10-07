import { describe, expect, test } from "vitest";
import { renderAutostartPlist } from "./plist.js";
import type { AutostartTarget } from "./targets.js";

const target: AutostartTarget = {
  name: "hub",
  label: "ai.clisbot.fusion.hub",
  argv: ["/usr/bin/node", "/opt/paseo/bin/paseo", "hub", "start", "--foreground"],
  environment: { HOME: "/Users/tester", PASEO_HOME: "/srv/fusion&dev", PATH: "/usr/bin" },
  workingDirectory: "/srv/fusion&dev",
  standardOutPath: "/srv/fusion&dev/state/launchd/hub.out.log",
  standardErrorPath: "/srv/fusion&dev/state/launchd/hub.err.log",
};

describe("renderAutostartPlist", () => {
  test("renders the job launchd needs", () => {
    const plist = renderAutostartPlist(target);

    expect(plist.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(plist).toContain("<key>Label</key>\n<string>ai.clisbot.fusion.hub</string>");
    expect(plist).toContain("<key>RunAtLoad</key>\n<true/>");
    expect(plist).toContain(
      "<key>KeepAlive</key>\n<dict>\n<key>SuccessfulExit</key>\n<false/>\n</dict>",
    );
    expect(plist).toContain("<string>--foreground</string>");
    expect(plist).toContain("<key>PASEO_HOME</key>");
    expect(plist.endsWith("</plist>\n")).toBe(true);
  });

  test("escapes XML in every string value", () => {
    const plist = renderAutostartPlist(target);

    expect(plist).toContain("<string>/srv/fusion&amp;dev</string>");
    expect(plist).not.toContain("fusion&dev");
    expect(plist).not.toContain("<string>/srv/fusion&dev");
  });
});
