import pino from "pino";
import { describe, expect, test } from "vitest";

import type { AgentSession, AgentSessionConfig } from "../agent-sdk-types.js";
import { CodexAppServerAgentClient, CodexAppServerAgentSession } from "./codex-app-server-agent.js";
import {
  createFakeCodexAppServer,
  type FakeCodexAppServer,
} from "./codex/test-utils/fake-app-server.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";

const CODEX_PROVIDER = "codex";

interface CollaborationModeRecord {
  name: string;
  mode?: string | null;
  model?: string | null;
  reasoning_effort?: string | null;
  developer_instructions?: string | null;
}

const TEST_SPEED_MODELS = [
  "gpt-6-astra",
  "gpt-6.1-sol",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
].map((id) => ({
  id,
  isDefault: id === "gpt-5.4",
  defaultReasoningEffort: "medium",
  serviceTiers: [{ id: "priority", name: "Fast", description: "Faster processing" }],
}));

function speedFeature(value: string) {
  return {
    type: "select",
    id: "service_tier",
    label: "Speed",
    description: "Choose processing speed. Faster tiers increase usage.",
    tooltip: "Select speed",
    icon: "zap",
    desktopTrigger: "icon",
    value,
    options: [
      { id: "default", label: "Normal", isDefault: true },
      { id: "priority", label: "Fast" },
    ],
  };
}

const TEST_COLLABORATION_MODES: CollaborationModeRecord[] = [
  {
    name: "Code",
    mode: "code",
    developer_instructions: "Built-in code mode",
  },
  {
    name: "Plan",
    mode: "plan",
    developer_instructions: "Built-in plan mode",
  },
];

type CodexFeaturesTestSession = AgentSession;

interface CapturedLogEntry {
  level?: number;
  msg?: string;
  [key: string]: unknown;
}

function createCapturedLogger(): { logger: pino.Logger; entries: CapturedLogEntry[] } {
  const entries: CapturedLogEntry[] = [];
  const logger = pino(
    { level: "debug" },
    {
      write(line: string) {
        entries.push(JSON.parse(line) as CapturedLogEntry);
      },
    },
  );
  return { logger, entries };
}

function createConfig(overrides: Partial<AgentSessionConfig> = {}): AgentSessionConfig {
  return {
    provider: CODEX_PROVIDER,
    cwd: "/tmp/codex-fast-mode-test",
    modeId: "auto",
    model: "gpt-5.4",
    ...overrides,
  };
}

interface SessionHarnessOptions {
  logger?: pino.Logger;
  models?: unknown[];
  collaborationModes?: CollaborationModeRecord[];
  resumeMetadata?: Record<string, unknown>;
}

function createSessionHarness(
  configOverrides: Partial<AgentSessionConfig> = {},
  options: SessionHarnessOptions = {},
): {
  session: CodexFeaturesTestSession;
  appServer: FakeCodexAppServer;
} {
  const config = createConfig(configOverrides);
  const appServer = createFakeCodexAppServer({
    "collaborationMode/list": () => ({
      data: options.collaborationModes ?? TEST_COLLABORATION_MODES,
    }),
    "model/list": () => ({ data: options.models ?? TEST_SPEED_MODELS }),
  });
  const resumeHandle = options.resumeMetadata
    ? { sessionId: "thread-restored", metadata: options.resumeMetadata }
    : null;
  const session = new CodexAppServerAgentSession(
    { ...config, provider: CODEX_PROVIDER },
    resumeHandle,
    options.logger ?? createTestLogger(),
    async () => appServer.child,
  ) as CodexFeaturesTestSession;
  return { session, appServer };
}

async function createConnectedSession(
  configOverrides: Partial<AgentSessionConfig> = {},
  options: SessionHarnessOptions = {},
): Promise<{
  session: CodexFeaturesTestSession;
  appServer: FakeCodexAppServer;
}> {
  const harness = createSessionHarness(configOverrides, options);
  await harness.session.connect();
  harness.appServer.assertNoErrors();
  return harness;
}

