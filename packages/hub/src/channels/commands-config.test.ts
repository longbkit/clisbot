import { expect, it, vi } from "vitest";
import {
  runConfigurationCommand,
  resolveConversationConfiguration,
  validateAgentConfigurationAuthority,
  type ConfigurationCommandInput,
} from "./commands-config.js";
import { configurationDaemonStub } from "./daemon/test-support.js";
import type { DaemonConnection } from "./daemon/client.js";

function fixture(
  name: ConfigurationCommandInput["command"]["name"],
  value?: string,
): ConfigurationCommandInput {
  const daemon = {
    ...configurationDaemonStub(),
    listProviderModels: vi.fn(async (provider: string) => [
      {
        provider,
        id: "small",
        label: "Small",
        isDefault: true,
        defaultThinkingOptionId: "low",
        thinkingOptions: [
          { id: "low", label: "Low" },
          { id: "high", label: "High" },
        ],
      },
      {
        provider,
        id: "large",
        label: "Large",
        defaultThinkingOptionId: "high",
        thinkingOptions: [{ id: "high", label: "High" }],
      },
    ]),
    listProviderModes: async () => [
      { id: "auto-review", label: "Auto review", isUnattended: false },
      { id: "auto", label: "Auto", isUnattended: false },
      { id: "default", label: "Default", isUnattended: false },
      { id: "full-access", label: "Full", isUnattended: true },
    ],
    applyAgentConfig: vi.fn(async () => undefined),
    setAgentMode: vi.fn(async () => undefined),
    setAgentThinkingOption: vi.fn(async () => undefined),
    createAgent: vi.fn(),
  } as unknown as DaemonConnection;
  return {
    command: { name, ...(value === undefined ? {} : { value }) },
    daemon,
    config: {
      provider: "codex",
      cwd: "/repo",
      model: "small",
      thinkingOptionId: "low",
      modeId: "default",
    },
    agentId: "bound",
    access: { unrestricted: true, agentConfigurations: [] },
    canSuppressApprovals: false,
  };
}
it("applies model and default effort live without creating an agent", async () => {
  const input = fixture("model", "large");
  const result = await runConfigurationCommand(input);
  expect(result.remint).toBe(false);
  expect(result.selection?.selectedThinkingOption).toBe("high");
  expect(input.daemon.applyAgentConfig).toHaveBeenCalledWith("bound", {
    modelId: "large",
    thinkingOptionId: "high",
    modeId: "default",
  });
  expect(input.daemon.createAgent).not.toHaveBeenCalled();
});
it("scopes model list to current provider and grant", async () => {
  const input = fixture("model", "list");
  input.access = {
    unrestricted: false,
    agentConfigurations: [{ providerId: "codex", modelIds: ["small"], thinkingOptionIds: ["low"] }],
  };
  const result = await runConfigurationCommand(input);
  expect(result.text).toContain("codex/small");
  expect(result.text).not.toContain("large");
  expect(input.daemon.listProviderModels).toHaveBeenCalledWith("codex", "/repo");
});
it("refuses cross-provider models and invalid effort before mutation", async () => {
  for (const input of [fixture("model", "claude/large"), fixture("effort", "max")]) {
    expect((await runConfigurationCommand(input)).selection).toBeUndefined();
    expect(input.daemon.applyAgentConfig).not.toHaveBeenCalled();
    expect(input.daemon.setAgentThinkingOption).not.toHaveBeenCalled();
  }
});
it("does not combine unrelated model and effort grants", async () => {
  const input = fixture("model", "large");
  input.access = {
    unrestricted: false,
    agentConfigurations: [
      { providerId: "codex", modelIds: ["large"], thinkingOptionIds: ["low"] },
      { providerId: "codex", modelIds: ["small"], thinkingOptionIds: ["high"] },
    ],
  };
  expect((await runConfigurationCommand(input)).text).toContain(
    "outside your AgentConfigurationGrant",
  );
  expect(input.daemon.applyAgentConfig).not.toHaveBeenCalled();
});
it("provider switch resets model, effort, feature values and provider options", async () => {
  const input = fixture("provider", "claude");
  input.config = {
    ...input.config,
    model: "large",
    thinkingOptionId: "high",
    providerOptions: { codexOnly: true },
    featureValues: { auto_accept: true },
  };
  const result = await runConfigurationCommand(input);
  expect(result.remint).toBe(true);
  expect(result.selection).toMatchObject({
    selectedProvider: "claude",
    selectedModel: "small",
    selectedThinkingOption: "low",
    selectedFeatureValues: null,
  });
  const next = resolveConversationConfiguration(input.config, result.selection);
  expect(next.providerOptions).toBeUndefined();
  expect(next.featureValues).toBeUndefined();
});
it("keeps effort and safe permission edits live, gates unattended permissions", async () => {
  const input = fixture("effort", "high");
  expect((await runConfigurationCommand(input)).remint).toBe(false);
  expect(input.daemon.setAgentThinkingOption).toHaveBeenCalledWith("bound", "high");
  input.command = { name: "permission", value: "full-access" };
  expect((await runConfigurationCommand(input)).text).toContain("approval.*");
  expect(input.daemon.setAgentMode).not.toHaveBeenCalled();
  input.canSuppressApprovals = true;
  expect((await runConfigurationCommand(input)).selection?.selectedMode).toBe("full-access");
});
it("applies profiles as concrete bundles and filters by grants", async () => {
  const input = fixture("agent", "preset");
  input.daemon.listAgentProfiles = async () => [
    {
      id: "preset",
      name: "Preset",
      provider: "codex",
      model: "large",
      modeId: "default",
      featureValues: { fast: true },
    },
  ];
  const result = await runConfigurationCommand(input);
  expect(result.selection).toMatchObject({
    selectedModel: "large",
    selectedThinkingOption: "high",
    selectedFeatureValues: { fast: true },
  });
  input.command.value = "list";
  input.access = {
    unrestricted: false,
    agentConfigurations: [{ providerId: "claude", modelIds: "*", thinkingOptionIds: "*" }],
  };
  expect((await runConfigurationCommand(input)).text).not.toContain("Preset");
});
it("reports unsupported atomic apply and provider rejection without success", async () => {
  const input = fixture("model", "large");
  input.daemon.getServerInfo = () => ({ serverId: "old" });
  expect((await runConfigurationCommand(input)).selection).toBeUndefined();
  input.daemon.getServerInfo = () => ({ serverId: "new", features: { agentConfigApply: true } });
  input.daemon.applyAgentConfig = async () => {
    throw new Error("provider busy");
  };
  expect(await runConfigurationCommand(input)).toEqual({ text: "provider busy" });
});
it("selecting the current provider leaves the configuration unchanged", async () => {
  const input = fixture("provider", "codex");
  input.config.model = "large";
  input.config.thinkingOptionId = "high";
  const result = await runConfigurationCommand(input);
  expect(result.remint).toBe(false);
  expect(result.selection?.selectedModel).toBe("large");
  expect(input.daemon.applyAgentConfig).not.toHaveBeenCalled();
});
it("an empty same-provider profile preserves live feature values", async () => {
  const input = fixture("agent", "empty");
  input.config.featureValues = { fast: true };
  input.daemon.listAgentProfiles = async () => [
    { id: "empty", name: "Empty", provider: "codex", featureValues: {} },
  ];
  expect((await runConfigurationCommand(input)).selection?.selectedFeatureValues).toEqual({
    fast: true,
  });
});
it("refuses inherited unattended configuration even for a model-only edit", async () => {
  const input = fixture("model", "large");
  input.config.modeId = "full-access";
  expect((await runConfigurationCommand(input)).text).toContain("approval.*");
  expect(input.daemon.applyAgentConfig).not.toHaveBeenCalled();
});
it("keeps model edits staged while another provider is still bound", async () => {
  const input = fixture("model", "large");
  input.activeProvider = "claude";
  expect((await runConfigurationCommand(input)).remint).toBe(true);
  expect(input.daemon.applyAgentConfig).not.toHaveBeenCalled();
});
it("applies a profile returning to the actual bound provider live", async () => {
  const input = fixture("agent", "return");
  input.config.provider = "claude";
  input.activeProvider = "codex";
  input.daemon.listAgentProfiles = async () => [
    { id: "return", name: "Return", provider: "codex", model: "large", modeId: "default" },
  ];
  expect((await runConfigurationCommand(input)).remint).toBe(false);
  expect(input.daemon.applyAgentConfig).toHaveBeenCalledWith(
    "bound",
    expect.objectContaining({ modelId: "large" }),
  );
});

