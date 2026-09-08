import { AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";
import type { AgentConfigurationGrant } from "../access/contract.js";
import type { DaemonConnection } from "./daemon/client.js";
import type {
  AgentProfile,
  CreateAgentConfig,
  ProviderModel,
  ProviderMode,
} from "./daemon/types.js";

export interface ConfigurationAccess {
  unrestricted: boolean;
  agentConfigurations: AgentConfigurationGrant[];
}
export interface ConfigurationSelection {
  selectedProvider: string | null;
  selectedModel: string | null;
  selectedThinkingOption: string | null;
  selectedMode: string | null;
  selectedFeatureValues: Record<string, unknown> | null;
}
export interface ConfigurationCommandInput {
  command: { name: "agent" | "provider" | "model" | "effort" | "permission"; value?: string };
  daemon: DaemonConnection;
  config: CreateAgentConfig;
  agentId?: string;
  /** The bound process may still use a different provider while a change is staged. */
  activeProvider?: string;
  /** The normalized bound snapshot, including features that omitted RPC fields cannot clear. */
  activeConfiguration?: CreateAgentConfig;
  access: ConfigurationAccess;
  canSuppressApprovals: boolean;
  /** Separate Access privilege for the provider's faster paid service tier. */
  canUseFastMode?: boolean;
}
export interface ConfigurationCommandResult {
  text: string;
  selection?: ConfigurationSelection;
  remint?: boolean;
}

/** Concrete selections override the route bundle; a provider switch drops provider-specific options. */
export function resolveConversationConfiguration(
  base: CreateAgentConfig,
  selection: Partial<ConfigurationSelection> | null | undefined,
): CreateAgentConfig {
  if (selection?.selectedProvider == null)
    return selection?.selectedModel == null ? base : { ...base, model: selection.selectedModel };
  const {
    model: _model,
    thinkingOptionId: _thinking,
    modeId: _mode,
    featureValues: _features,
    providerOptions,
    ...common
  } = base;
  return {
    ...common,
    provider: selection.selectedProvider,
    ...(selection.selectedProvider === base.provider && providerOptions !== undefined
      ? { providerOptions }
      : {}),
    ...(selection.selectedModel == null ? {} : { model: selection.selectedModel }),
    ...(selection.selectedThinkingOption == null
      ? {}
      : { thinkingOptionId: selection.selectedThinkingOption }),
    ...(selection.selectedMode == null ? {} : { modeId: selection.selectedMode }),
    ...(selection.selectedFeatureValues == null
      ? {}
      : { featureValues: selection.selectedFeatureValues }),
  };
}

export async function runConfigurationCommand(
  input: ConfigurationCommandInput,
): Promise<ConfigurationCommandResult> {
  try {
    const listing = listQuery(input.command.value);
    if (listing !== undefined) return { text: await configurationMenu(input, listing) };
    const next = effectiveLiveConfiguration(input, await resolveTarget(input));
    await validateAgentConfigurationAuthority(
      input.daemon,
      next,
      input.access,
      input.canSuppressApprovals,
      input.canUseFastMode === true,
    );
    const remint =
      next.provider !==
      (input.activeConfiguration?.provider ?? input.activeProvider ?? input.config.provider);
    if (input.agentId !== undefined && !remint) await applyLive(input, next);
    return {
      text: `Provider: ${next.provider}; model: ${next.model ?? "default"}; effort: ${next.thinkingOptionId ?? "default"}; permission: ${next.modeId ?? "default"}.${remint ? " The next session uses this configuration." : ""}`,
      selection: toSelection(next),
      remint,
    };
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error) };
  }
}