describe("Codex provider catalog modes", () => {
  async function catalogModeIds(collaborationModes: CollaborationModeRecord[]): Promise<string[]> {
    const appServer = createFakeCodexAppServer({
      "collaborationMode/list": () => ({ data: collaborationModes }),
    });
    const client = new CodexAppServerAgentClient(createTestLogger(), {
      command: { mode: "replace", argv: ["/nonexistent/codex-binary-that-does-not-exist"] },
    });
    Object.assign(client, { spawnAppServer: async () => appServer.child });
    const catalog = await client.fetchCatalog({
      scope: "workspace",
      cwd: "/tmp/codex-catalog-modes",
      force: false,
    });
    return catalog.modes.map((mode) => mode.id);
  }

  test("lists Plan first when Codex offers a plan collaboration mode", async () => {
    await expect(catalogModeIds(TEST_COLLABORATION_MODES)).resolves.toEqual([
      "plan",
      "auto",
      "full-access",
    ]);
  });

  test("leaves Plan out when Codex offers no plan collaboration mode", async () => {
    await expect(catalogModeIds([{ name: "Code", mode: "code" }])).resolves.toEqual([
      "auto",
      "full-access",
    ]);
  });
});

describe("Codex app-server provider features", () => {
  test("GPT-6.1 Sol offers catalog speed tiers and sends Ultrafast", async () => {
    const { session, appServer } = await createConnectedSession(
      { model: "gpt-6.1-sol" },
      {
        models: [
          {
            id: "gpt-6.1-sol",
            serviceTiers: [
              { id: "priority", name: "Fast", description: "Faster processing" },
              { id: "ultrafast", name: "Ultrafast", description: "Lowest latency" },
            ],
          },
        ],
      },
    );
    try {
      expect(session.features).toContainEqual(
        expect.objectContaining({
          id: "service_tier",
          type: "select",
          value: "default",
          options: [
            { id: "default", label: "Normal", isDefault: true },
            { id: "priority", label: "Fast" },
            { id: "ultrafast", label: "Ultrafast" },
          ],
        }),
      );
      await session.setFeature?.("service_tier", "ultrafast");
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        serviceTier: "ultrafast",
      });
    } finally {
      await session.close();
    }
  });

  test("new models and service tiers work without a Clisbot catalog update", async () => {
    const { session, appServer } = await createConnectedSession(
      { model: "future-codex-model" },
      {
        models: [
          {
            id: "future-codex-model",
            serviceTiers: [
              { id: "future-tier", name: "Future speed", description: "A newly advertised tier" },
            ],
          },
        ],
      },
    );
    try {
      expect(session.features).toContainEqual(
        expect.objectContaining({
          id: "service_tier",
          options: [
            { id: "default", label: "Normal", isDefault: true },
            { id: "future-tier", label: "Future speed" },
          ],
        }),
      );
      await session.setFeature?.("service_tier", "future-tier");
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        model: "future-codex-model",
        serviceTier: "future-tier",
      });
    } finally {
      await session.close();
    }
  });

  test.each(["priority", "ultrafast"])(
    "restores %s and Normal explicitly overrides an existing thread tier",
    async (tier) => {
      const { session, appServer } = await createConnectedSession(
        { model: "future-model", featureValues: { service_tier: tier } },
        {
          models: [
            {
              id: "future-model",
              serviceTiers: [
                { id: "priority", name: "Fast", description: "Fast processing" },
                { id: "ultrafast", name: "Ultrafast", description: "Ultra processing" },
              ],
            },
          ],
        },
      );
      try {
        expect(session.features).toContainEqual(
          expect.objectContaining({ id: "service_tier", value: tier }),
        );
        await session.getRuntimeInfo();
        await session.setFeature?.("service_tier", "default");
        await session.startTurn("hello");
        await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
          serviceTier: "default",
        });
      } finally {
        await session.close();
      }
    },
  );

  test("rejects unadvertised tiers and non-string values", async () => {
    const { session } = await createConnectedSession();
    try {
      for (const value of ["ultrafast", "bogus", true, null]) {
        await expect(session.setFeature?.("service_tier", value)).rejects.toThrow(
          "is not available",
        );
      }
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "service_tier", value: "default" }),
      );
    } finally {
      await session.close();
    }
  });

  test("switching to a model without the selected tier resets speed", async () => {
    const { session, appServer } = await createConnectedSession(
      { model: "ultra-model", featureValues: { service_tier: "ultrafast" } },
      {
        models: [
          {
            id: "ultra-model",
            serviceTiers: [{ id: "ultrafast", name: "Ultrafast", description: "Ultra processing" }],
          },
          ...TEST_SPEED_MODELS,
        ],
      },
    );
    try {
      await session.setModel("gpt-6.1-sol");
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "service_tier", value: "default" }),
      );
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({ serviceTier: "default" });
    } finally {
      await session.close();
    }
  });

  test("maps legacy Fast commands to the catalog's request id", async () => {
    const { session, appServer } = await createConnectedSession();
    try {
      await session.setFeature?.("fast_mode", true);
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        serviceTier: "priority",
      });
    } finally {
      await session.close();
    }
  });

  test.each([
    "gpt-6-astra",
    "gpt-6.1-sol",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-5.6",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
  ])("exposes and sends Fast for %s", async (model) => {
    const { session, appServer } = await createConnectedSession({ model });
    try {
      expect(session.features).toContainEqual(
        expect.objectContaining({
          id: "service_tier",
          value: "default",
        }),
      );
      await session.setFeature?.("service_tier", "priority");
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        model,
        serviceTier: "priority",
      });
    } finally {
      await session.close();
    }
  });

  test.each([
    "gpt-5.3-codex-spark",
    "gpt-5.3-codex",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.5-pro",
    "gpt-5",
    "gpt-4.1",
    "o3",
    "o4-mini",
    "gpt-6-unknown",
  ])("does not expose or restore Fast for %s", async (model) => {
    const { session, appServer } = await createConnectedSession({
      model,
      featureValues: { fast_mode: true },
    });
    try {
      expect(session.features).toEqual([]);
      await expect(session.setFeature?.("fast_mode", true)).rejects.toThrow(
        `Codex fast mode is not available for model '${model}'`,
      );
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        serviceTier: "default",
      });
    } finally {
      await session.close();
    }
  });

  test("restores Fast on Astra and preserves it when switching supported models", async () => {
    const { session, appServer } = await createConnectedSession({
      model: "gpt-6-astra",
      featureValues: { fast_mode: true },
    });
    try {
      expect(session.features).toContainEqual(
        expect.objectContaining({
          id: "service_tier",
          value: "priority",
        }),
      );
      await session.setModel("gpt-5.6-sol");
      await session.setModel("gpt-6-astra");
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        model: "gpt-6-astra",
        serviceTier: "priority",
      });
    } finally {
      await session.close();
    }
  });

  test("features returns only the speed selector", async () => {
    const { session } = await createConnectedSession();

    expect(session.features).toEqual([speedFeature("default")]);

    await session.setFeature?.("service_tier", "priority");
    await session.setMode("plan");

    expect(session.features).toEqual([speedFeature("priority")]);
  });

  test("features is empty when the model does not support fast mode", async () => {
    const { session } = await createConnectedSession({ model: "gpt-3.5-turbo" });

    expect(session.features).toEqual([]);
  });

  test("constructor ignores restored fast mode when model does not support it", async () => {
    const { session, appServer } = await createConnectedSession({
      model: "gpt-3.5-turbo",
      featureValues: { fast_mode: true },
    });

    expect(session.features).toEqual([]);

    await session.startTurn("hello");
    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "default",
    });
  });

  test("selecting Fast sends the catalog service tier", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("service_tier", "priority");
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "priority",
    });
  });

  test("legacy Fast off explicitly selects Normal", async () => {
    const { session, appServer } = await createConnectedSession({
      featureValues: { fast_mode: true },
    });

    await session.setFeature?.("fast_mode", false);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "default",
    });
  });

  test("setFeature('fast_mode', true) rejects models that do not support fast mode", async () => {
    const { session } = await createConnectedSession({ model: "gpt-3.5-turbo" });

    await expect(session.setFeature?.("fast_mode", true)).rejects.toThrow(
      "Codex fast mode is not available for model 'gpt-3.5-turbo'",
    );
  });

  test("selecting Plan invalidates runtime info", async () => {
    const { session } = await createConnectedSession();

    await expect(session.getRuntimeInfo()).resolves.not.toMatchObject({
      extra: { collaborationMode: "Plan" },
    });

    await session.setMode("plan");

    await expect(session.getRuntimeInfo()).resolves.toMatchObject({
      modeId: "plan",
      extra: { collaborationMode: "Plan" },
    });
  });

  test("setFeature throws for unknown feature ids", async () => {
    const { session } = createSessionHarness();

    await expect(session.setFeature?.("unknown_feature", true)).rejects.toThrow(
      "Unknown Codex feature: unknown_feature",
    );
  });

  test("constructor restores Fast and legacy plan_mode from config.featureValues", async () => {
    const { session, appServer } = await createConnectedSession({
      featureValues: { fast_mode: true, plan_mode: true },
    });

    expect(session.features).toEqual([speedFeature("priority")]);
    await expect(session.getCurrentMode()).resolves.toBe("plan");

    await session.startTurn("hello");
    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "priority",
      collaborationMode: expect.objectContaining({
        mode: "plan",
      }),
    });
  });

  test("startTurn includes serviceTier when fast mode is enabled", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("service_tier", "priority");
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "priority",
    });
  });

  test("startTurn logs a sanitized turn/start summary for fast mode observability", async () => {
    const capture = createCapturedLogger();
    const prompt = "secret prompt text should not be logged";
    const { session } = await createConnectedSession(
      { featureValues: { fast_mode: true } },
      { logger: capture.logger },
    );

    await session.startTurn(prompt);

    const entry = capture.entries.find(
      (candidate) => candidate.msg === "Starting Codex app-server turn",
    );
    expect(entry).toMatchObject({
      level: 30,
      msg: "Starting Codex app-server turn",
      model: "gpt-5.4",
      modeId: "auto",
      serviceTier: "priority",
      cwd: "/tmp/codex-fast-mode-test",
    });
    expect(JSON.stringify(entry)).not.toContain(prompt);
  });

  test("setModel clears fast mode when switching to an unsupported model", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("service_tier", "priority");
    await session.setModel("gpt-3.5-turbo");

    expect(session.features).toEqual([]);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "default",
    });
  });

  test("Plan joins the Mode list before the permission modes instead of being a toggle", async () => {
    const { session } = await createConnectedSession();
    try {
      const modes = await session.getAvailableModes();
      expect(modes.map((mode) => mode.id)).toEqual(["plan", "auto", "full-access"]);
      expect(modes[0]).toMatchObject({ id: "plan", label: "Plan" });
      expect(session.features.map((feature) => feature.id)).toEqual(["service_tier"]);
    } finally {
      await session.close();
    }
  });

  test("Plan is absent when Codex offers no plan collaboration mode", async () => {
    const { session } = await createConnectedSession(
      {},
      { collaborationModes: [{ name: "Code", mode: "code" }] },
    );
    try {
      const modes = await session.getAvailableModes();
      expect(modes.map((mode) => mode.id)).toEqual(["auto", "full-access"]);
      await expect(session.setMode("plan")).rejects.toThrow("plan");
    } finally {
      await session.close();
    }
  });

  test("a session started in Plan leaves it when Codex offers no plan collaboration mode", async () => {
    const { session, appServer } = await createConnectedSession(
      { modeId: "plan" },
      {
        collaborationModes: [{ name: "Code", mode: "code" }],
        resumeMetadata: { modeId: "plan", permissionModeId: "full-access" },
      },
    );
    try {
      await expect(session.getCurrentMode()).resolves.toBe("full-access");
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        approvalPolicy: "never",
        collaborationMode: expect.objectContaining({ mode: "code" }),
      });
    } finally {
      await session.close();
    }
  });

  test("selecting Plan turns on plan collaboration and keeps the chosen permission", async () => {
    const { session, appServer } = await createConnectedSession({ modeId: "full-access" });
    try {
      await session.setMode("plan");
      await expect(session.getCurrentMode()).resolves.toBe("plan");
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        approvalPolicy: "never",
        sandboxPolicy: expect.objectContaining({ type: "dangerFullAccess" }),
        collaborationMode: expect.objectContaining({ mode: "plan" }),
      });
      expect(session.describePersistence()?.metadata).toMatchObject({
        modeId: "plan",
        permissionModeId: "full-access",
      });
    } finally {
      await session.close();
    }
  });

  test("selecting a permission mode turns plan off and applies that permission", async () => {
    const { session, appServer } = await createConnectedSession({ modeId: "full-access" });
    try {
      await session.setMode("plan");
      await session.setMode("auto");
      await expect(session.getCurrentMode()).resolves.toBe("auto");
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        approvalPolicy: "on-request",
        collaborationMode: expect.objectContaining({ mode: "code" }),
      });
    } finally {
      await session.close();
    }
  });

  test("legacy setFeature plan_mode maps to the Plan mode", async () => {
    const { session, appServer } = await createConnectedSession({ modeId: "full-access" });
    try {
      await session.setFeature?.("plan_mode", true);
      await expect(session.getCurrentMode()).resolves.toBe("plan");
      await session.setFeature?.("plan_mode", false);
      await expect(session.getCurrentMode()).resolves.toBe("full-access");
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        approvalPolicy: "never",
        collaborationMode: expect.objectContaining({ mode: "code" }),
      });
    } finally {
      await session.close();
    }
  });

  test("a session saved with featureValues.plan_mode restores as mode plan", async () => {
    const { session, appServer } = await createConnectedSession({
      modeId: "full-access",
      featureValues: { plan_mode: true },
    });
    try {
      await expect(session.getCurrentMode()).resolves.toBe("plan");
      expect(session.features.map((feature) => feature.id)).toEqual(["service_tier"]);
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        approvalPolicy: "never",
        collaborationMode: expect.objectContaining({ mode: "plan" }),
      });
    } finally {
      await session.close();
    }
  });

  test("a session saved in Plan restores Plan over its remembered permission", async () => {
    const { session, appServer } = await createConnectedSession(
      { modeId: "plan" },
      { resumeMetadata: { modeId: "plan", permissionModeId: "full-access" } },
    );
    try {
      await expect(session.getCurrentMode()).resolves.toBe("plan");
      await session.setMode("full-access");
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        approvalPolicy: "never",
        collaborationMode: expect.objectContaining({ mode: "code" }),
      });
    } finally {
      await session.close();
    }
  });

  test("a stale plan_mode flag does not override a mode saved by this daemon", async () => {
    const { session } = await createConnectedSession(
      { modeId: "auto", featureValues: { plan_mode: true } },
      { resumeMetadata: { modeId: "auto", permissionModeId: "auto" } },
    );
    try {
      await expect(session.getCurrentMode()).resolves.toBe("auto");
    } finally {
      await session.close();
    }
  });

  test("picks the plan collaboration mode by its mode value before its name", async () => {
    const { session, appServer } = await createConnectedSession(
      {},
      {
        collaborationModes: [
          { name: "Read-heavy review", mode: "code", developer_instructions: "review" },
          { name: "Architect", mode: "plan", developer_instructions: "architect" },
        ],
      },
    );
    try {
      await session.setMode("plan");
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        collaborationMode: {
          mode: "plan",
          settings: expect.objectContaining({ developer_instructions: "architect" }),
        },
      });
    } finally {
      await session.close();
    }
  });

  test("falls back to the name match when Codex returns no mode values", async () => {
    const { session, appServer } = await createConnectedSession(
      {},
      { collaborationModes: [{ name: "Code" }, { name: "Plan" }] },
    );
    try {
      expect((await session.getAvailableModes()).map((mode) => mode.id)).toContain("plan");
      await session.setMode("plan");
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        collaborationMode: expect.objectContaining({ mode: "plan" }),
      });
    } finally {
      await session.close();
    }
  });

  test("startTurn switches collaboration mode when plan mode is enabled", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("plan_mode", true);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      collaborationMode: expect.objectContaining({
        mode: "plan",
      }),
    });
  });
});
