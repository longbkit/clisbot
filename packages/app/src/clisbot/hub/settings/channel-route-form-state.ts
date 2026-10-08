import { i18n } from "@/i18n/i18next";
import {
  newAudienceRule,
  routeAudienceDraft,
  type AudienceRuleDraft,
} from "./channel-route-audience";
import {
  buildChannelAccountCandidate,
  buildChannelRouteCandidate,
  CHANNEL_LIMIT_NAMES,
  insertChannelRoute,
  replaceChannelRouteCandidate,
  type ChannelLimitName,
} from "../channel-configuration";
import { routeEffectiveAgent, type ChannelRouteTarget } from "../channel-route-target";
import { botRouteTarget, type RouteBotOption } from "../channel-route-bot";
import {
  ROUTE_TOTAL_LIMIT_NAMES,
  channelLimitsDraft,
  limitsAuthored,
  parseChannelLimitsDraft,
  type ChannelLimitsDraft,
} from "./channel-limits-draft";
import { type ManagedAgentConfigurationValue } from "./managed-agent-configuration-fields";
import {
  workspaceConfigurationFromTarget,
  worktreeTargetFromConfiguration,
} from "../workspace-configuration";
import {
  type ConfigurationKind,
  EMPTY_RECORD,
  type EditingRoute,
  type HubDaemon,
  type RecordValue,
  type RouteTarget,
} from "./channel-settings-types";
import {
  arrayField,
  channelAccountKey,
  objectField,
  stringField,
} from "./channel-settings-records";
import { routeBehaviorDraft } from "./channel-route-behavior-draft";

/** The Route's totals, then any other limit already set on it. */
export function routeLimitFields(draft: ChannelLimitsDraft): readonly ChannelLimitName[] {
  const legacy = CHANNEL_LIMIT_NAMES.filter(
    (name) => !ROUTE_TOTAL_LIMIT_NAMES.includes(name) && limitsAuthored(draft, [name]),
  );
  return [...ROUTE_TOTAL_LIMIT_NAMES, ...legacy];
}
/**
 * The accounts and resource a save writes: the edited Route replaced in place, a Connection's first Route (a new account) appended, or a Route inserted into
 * the selected account. Null when the form has nothing to write to.
 */
export function nextConfiguration(input: {
  routeInput: Parameters<typeof buildChannelRouteCandidate>[0];
  existingAccounts: RecordValue[];
  editing: EditingRoute | null;
  editedRoute: RecordValue | undefined;
  configurationKind: ConfigurationKind;
  selectedConnection: { id: string; provider: string } | undefined;
  selectedAccount: RecordValue | undefined;
}): {
  nextAccounts: RecordValue[];
  nextResource: RecordValue;
  nextRoute: RecordValue;
  createdAccountKey?: string;
} | null {
  const { routeInput, existingAccounts, editing, editedRoute } = input;
  if (editing !== null) {
    if (editedRoute === undefined) return null;
    const candidate = replaceChannelRouteCandidate({
      ...routeInput,
      currentRoute: editedRoute,
      accounts: existingAccounts,
    });
    const nextAccounts = existingAccounts.map((account) => {
      if (channelAccountKey(account) !== editing.accountKey) return account;
      return {
        ...account,
        routes: arrayField(account, "routes").map((route, index) =>
          index === editing.routeIndex ? candidate.route : route,
        ),
      };
    });
    return { nextAccounts, nextResource: candidate.resource, nextRoute: candidate.route };
  }
  if (input.configurationKind === "account") {
    if (input.selectedConnection === undefined) return null;
    const candidate = buildChannelAccountCandidate({
      ...routeInput,
      connection: input.selectedConnection,
    });
    return {
      nextAccounts: [...existingAccounts, candidate.account],
      nextResource: candidate.resource,
      nextRoute: arrayField(candidate.account, "routes")[0] as RecordValue,
      createdAccountKey: channelAccountKey(candidate.account),
    };
  }
  const { selectedAccount } = input;
  if (selectedAccount === undefined) return null;
  const candidate = buildChannelRouteCandidate(routeInput);
  const nextAccounts = existingAccounts.map((account) =>
    account === selectedAccount
      ? Object.assign({}, account, {
          routes: insertChannelRoute(
            arrayField(account, "routes") as RecordValue[],
            candidate.route,
          ),
        })
      : account,
  );
  return { nextAccounts, nextResource: candidate.resource, nextRoute: candidate.route };
}