/** Mode omission and feature omission preserve live values in agent.config.apply. */
function effectiveLiveConfiguration(
  input: ConfigurationCommandInput,
  next: CreateAgentConfig,
): CreateAgentConfig {
  const active = input.activeConfiguration;
  if (!input.agentId || !active || active.provider !== next.provider) return next;
  return {
    ...next,
    ...(next.modeId === undefined && active.modeId !== undefined ? { modeId: active.modeId } : {}),
    ...(active.providerOptions === undefined ? {} : { providerOptions: active.providerOptions }),
    ...(active.featureValues === undefined && next.featureValues === undefined
      ? {}
      : {
          featureValues: { ...active.featureValues, ...next.featureValues },
        }),
  };
}

function listQuery(value: string | undefined): string | undefined {
  if (!value || value.toLowerCase() === "list") return "";
  const search = /^search(?:\s+([\s\S]+))?$/iu.exec(value);
  return search ? (search[1] ?? "").toLowerCase() : undefined;
}
function includesQuery(value: string, query: string): boolean {
  return value.toLowerCase().includes(query);
}
function allows(
  access: ConfigurationAccess,
  provider: string,
  model?: string,
  thinking?: string,
): boolean {
  if (access.unrestricted) return true;
  return access.agentConfigurations.some(
    (grant) =>
      grant.providerId === provider &&
      (model === undefined
        ? grant.modelIds === "*"
        : grant.modelIds === "*" || grant.modelIds.includes(model)) &&
      (thinking === undefined
        ? grant.thinkingOptionIds === "*"
        : grant.thinkingOptionIds === "*" || grant.thinkingOptionIds.includes(thinking)),
  );
}
function allowsModel(access: ConfigurationAccess, model: ProviderModel): boolean {
  return (
    access.unrestricted ||
    access.agentConfigurations.some(
      (grant) =>
        grant.providerId === model.provider &&
        (grant.modelIds === "*" || grant.modelIds.includes(model.id)),
    )
  );
}
async function models(
  input: ConfigurationCommandInput,
  provider = input.config.provider,
): Promise<ProviderModel[]> {
  return (await input.daemon.listProviderModels(provider, input.config.cwd)).filter(
    (model) => model.isSelectable !== false,
  );
}
function currentModel(
  catalog: ProviderModel[],
  config: CreateAgentConfig,
): ProviderModel | undefined {
  return config.model
    ? catalog.find((model) => model.id === config.model || model.aliases?.includes(config.model!))
    : catalog.find((model) => model.isDefault);
}
async function configurationMenu(input: ConfigurationCommandInput, query: string): Promise<string> {
  const { command, daemon, config, access } = input;
  let options: string[];
  if (command.name === "provider") {
    options = (await daemon.listAvailableProviders())
      .filter(
        (provider) =>
          provider.available &&
          (access.unrestricted ||
            access.agentConfigurations.some((grant) => grant.providerId === provider.provider)),
      )
      .map((provider) => provider.provider);
  } else if (command.name === "agent") {
    options = [];
    for (const profile of await daemon.listAgentProfiles()) {
      const resolved = effectiveLiveConfiguration(input, await profileConfig(input, profile));
      if (
        (resolved.featureValues?.["fast_mode"] !== true || input.canUseFastMode === true) &&
        allows(access, resolved.provider, resolved.model, resolved.thinkingOptionId)
      )
        options.push(
          `${profile.id} (${profile.name}; ${resolved.provider}/${resolved.model ?? "default"})`,
        );
    }
  } else if (command.name === "permission") {
    options = (await daemon.listProviderModes(config.provider, config.cwd)).map(
      (mode) => `${mode.id} (${mode.label})`,
    );
  } else {
    const catalog = await models(input);
    options =
      command.name === "model"
        ? catalog
            .filter((model) => allowsModel(access, model))
            .map((model) => `${config.provider}/${model.id} (${model.label})`)
        : (currentModel(catalog, config)?.thinkingOptions ?? [])
            .filter((option) =>
              allows(access, config.provider, currentModel(catalog, config)?.id, option.id),
            )
            .map((option) => `${option.id} (${option.label})`);
  }
  return `Available ${command.name}: ${options.filter((option) => includesQuery(option, query)).join(", ") || "none"}.`;
}
async function providerDefaults(
  input: ConfigurationCommandInput,
  provider: string,
): Promise<CreateAgentConfig> {
  const catalog = await models(input, provider);
  const model = catalog.find((entry) => entry.isDefault);
  const modeId = AGENT_PROVIDER_DEFINITIONS.find((entry) => entry.id === provider)?.defaultModeId;
  const {
    model: _model,
    modeId: _mode,
    thinkingOptionId: _thinking,
    providerOptions: _options,
    featureValues: _features,
    ...base
  } = input.config;
  return {
    ...base,
    provider,
    ...(model ? { model: model.id } : {}),
    ...(model?.defaultThinkingOptionId ? { thinkingOptionId: model.defaultThinkingOptionId } : {}),
    ...(modeId ? { modeId } : {}),
  };
}
async function profileConfig(
  input: ConfigurationCommandInput,
  profile: AgentProfile,
): Promise<CreateAgentConfig> {
  const defaults =
    profile.provider === input.config.provider
      ? input.config
      : await providerDefaults(input, profile.provider);
  const next: CreateAgentConfig = {
    ...defaults,
    provider: profile.provider,
    ...(profile.model?.trim() ? { model: profile.model.trim() } : {}),
    ...(profile.modeId?.trim() ? { modeId: profile.modeId.trim() } : {}),
    ...(profile.thinkingOptionId?.trim()
      ? { thinkingOptionId: profile.thinkingOptionId.trim() }
      : {}),
    ...(defaults.featureValues || profile.featureValues
      ? { featureValues: { ...defaults.featureValues, ...profile.featureValues } }
      : {}),
  };
  if (profile.model && !profile.thinkingOptionId) {
    const selected = (await models(input, profile.provider)).find(
      (model) => model.id === profile.model,
    );
    delete next.thinkingOptionId;
    if (selected?.defaultThinkingOptionId) next.thinkingOptionId = selected.defaultThinkingOptionId;
  }
  return next;
}
async function resolveTarget(input: ConfigurationCommandInput): Promise<CreateAgentConfig> {
  const { command, daemon, config } = input;
  const value = command.value!.trim();
  if (command.name === "provider") {
    const provider = (await daemon.listAvailableProviders()).find(
      (entry) => entry.available && entry.provider.toLowerCase() === value.toLowerCase(),
    );
    if (!provider) throw new Error("Unknown or unavailable provider.");
    return provider.provider === config.provider
      ? config
      : providerDefaults(input, provider.provider);
  }
  if (command.name === "agent") {
    const matches = (await daemon.listAgentProfiles()).filter(
      (entry) =>
        entry.id.toLowerCase() === value.toLowerCase() ||
        entry.name.toLowerCase() === value.toLowerCase(),
    );
    if (matches.length !== 1)
      throw new Error("Unknown or ambiguous agent profile; use /agent list and select its id.");
    return profileConfig(input, matches[0]!);
  }
  if (command.name === "permission") return { ...config, modeId: value };
  const catalog = await models(input);
  if (command.name === "effort") return { ...config, thinkingOptionId: value };
  const qualified = value.startsWith(`${config.provider}/`)
    ? value.slice(config.provider.length + 1)
    : value;
  const matches = catalog.filter((entry) =>
    [entry.id, entry.label, ...(entry.aliases ?? [])].some(
      (name) => name.toLowerCase() === qualified.toLowerCase(),
    ),
  );
  if (matches.length !== 1)
    throw new Error(
      `Unknown or ambiguous model for ${config.provider}; use /model list. Switch provider with /provider first.`,
    );
  const { thinkingOptionId: _thinking, ...base } = config;
  const model = matches[0]!;
  return {
    ...base,
    model: model.id,
    ...(model.defaultThinkingOptionId ? { thinkingOptionId: model.defaultThinkingOptionId } : {}),
  };
}
/** Validate the final concrete bundle for every caller, including mint and resume. */
export async function validateAgentConfigurationAuthority(
  daemon: DaemonConnection,
  next: CreateAgentConfig,
  access: ConfigurationAccess,
  canSuppressApprovals: boolean,
  canUseFastMode = false,
): Promise<void> {
  await validatePermissionAndFeatureAuthority(daemon, next, canSuppressApprovals, canUseFastMode);
  const catalog = (await daemon.listProviderModels(next.provider, next.cwd)).filter(
    (entry) => entry.isSelectable !== false,
  );
  const model = currentModel(catalog, next);
  if (next.model !== undefined && model === undefined)
    throw new Error("The selected model is not available for this provider.");
  if (
    next.thinkingOptionId !== undefined &&
    !model?.thinkingOptions?.some((option) => option.id === next.thinkingOptionId)
  )
    throw new Error("The selected effort is not available for this model.");
  if (
    !allows(
      access,
      next.provider,
      model?.id,
      next.thinkingOptionId ?? model?.defaultThinkingOptionId,
    )
  )
    throw new Error("This configuration is outside your AgentConfigurationGrant.");
}

