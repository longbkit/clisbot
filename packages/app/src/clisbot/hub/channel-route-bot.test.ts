import { describe, expect, it } from "vitest";
import type { BotPayload } from "@/clisbot/bots/data/contracts";
import { buildChannelRouteCandidate, replaceChannelRouteCandidate } from "./channel-configuration";
import {
  botLaunchChanged,
  botRouteTarget,
  routeBotMatch,
  routeBotOptions,
  type RouteBotOption,
} from "./channel-route-bot";

function bot(overrides: Partial<BotPayload> = {}): BotPayload {
  return {
    id: "bot_luna",
    slug: "luna",
    name: "Luna",
    title: null,
    description: "Support assistant",
    avatar: null,
    projectId: "project-luna",
    workspaceId: "workspace-luna",
    cwd: "/home/me/.clisbot/workspaces/luna",
    kind: "personal",
    launchDefaults: {
      provider: "codex",
      model: "gpt-5.6-luna",
      modeId: "auto",
      thinkingOptionId: "high",
      featureValues: { fast_mode: true },
    },
    ...overrides,
  };
}

const daemons = [
  { id: "daemon-mac", connectionOffer: { serverId: "server-mac" } },
  { id: "daemon-pending", connectionOffer: null },
];

function lunaOption(): RouteBotOption {
  const [option] = routeBotOptions(
    [{ ...bot(), serverId: "server-mac", serverName: "Mac mini" }],
    daemons,
  );
  return option!;
}

describe("routeBotOptions", () => {
  it("offers Bots on Hosts the Hub knows, by name, keyed by Host and Bot", () => {
    const options = routeBotOptions(
      [
        { ...bot({ id: "bot_zed", name: "Zed" }), serverId: "server-mac", serverName: "Mac mini" },
        { ...bot(), serverId: "server-mac", serverName: "Mac mini" },
        { ...bot({ id: "bot_far" }), serverId: "server-unknown", serverName: "Laptop" },
      ],
      daemons,
    );
    expect(options.map((option) => [option.key, option.daemonId, option.bot.name])).toEqual([
      ["server-mac/bot_luna", "daemon-mac", "Luna"],
      ["server-mac/bot_zed", "daemon-mac", "Zed"],
    ]);
    expect(options[0]?.bot).not.toHaveProperty("serverId");
  });
});

describe("botRouteTarget", () => {
  it("runs the Bot's folder with its launch defaults and keeps sessions in its Workspace", () => {
    expect(botRouteTarget(lunaOption())).toEqual({
      kind: "agent",
      daemonId: "daemon-mac",
      projectId: "project-luna",
      cwd: "/home/me/.clisbot/workspaces/luna",
      provider: "codex",
      model: "gpt-5.6-luna",
      mode: "auto",
      thinkingOptionId: "high",
      featureValues: { fast_mode: true },
      workspaceOrganize: "off",
    });
  });

  it("leaves out the launch settings the Bot does not set", () => {
    const option = { ...lunaOption(), bot: bot({ launchDefaults: { provider: "claude" } }) };
    expect(botRouteTarget(option)).toEqual({
      kind: "agent",
      daemonId: "daemon-mac",
      projectId: "project-luna",
      cwd: "/home/me/.clisbot/workspaces/luna",
      provider: "claude",
      workspaceOrganize: "off",
    });
  });

  it("writes the shared Agent resources and workspace.organize: false on the Route", () => {
    const candidate = buildChannelRouteCandidate({
      accountId: "luna",
      audience: [{ who: { roles: ["owner"] }, where: { dm: true } }],
      target: botRouteTarget(lunaOption()),
      resource: {},
    });
    expect(candidate.route).toMatchObject({
      agent: "channel-luna",
      environment: "channel-luna",
      workspace: { organize: false },
    });
    expect(candidate.resource).toEqual({
      agents: {
        "channel-luna": {
          provider: "codex",
          model: "gpt-5.6-luna",
          mode: "auto",
          thinkingOptionId: "high",
          featureValues: { fast_mode: true },
        },
      },
      environments: {
        "channel-luna": {
          kind: "daemon",
          daemon: "daemon-mac",
          projectId: "project-luna",
          cwd: "/home/me/.clisbot/workspaces/luna",
        },
      },
    });
  });

  it("an Agent target leaves the Route's workspace settings alone", () => {
    const target = botRouteTarget(lunaOption());
    delete target.workspaceOrganize;
    const candidate = buildChannelRouteCandidate({
      accountId: "luna",
      audience: [{ who: { roles: ["owner"] }, where: { dm: true } }],
      target,
      resource: {},
    });
    expect(candidate.route).not.toHaveProperty("workspace");
  });

  it("an edit keeps the Route keys the form does not show", () => {
    const audience = [{ who: { roles: ["owner" as const] }, where: { dm: true } }];
    const current = {
      audience,
      agent: "channel-luna",
      environment: "channel-luna",
      workspace: { organize: false },
      questions: "recommended",
    };
    const { route } = replaceChannelRouteCandidate({
      accountId: "luna",
      audience,
      target: botRouteTarget(lunaOption()),
      resource: {},
      currentRoute: current,
      accounts: [{ channel: "telegram", accountId: "luna", routes: [current] }],
    });
    expect(route).toMatchObject({ questions: "recommended", workspace: { organize: false } });
  });
});