it("retains and checks live auto-accept when returning from a staged provider", async () => {
  const input = fixture("provider", "codex");
  input.activeConfiguration = { ...input.config, featureValues: { auto_accept: true } };
  input.config = { ...input.config, provider: "claude" };
  input.activeProvider = "codex";
  const refused = await runConfigurationCommand(input);
  expect(refused.text).toContain("approval.*");
  expect(refused.selection).toBeUndefined();
  expect(input.daemon.applyAgentConfig).not.toHaveBeenCalled();
  input.canSuppressApprovals = true;
  const allowed = await runConfigurationCommand(input);
  expect(allowed.remint).toBe(false);
  expect(allowed.selection?.selectedFeatureValues).toEqual({ auto_accept: true });
  expect(input.daemon.applyAgentConfig).toHaveBeenCalledWith(
    "bound",
    expect.objectContaining({
      featureValues: { auto_accept: true },
    }),
  );
});
it("allows an explicit profile feature to disable live auto-accept on return", async () => {
  const input = fixture("agent", "safe");
  input.activeConfiguration = {
    ...input.config,
    featureValues: { auto_accept: true, unrelated: true },
  };
  input.config = { ...input.config, provider: "claude" };
  input.daemon.listAgentProfiles = async () => [
    {
      id: "safe",
      name: "Safe",
      provider: "codex",
      modeId: "default",
      featureValues: { auto_accept: false },
    },
  ];
  const result = await runConfigurationCommand(input);
  expect(result.remint).toBe(false);
  expect(result.selection?.selectedFeatureValues).toEqual({ auto_accept: false, unrelated: true });
  expect(input.daemon.applyAgentConfig).toHaveBeenCalledWith(
    "bound",
    expect.objectContaining({
      featureValues: { auto_accept: false, unrelated: true },
    }),
  );
});
it("does not copy live provider features into a newly staged provider", async () => {
  const input = fixture("provider", "claude");
  input.activeConfiguration = {
    ...input.config,
    featureValues: { auto_accept: true, fast_mode: true },
  };
  const result = await runConfigurationCommand(input);
  expect(result.remint).toBe(true);
  expect(result.selection?.selectedFeatureValues).toBeNull();
  expect(input.daemon.applyAgentConfig).not.toHaveBeenCalled();
});
it("filters fast profiles and refuses fast mode without its separate Access privilege", async () => {
  const input = fixture("agent", "list");
  input.daemon.listAgentProfiles = async () => [
    { id: "fast-preset", name: "Fast", provider: "codex", featureValues: { fast_mode: true } },
    {
      id: "standard-preset",
      name: "Standard",
      provider: "codex",
      featureValues: { fast_mode: false },
    },
  ];
  const listed = await runConfigurationCommand(input);
  expect(listed.text).not.toContain("fast-preset");
  expect(listed.text).toContain("standard-preset");
  input.command.value = "fast-preset";
  expect((await runConfigurationCommand(input)).text).toContain("agent.fast.use");
  expect(input.daemon.applyAgentConfig).not.toHaveBeenCalled();
  input.canUseFastMode = true;
  expect((await runConfigurationCommand(input)).selection?.selectedFeatureValues).toEqual({
    fast_mode: true,
  });
});
it("checks fast mode for final mint and resume authority, defaulting to refusal", async () => {
  const input = fixture("model", "large");
  const config = { ...input.config, featureValues: { fast_mode: true } };
  await expect(
    validateAgentConfigurationAuthority(input.daemon, config, input.access, true),
  ).rejects.toThrow("agent.fast.use");
  await expect(
    validateAgentConfigurationAuthority(input.daemon, config, input.access, true, true),
  ).resolves.toBeUndefined();
});