/** The Route whose target a Connection Admin's save keeps; null when the form builds one. */
export function adminExistingTarget(
  adminScoped: boolean,
  editedRoute: RecordValue | undefined,
  selectedAccount: RecordValue | undefined,
  existingTargetIndex: string | null,
): RecordValue | null {
  if (!adminScoped) return null;
  if (editedRoute !== undefined) return editedRoute;
  if (existingTargetIndex === null) return null;
  const routes = arrayField(selectedAccount ?? EMPTY_RECORD, "routes") as RecordValue[];
  return routes[Number(existingTargetIndex)] ?? null;
}

export function onlyDaemonId(daemons: readonly HubDaemon[]): string | null {
  return daemons.length === 1 ? daemons[0]!.id : null;
}

export function daemonServerId(daemons: HubDaemon[], daemonId: string | null): string | null {
  return daemons.find((daemon) => daemon.id === daemonId)?.connectionOffer?.serverId ?? null;
}

/** True when the provider already has a Connection with this name. */
export function isDuplicateChannelAccount(
  existingAccounts: RecordValue[],
  connection: { provider: string } | undefined,
  accountId: string,
): boolean {
  if (connection === undefined) return false;
  return existingAccounts.some(
    (account) =>
      stringField(account, "channel") === connection.provider &&
      stringField(account, "accountId") === accountId.trim(),
  );
}

/** The channels whose Automation reply inputs this app can edit. Narrower than
 * the Hub's supported set on purpose: the reply-input editors are per-provider
 * (`automation-configuration.ts`), so a channel without one has no editor to
 * open. */
export function channelReplyProviderName(value: string | null): "slack" | "telegram" | null {
  return value === "slack" || value === "telegram" ? value : null;
}

export function channelFormInitialState(
  accounts: RecordValue[],
  editing: EditingRoute | null,
  resource: RecordValue,
) {
  const { editedAccount, editedRoute } = findEditedRoute(accounts, editing);
  const route = editedRoute ?? EMPTY_RECORD;
  const audience = initialAudience(editedRoute);
  const editedLimits = objectField(route, "limits") ?? EMPTY_RECORD;
  const editedWorkflow = stringField(editedRoute, "workflow");
  const editedAgentName = stringField(editedRoute, "agent") ?? "";
  const editedEnvironmentName = stringField(editedRoute, "environment") ?? "";
  // What the Route really starts: a `/promoteroutedefault` layer
  // (`agentControls`) over the named agent, so the form shows what runs.
  const editedNamedAgent = objectField(
    objectField(resource, "agents") ?? EMPTY_RECORD,
    editedAgentName,
  );
  const editedAgent = routeEffectiveAgent(editedNamedAgent, editedRoute);
  const editedEnvironment = objectField(
    objectField(resource, "environments") ?? EMPTY_RECORD,
    editedEnvironmentName,
  );
  const isEditing = editing !== null && editedAccount !== undefined && editedRoute !== undefined;
  const environment = managedEnvironmentConfiguration(editedEnvironment);
  return {
    editedAccount,
    editedRoute,
    editedWorkflow,
    isEditing,
    accountKey: editing?.accountKey ?? null,
    audienceRules: audience,
    behavior: routeBehaviorDraft(editedRoute),
    routeLimits: channelLimitsDraft(editedLimits),
    routeLimitsAuthored: Object.keys(editedLimits).length > 0,
    ...environment,
    editedEnvironment,
    editedNamedAgent,
    agentConfiguration: managedAgentConfiguration(editedAgent),
    providerOptions: formatOptionalObject(objectField(editedAgent ?? EMPTY_RECORD, "options")),
  };
}

