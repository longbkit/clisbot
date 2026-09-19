import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { CompiledAgent } from "../config/compiler.js";
import type { ChannelConversationKey } from "../db/channel-access.js";
import type { ChannelStore } from "../db/channels.js";
import { parseChannelTextCommand } from "./commands.js";
import type { LifecycleCommandContext } from "./commands-lifecycle.js";
import {
  promoteRouteDefault,
  routeDefaultText,
  type RouteDefaultCommandDependencies,
} from "./commands-route-default.js";
import { applyAgentControls, type AgentControls } from "./config/agent-controls.js";
import { compileChannelControlPlane } from "./config/compile.js";
import type { CreateAgentConfig } from "./daemon/types.js";
import type { ChannelPlaneDeps } from "./plane/types.js";
import type { RouteDefaultOutcome, RouteDefaultPublisher } from "./route-defaults/publish.js";

const ACCOUNT = `
channel: slack
accountId: support
enabled: true
connectionId: slack-support
transport: { mode: socket, errorPolicy: once }
routes:
  - audience: [{ who: { roles: [member] }, where: { conversations: [C0] } }]
    contains: other
    agent: assistant
    environment: lab
  - audience: [{ who: { roles: [member] }, where: { conversations: [C1] } }]
    contains: deploy
    agent: assistant
    environment: lab
`;

const NAMED = { provider: "codex", model: "gpt-5.6-luna", thinkingOptionId: "medium" };
const OPUS: CreateAgentConfig = {
  provider: "claude",
  cwd: "/lab",
  model: "claude-opus-5",
  thinkingOptionId: "high",
};

function configFor(agent: CompiledAgent): CreateAgentConfig {
  return {
    provider: agent.provider,
    cwd: "/lab",
    ...(agent.model === undefined ? {} : { model: agent.model }),
    ...(agent.thinkingOptionId === undefined ? {} : { thinkingOptionId: agent.thinkingOptionId }),
  };
}

function harness(
  options: {
    conversation?: CreateAgentConfig;
    manager?: boolean;
    outcome?: RouteDefaultOutcome;
  } = {},
) {
  const plane = compileChannelControlPlane({
    files: [
      {
        path: ".paseo/channels/policy.yml",
        content: 'defaults:\n  approval:\n    - { match: "*", mode: require }\n',
      },
      { path: ".paseo/channels/slack/support.yml", content: ACCOUNT },
    ],
    agentNames: ["assistant"],
    environmentNames: ["lab"],
    workflowNames: [],
  });
  const account = plane.accounts[0]!;
  const context: LifecycleCommandContext = {
    message: {
      channel: "slack",
      accountId: "support",
      senderIdentity: "slack:UADMIN",
      text: "/promoteroutedefault",
      mentionedBot: true,
      conversation: { kind: "channel", id: "C1", rootConversationId: "C1", threadId: null },
    },
    account,
    route: account.routes[1]!,
    accessTarget: { daemonReference: "daemon" },
    post: async () => true,
  };
  const publisher: RouteDefaultPublisher = {
    promote: vi.fn(
      async (_target, controls: AgentControls) =>
        options.outcome ?? { status: "published" as const, agentControls: controls },
    ),
    undo: vi.fn(
      async () => options.outcome ?? { status: "published" as const, agentControls: undefined },
    ),
    setFollowUp: vi.fn(),
    apply: vi.fn(),
  };
  const clearConversationSelection = vi.fn(async (_key: ChannelConversationKey) => undefined);
  const deps: RouteDefaultCommandDependencies = {
    plane: {
      organizationId: "org",
      routeDefaults: publisher,
      commandAccess: {
        authorizeChannelAccountManagement: async () =>
          options.manager === false ? undefined : { membershipId: "m", userId: "u" },
      },
    } as unknown as ChannelPlaneDeps,
    store: { access: { clearConversationSelection } } as unknown as ChannelStore,
    routeConfig: (current, override) =>
      configFor(
        applyAgentControls(
          NAMED,
          override === undefined ? current.route.defaults.agentControls : override.agentControls,
        ),
      ),
    conversationConfig: async () => options.conversation ?? { cwd: "/lab", ...NAMED },
    selectionKey: () => ({
      organizationId: "org",
      channel: "slack",
      accountId: "support",
      externalConversationId: "C1",
      externalThreadId: null,
    }),
  };
  return { deps, context, publisher, clearConversationSelection };
}

