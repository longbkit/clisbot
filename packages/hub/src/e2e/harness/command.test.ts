import assert from "node:assert/strict";
import { inspect } from "node:util";
import { describe, it } from "vitest";
import { runCommand } from "./command.js";

describe("E2E command diagnostics", () => {
  it("does not retain a failed command's enrollment token", async () => {
    const token = "exact-enrollment-token-must-not-survive";

    const diagnostic = await failedCommandDiagnostic(token);

    assert.equal(diagnostic.includes(token), false);
    assert.match(diagnostic, /--token <redacted>/u);
    assert.match(diagnostic, /raw diagnostics discarded/u);
  });
});

async function failedCommandDiagnostic(token: string): Promise<string> {
  try {
    await runCommand(
      process.execPath,
      ["-e", "process.exit(3)", "--", "--token", token],
      process.cwd(),
      {},
    );
  } catch (error) {
    return inspect(error, { depth: 10 });
  }
  throw new Error("Command unexpectedly succeeded");
}
