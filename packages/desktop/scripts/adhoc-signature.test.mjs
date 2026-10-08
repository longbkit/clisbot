import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { reSignAdhocWithoutHardenedRuntime } = require("./adhoc-signature.js");

function codesignReporting(signatureLines) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return args[0] === "-dv" ? `Identifier=sh.clisbot.desktop\n${signatureLines}\n` : "";
  };
  return { calls, run };
}

describe("reSignAdhocWithoutHardenedRuntime", () => {
  it("signs an ad-hoc bundle again as one unit without the hardened runtime", () => {
    const codesign = codesignReporting("Signature=adhoc");

    expect(reSignAdhocWithoutHardenedRuntime("/out/Clisbot.app", codesign.run)).toBe(true);
    expect(codesign.calls).toEqual([
      ["-dv", "--verbose=2", "/out/Clisbot.app"],
      ["--force", "--deep", "--sign", "-", "/out/Clisbot.app"],
    ]);
  });

  it("leaves a Developer ID signature untouched", () => {
    const codesign = codesignReporting(
      "Signature size=9000\nAuthority=Developer ID Application: Example (TEAMID1234)",
    );

    expect(reSignAdhocWithoutHardenedRuntime("/out/Clisbot.app", codesign.run)).toBe(false);
    expect(codesign.calls).toHaveLength(1);
  });

  it("leaves an unsigned bundle untouched", () => {
    const run = () => {
      throw new Error("code object is not signed at all");
    };

    expect(reSignAdhocWithoutHardenedRuntime("/out/Clisbot.app", run)).toBe(false);
  });
});