/** The Rules the form opens with: the stored ones, or the Hub's owners in DMs for a new Route. */
function initialAudience(editedRoute: RecordValue | undefined): AudienceRuleDraft[] {
  if (editedRoute === undefined) return [newAudienceRule()];
  return routeAudienceDraft(editedRoute);
}

function managedEnvironmentConfiguration(environment: RecordValue | null) {
  const record = environment ?? EMPTY_RECORD;
  return {
    daemonId: stringField(record, "daemon"),
    projectId: stringField(record, "projectId"),
    cwd: stringField(record, "cwd") ?? "",
    workspace: workspaceConfigurationFromTarget(record["worktree"]),
  };
}

/** The account and Route being edited. */
function findEditedRoute(accounts: RecordValue[], editing: EditingRoute | null) {
  if (editing === null) return { editedAccount: undefined, editedRoute: undefined };
  const editedAccount = accounts.find(
    (account) => channelAccountKey(account) === editing.accountKey,
  );
  const editedRoute = arrayField(editedAccount ?? EMPTY_RECORD, "routes")[editing.routeIndex] as
    | RecordValue
    | undefined;
  return { editedAccount, editedRoute };
}

function managedAgentConfiguration(agent: RecordValue | null): ManagedAgentConfigurationValue {
  const record = agent ?? EMPTY_RECORD;
  return {
    provider: stringField(record, "provider") ?? "",
    model: stringField(record, "model") ?? "",
    mode: stringField(record, "mode") ?? "",
    thinkingOptionId: stringField(record, "thinkingOptionId") ?? "",
    featureValues: objectField(record, "featureValues") ?? EMPTY_RECORD,
  };
}

/** What keeps the Route form from saving, said as the next step; null when it can. */
/**
 * A Connection's first Route also names its account, unless the connect step in this form
 * named it already; and a Connection added here is picked before the list holds it.
 */
export function routeConnectionStep(input: {
  configurationKind: ConfigurationKind;
  connectionId: string | null;
  selectedConnection: { id: string } | undefined;
  namedConnectionId: string | null;
}): { namesAccount: boolean; connectionLoading: boolean } {
  const firstRoute = input.configurationKind === "account";
  return {
    namesAccount: firstRoute && input.connectionId !== input.namedConnectionId,
    connectionLoading:
      firstRoute && input.connectionId !== null && input.selectedConnection === undefined,
  };
}

export function routeSaveBlocker(input: {
  conversationValid: boolean;
  toolActivityValid: boolean;
  selectedConnection: { id: string } | undefined;
  /** A Connection is picked but not in the list yet: one just added in this form. */
  connectionLoading: boolean;
  effectiveAccountId: string;
  configurationKind: ConfigurationKind;
  selectedAccount: RecordValue | undefined;
  audienceComplete: boolean;
  parsedRouteLimits: ReturnType<typeof parseChannelLimitsDraft>;
  /** The target the Route keeps (a Connection Admin's edit), or null when the form builds one. */
  existingTarget: RecordValue | null;
  target: RouteTarget;
  automationName: string | null;
  bot: RouteBotOption | null;
  daemonId: string | null;
  projectId: string | null;
  cwd: string;
  workspaceValid: boolean;
  provider: string;
  providerOptionsValid: boolean;
}): string | null {
  if (input.connectionLoading) return i18n.t("hub.routes.saveBlockers.loadingConnection");
  if (input.effectiveAccountId.length === 0)
    return i18n.t("hub.routes.saveBlockers.nameConnection");
  if (input.configurationKind === "route" && input.selectedAccount === undefined)
    return i18n.t("hub.routes.saveBlockers.chooseConnection");
  if (input.configurationKind === "account" && input.selectedConnection === undefined)
    return i18n.t("hub.routes.saveBlockers.chooseConnection");
  if (!input.parsedRouteLimits.valid) return input.parsedRouteLimits.error;
  if (!input.audienceComplete) return i18n.t("hub.routes.saveBlockers.finishRules");
  if (!input.conversationValid || !input.toolActivityValid)
    return i18n.t("hub.routes.saveBlockers.fixFields");
  if (input.existingTarget !== null) return null;
  if (input.target === "automation")
    return input.automationName === null
      ? i18n.t("hub.routes.saveBlockers.chooseAutomation")
      : null;
  if (input.target === "bot")
    return input.bot === null ? i18n.t("hub.routes.saveBlockers.chooseBot") : null;
  return agentTargetBlocker(input);
}