describe("/promoteroutedefault", () => {
  it("parses as a route-default command with an optional undo", () => {
    assert.deepEqual(parseChannelTextCommand("/promoteroutedefault"), {
      name: "promoteroutedefault",
    });
    assert.deepEqual(parseChannelTextCommand("/promoteroutedefault undo"), {
      name: "promoteroutedefault",
      value: "undo",
    });
    assert.deepEqual(parseChannelTextCommand("/routedefault"), { name: "routedefault" });
    assert.equal(parseChannelTextCommand("/routedefault please"), null);
  });

  it("sets the serving route's default and stops the conversation overriding it", async () => {
    const { deps, context, publisher, clearConversationSelection } = harness({
      conversation: OPUS,
    });
    const result = await promoteRouteDefault(deps, context, undefined);
    assert.equal(
      result.text,
      [
        'Default set for route #2 (mention, contains "deploy"):',
        "claude / claude-opus-5 / high",
        "New conversations on this route use it. Undo: /promoteroutedefault undo",
      ].join("\n"),
    );
    assert.equal(result.published, true);
    const [target, controls] = vi.mocked(publisher.promote).mock.calls[0]!;
    assert.equal(target.position, 1);
    assert.deepEqual(target.principal, { membershipId: "m", userId: "u" });
    assert.deepEqual(controls, {
      provider: "claude",
      model: "claude-opus-5",
      thinkingOptionId: "high",
    });
    assert.equal(clearConversationSelection.mock.calls.length, 1);
  });

  it("publishes a default that starts exactly what the conversation runs", async () => {
    // Same provider as the named agent, effort left unset: the Route must not
    // fall back to the named agent's "medium".
    const conversation: CreateAgentConfig = {
      provider: "codex",
      cwd: "/lab",
      model: "gpt-5.6-terra",
    };
    const { deps, context, publisher } = harness({ conversation });
    const result = await promoteRouteDefault(deps, context, undefined);
    assert.match(result.text, /codex \/ gpt-5\.6-terra \/ default/u);
    const [, controls] = vi.mocked(publisher.promote).mock.calls[0]!;
    assert.deepEqual(deps.routeConfig(context, { agentControls: controls }), conversation);
  });

  it("publishes nothing when the conversation already uses the route default", async () => {
    const { deps, context, publisher } = harness();
    const result = await promoteRouteDefault(deps, context, undefined);
    assert.equal(result.text, "This conversation already uses the route default.");
    assert.equal(vi.mocked(publisher.promote).mock.calls.length, 0);
  });

  it("refuses a sender who does not manage the Channel Route", async () => {
    const { deps, context, publisher } = harness({ conversation: OPUS, manager: false });
    const result = await promoteRouteDefault(deps, context, undefined);
    assert.match(
      result.text,
      /^\/promoteroutedefault needs permission to manage .*\(channel\.manage\)/u,
    );
    assert.equal(vi.mocked(publisher.promote).mock.calls.length, 0);
  });

  it("tells the sender when the route changed under them", async () => {
    const { deps, context, clearConversationSelection } = harness({
      conversation: OPUS,
      outcome: { status: "route_changed" },
    });
    const result = await promoteRouteDefault(deps, context, undefined);
    assert.equal(
      result.text,
      "This route changed since this session started. Check /routedefault, then try again.",
    );
    assert.equal(clearConversationSelection.mock.calls.length, 0);
  });

  it("restores the previous default on undo", async () => {
    const { deps, context } = harness();
    const result = await promoteRouteDefault(deps, context, "undo");
    assert.equal(
      result.text,
      'Default restored for route #2 (mention, contains "deploy"): codex / gpt-5.6-luna / medium.',
    );
  });

  it("says when there is nothing to undo", async () => {
    const { deps, context } = harness({ outcome: { status: "nothing_to_undo" } });
    const result = await promoteRouteDefault(deps, context, "undo");
    assert.equal(result.text, "Nothing to undo for this route.");
  });
});

describe("/routedefault", () => {
  it("shows the conversation line only when it differs from the default", async () => {
    const same = harness();
    assert.equal(
      await routeDefaultText(same.deps, same.context),
      'Route #2 (mention, contains "deploy")\nDefault: codex / gpt-5.6-luna / medium',
    );
    const different = harness({ conversation: OPUS });
    assert.equal(
      await routeDefaultText(different.deps, different.context),
      [
        'Route #2 (mention, contains "deploy")',
        "Default: codex / gpt-5.6-luna / medium",
        "This conversation: claude / claude-opus-5 / high",
      ].join("\n"),
    );
  });
});
