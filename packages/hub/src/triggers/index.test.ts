import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { cleanTriggerAgent } from "./index.js";

describe("cleanTriggerAgent", () => {
  it("keeps configured model and thinking options while omitting absent optional fields", () => {
    assert.deepEqual(
      cleanTriggerAgent({
        provider: "codex",
        model: "gpt-5.6-sol",
        mode: "full-access",
        thinkingOptionId: "xhigh",
      }),
      {
        provider: "codex",
        model: "gpt-5.6-sol",
        mode: "full-access",
        thinkingOptionId: "xhigh",
      },
    );
    assert.deepEqual(cleanTriggerAgent({ provider: "codex", mode: "full-access" }), {
      provider: "codex",
      mode: "full-access",
    });
    assert.deepEqual(cleanTriggerAgent({ provider: "codex" }), { provider: "codex" });
  });

  it("copies opaque provider options without interpreting their keys", () => {
    const options = { permission: { edit: "ask", bash: "deny" } };
    const cleaned = cleanTriggerAgent({ provider: "opencode", options });
    assert.deepEqual(cleaned, { provider: "opencode", options });
    assert.notEqual(cleaned.options, options);
  });
});