/** What an Agent target still needs, in the order the form asks for it. */
function agentTargetBlocker(input: {
  daemonId: string | null;
  projectId: string | null;
  cwd: string;
  workspaceValid: boolean;
  provider: string;
  providerOptionsValid: boolean;
}): string | null {
  if (input.daemonId === null) return i18n.t("hub.routes.saveBlockers.chooseHost");
  if (input.projectId === null) return i18n.t("hub.routes.saveBlockers.chooseProject");
  if (input.cwd.trim().length === 0) return i18n.t("hub.routes.saveBlockers.chooseFolder");
  if (!input.workspaceValid) return i18n.t("hub.routes.saveBlockers.fixWorkspace");
  if (input.provider.trim().length === 0) return i18n.t("hub.routes.saveBlockers.chooseProvider");
  return input.providerOptionsValid ? null : i18n.t("hub.routes.saveBlockers.fixProviderOptions");
}

/** The Route keeps its target when the form was not allowed to rebuild one. */
export function formRouteTarget(
  existingTarget: RecordValue | null,
  form: Parameters<typeof buildRouteTarget>[0],
): ChannelRouteTarget | null {
  if (existingTarget !== null) return { kind: "existing", route: existingTarget };
  return buildRouteTarget(form);
}

function buildRouteTarget(input: {
  target: RouteTarget;
  automationName: string | null;
  bot: RouteBotOption | null;
  /** The stored Route ran a Bot: as an Agent's it stops keeping sessions in place. */
  leavesBot: boolean;
  daemonId: string | null;
  projectId: string | null;
  cwd: string;
  worktree: ReturnType<typeof worktreeTargetFromConfiguration>;
  agentConfiguration: ManagedAgentConfigurationValue;
  parsedProviderOptions: ReturnType<typeof parseOptionalObject>;
}): ChannelRouteTarget | null {
  if (input.target === "automation") {
    if (input.automationName === null) return null;
    return { kind: "automation", automationName: input.automationName };
  }
  if (input.target === "bot") return input.bot === null ? null : botRouteTarget(input.bot);
  if (input.daemonId === null || input.projectId === null || !input.parsedProviderOptions.valid) {
    return null;
  }
  const target: Extract<ChannelRouteTarget, { kind: "agent" }> = {
    kind: "agent",
    daemonId: input.daemonId,
    projectId: input.projectId,
    cwd: input.cwd,
    provider: input.agentConfiguration.provider,
    model: input.agentConfiguration.model,
    mode: input.agentConfiguration.mode,
    thinkingOptionId: input.agentConfiguration.thinkingOptionId,
  };
  if (input.worktree !== undefined) target.worktree = input.worktree;
  if (input.leavesBot) target.workspaceOrganize = "inherit";
  if (Object.keys(input.agentConfiguration.featureValues).length > 0) {
    target.featureValues = input.agentConfiguration.featureValues;
  }
  if (input.parsedProviderOptions.value !== undefined) {
    target.options = input.parsedProviderOptions.value;
  }
  return target;
}

export function parseOptionalObject(
  value: string,
): { valid: true; value?: Record<string, unknown> } | { valid: false } {
  if (value.trim().length === 0) return { valid: true };
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? { valid: true, value: parsed as Record<string, unknown> }
      : { valid: false };
  } catch {
    return { valid: false };
  }
}

function formatOptionalObject(value: RecordValue | null): string {
  return value === null || Object.keys(value).length === 0 ? "" : JSON.stringify(value, null, 2);
}
