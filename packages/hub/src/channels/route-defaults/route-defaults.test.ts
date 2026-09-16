import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { HubBundleFile } from "../../config/bundle-contract.js";
import { applyAgentControls, sameAgentControls } from "../config/agent-controls.js";
import { compileChannelControlPlane } from "../config/compile.js";
import { previousRouteAgentControls, routeIdentity, writeRouteAgentControls } from "./files.js";
import { revisionSignature } from "./signature.js";

const POLICY = `
enabled: true
defaults:
  approval:
    - { match: "*", mode: require }
`;

function account(route: string): string {
  return `
channel: slack
accountId: support
enabled: true
connectionId: slack-support
transport: { mode: socket, errorPolicy: once }
routes:
  - match: { kind: channel, ids: [C1], contains: deploy }
    agent: assistant
    environment: lab
${route}
fallback: { deny: true }
`;
}

function files(route = ""): HubBundleFile[] {
  return [
    { path: ".paseo/hub.yml", content: "agents: {}\n" },
    { path: ".paseo/channels/policy.yml", content: POLICY },
    { path: ".paseo/channels/slack/support.yml", content: account(route) },
  ];
}

function compile(revision: readonly HubBundleFile[]) {
  return compileChannelControlPlane({
    files: revision.filter(({ path }) => path.startsWith(".paseo/channels/")),
    agentNames: ["assistant"],
    environmentNames: ["lab"],
    workflowNames: [],
  });
}

const OPUS = { provider: "claude", model: "claude-opus-5", thinkingOptionId: "high" };

describe("route default agent controls", () => {
  it("compiles the leaf into the Route defaults and leaves it absent when unauthored", () => {
    const plain = compile(files()).accounts[0]!.routes[0]!;
    assert.equal("agentControls" in plain.defaults, false);
    const promoted = compile(writeRouteAgentControls(files(), "slack", "support", 0, OPUS));
    assert.deepEqual(promoted.accounts[0]!.routes[0]!.defaults.agentControls, OPUS);
  });

  it("keeps the Route's identity and revision signature when only the default changes", () => {
    const before = files();
    const after = writeRouteAgentControls(before, "slack", "support", 0, OPUS);
    const [plain, promoted] = [compile(before), compile(after)];
    assert.equal(
      routeIdentity(plain.accounts[0]!.routes[0]!),
      routeIdentity(promoted.accounts[0]!.routes[0]!),
    );
    assert.equal(
      revisionSignature({ files: before, controlPlane: plain }),
      revisionSignature({ files: after, controlPlane: promoted }),
    );
    const edited = files("    interaction: { requireMention: false }");
    assert.notEqual(
      revisionSignature({ files: before, controlPlane: plain }),
      revisionSignature({ files: edited, controlPlane: compile(edited) }),
    );
  });

  it("removes the leaf when the restored value is absent", () => {
    const promoted = writeRouteAgentControls(files(), "slack", "support", 0, OPUS);
    const restored = writeRouteAgentControls(promoted, "slack", "support", 0, undefined);
    assert.equal("agentControls" in compile(restored).accounts[0]!.routes[0]!.defaults, false);
  });

  it("finds the value before the Route default's last change", () => {
    const original = files();
    const sonnet = { provider: "claude", model: "claude-sonnet-5" };
    const first = writeRouteAgentControls(original, "slack", "support", 0, sonnet);
    const second = writeRouteAgentControls(first, "slack", "support", 0, OPUS);
    assert.deepEqual(previousRouteAgentControls([second, first, original], "slack", "support", 0), {
      found: true,
      controls: sonnet,
    });
    assert.deepEqual(previousRouteAgentControls([first, original], "slack", "support", 0), {
      found: true,
      controls: undefined,
    });
    assert.deepEqual(previousRouteAgentControls([original], "slack", "support", 0), {
      found: false,
    });
  });

  it("does not undo past an edit of the Route itself", () => {
    const edited = files("    interaction: { requireMention: false }");
    const promoted = writeRouteAgentControls(edited, "slack", "support", 0, OPUS);
    assert.deepEqual(previousRouteAgentControls([promoted, files()], "slack", "support", 0), {
      found: false,
    });
  });
});

describe("applyAgentControls", () => {
  const named = {
    provider: "codex",
    model: "gpt-5.6-luna",
    mode: "auto",
    thinkingOptionId: "medium",
    options: { approval_policy: "on-request" },
  };

  it("replaces every provider-specific value when the provider changes", () => {
    assert.deepEqual(applyAgentControls(named, OPUS), OPUS);
  });

  it("reads controls naming the same provider as a whole configuration", () => {
    // A conversation on codex that left effort unset must not inherit "medium".
    assert.deepEqual(applyAgentControls(named, { provider: "codex", model: "gpt-5.6-terra" }), {
      provider: "codex",
      model: "gpt-5.6-terra",
      options: named.options,
    });
  });

  it("overrides field by field when no provider is named", () => {
    assert.deepEqual(applyAgentControls(named, { model: "gpt-5.6" }), {
      ...named,
      model: "gpt-5.6",
    });
  });

  it("compares controls regardless of key order", () => {
    assert.equal(
      sameAgentControls(
        { model: "m", provider: "p" },
        { provider: "p", model: "m", mode: undefined },
      ),
      true,
    );
  });
});