async function validatePermissionAndFeatureAuthority(
  daemon: DaemonConnection,
  config: CreateAgentConfig,
  canSuppressApprovals: boolean,
  canUseFastMode: boolean,
): Promise<void> {
  if (config.featureValues?.["fast_mode"] === true && !canUseFastMode)
    throw new Error("Fast mode requires agent.fast.use access.");
  const modes = await daemon.listProviderModes(config.provider, config.cwd);
  const provider = AGENT_PROVIDER_DEFINITIONS.find((entry) => entry.id === config.provider);
  const modeId = config.modeId ?? provider?.defaultModeId;
  if (config.modeId !== undefined && !modes.some((mode) => mode.id === config.modeId))
    throw new Error("Unknown permission mode for this provider.");
  const safe = isSafePermissionMode(
    config.provider,
    modeId,
    modes.find((mode) => mode.id === modeId),
  );
  const autoAccept =
    config.featureValues?.["auto_accept"] === true ||
    config.providerOptions?.["auto_approve"] === true;
  if ((!safe || autoAccept) && !canSuppressApprovals)
    throw new Error("This permission mode requires all approval privileges (approval.*).");
}

function isSafePermissionMode(
  providerId: string,
  modeId: string | null | undefined,
  mode: ProviderMode | undefined,
): boolean {
  if (mode?.isUnattended !== undefined) return !mode.isUnattended;
  const known = AGENT_PROVIDER_DEFINITIONS.find(
    (provider) => provider.id === providerId,
  )?.modes.find((candidate) => candidate.id === modeId);
  return known !== undefined && known.isUnattended !== true;
}

async function applyLive(input: ConfigurationCommandInput, next: CreateAgentConfig): Promise<void> {
  const { daemon, agentId, command } = input;
  if (command.name === "permission") return daemon.setAgentMode(agentId!, next.modeId!);
  if (command.name === "effort")
    return daemon.setAgentThinkingOption(agentId!, next.thinkingOptionId ?? null);
  if (command.name === "provider" && next.provider === input.config.provider) return;
  if (daemon.getServerInfo()?.features?.["agentConfigApply"] !== true)
    throw new Error("This daemon does not support applying an agent configuration live.");
  await daemon.applyAgentConfig(agentId!, {
    modelId: next.model ?? null,
    thinkingOptionId: next.thinkingOptionId ?? null,
    ...(next.modeId === undefined ? {} : { modeId: next.modeId }),
    ...(next.featureValues === undefined ? {} : { featureValues: next.featureValues }),
  });
}
function toSelection(config: CreateAgentConfig): ConfigurationSelection {
  return {
    selectedProvider: config.provider,
    selectedModel: config.model ?? null,
    selectedThinkingOption: config.thinkingOptionId ?? null,
    selectedMode: config.modeId ?? null,
    selectedFeatureValues: config.featureValues ?? null,
  };
}