describe("a Bot's Route saved as an Agent's", () => {
  it("drops the Route's own workspace.organize and keeps the other keys", () => {
    const audience = [{ who: { roles: ["owner" as const] }, where: { dm: true } }];
    const current = {
      audience,
      agent: "channel-luna",
      environment: "channel-luna",
      workspace: { organize: false },
      questions: "recommended",
    };
    const target = botRouteTarget(lunaOption());
    target.workspaceOrganize = "inherit";
    target.model = "gpt-5";
    const { route, resource } = replaceChannelRouteCandidate({
      accountId: "luna",
      audience,
      target,
      resource: {},
      currentRoute: current,
      accounts: [{ channel: "telegram", accountId: "luna", routes: [current] }],
    });
    expect(route).not.toHaveProperty("workspace");
    expect(route).toMatchObject({ questions: "recommended", agent: "channel-luna" });
    // No longer a Bot's: reopening it finds no Bot.
    const environments = resource["environments"] as Record<string, Record<string, unknown>>;
    expect(routeBotMatch(route, environments["channel-luna"]!, [lunaOption()])).toBeNull();
  });
});

describe("routeBotMatch", () => {
  const environment = {
    kind: "daemon",
    daemon: "daemon-mac",
    projectId: "project-luna",
    cwd: "/home/me/.clisbot/workspaces/luna",
  };
  const route = { workspace: { organize: false } };

  it("finds the Bot whose folder the Route runs in", () => {
    expect(routeBotMatch(route, environment, [lunaOption()])?.key).toBe("server-mac/bot_luna");
  });

  it("is not a Bot's Route without workspace.organize: false", () => {
    expect(routeBotMatch({}, environment, [lunaOption()])).toBeNull();
    expect(
      routeBotMatch({ workspace: { organize: true } }, environment, [lunaOption()]),
    ).toBeNull();
  });

  it("is not a Bot's Route on another Host, Project, folder or a worktree", () => {
    const options = [lunaOption()];
    expect(routeBotMatch(route, { ...environment, daemon: "daemon-other" }, options)).toBeNull();
    expect(routeBotMatch(route, { ...environment, projectId: "other" }, options)).toBeNull();
    expect(routeBotMatch(route, { ...environment, cwd: "/elsewhere" }, options)).toBeNull();
    expect(routeBotMatch(route, { ...environment, worktree: { kind: "new" } }, options)).toBeNull();
    expect(routeBotMatch(route, null, options)).toBeNull();
    expect(routeBotMatch(undefined, environment, options)).toBeNull();
  });
});

describe("botLaunchChanged", () => {
  it("compares provider, model, mode and thinking with what the Route saved", () => {
    const saved = {
      provider: "codex",
      model: "gpt-5.6-luna",
      mode: "auto",
      thinkingOptionId: "high",
      featureValues: { fast_mode: true },
    };
    expect(botLaunchChanged(lunaOption(), saved)).toBe(false);
    expect(botLaunchChanged(lunaOption(), { ...saved, model: "gpt-5" })).toBe(true);
    expect(botLaunchChanged(lunaOption(), { ...saved, mode: undefined })).toBe(true);
    expect(botLaunchChanged(lunaOption(), null)).toBe(true);
  });

  it("compares feature values too", () => {
    const saved = {
      provider: "codex",
      model: "gpt-5.6-luna",
      mode: "auto",
      thinkingOptionId: "high",
      featureValues: { fast_mode: true },
    };
    expect(botLaunchChanged(lunaOption(), saved)).toBe(false);
    expect(botLaunchChanged(lunaOption(), { ...saved, featureValues: { fast_mode: false } })).toBe(
      true,
    );
    expect(botLaunchChanged(lunaOption(), { ...saved, featureValues: undefined })).toBe(true);
    const plain = { ...lunaOption(), bot: bot({ launchDefaults: { provider: "codex" } }) };
    expect(botLaunchChanged(plain, { provider: "codex", featureValues: {} })).toBe(false);
  });
});
