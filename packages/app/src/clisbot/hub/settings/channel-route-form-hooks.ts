import {
  isOpenAudienceDraft,
  type AudienceRuleDraft,
  type InheritedConditions,
} from "./channel-route-audience";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { type RouteApprovalChoice } from "./channel-route-form-sections";
import { type SelectFieldOption } from "@/components/ui/select-field";
import {
  DEFAULT_MEMBER_ROUTE_BEHAVIOR,
  inheritedRuleConditions,
  DEFAULT_OPEN_AUDIENCE_ROUTE_BEHAVIOR,
  type ChannelRouteBehavior,
  type ChannelRouteQuestions,
} from "../channel-configuration";
import {
  botLaunchChanged,
  routeBotKey,
  routeBotMatch,
  type RouteBotRequest,
} from "../channel-route-bot";
import { useRouteBotOptions } from "./channel-route-bot-options";
import { inheritedChannelRouteConversation } from "../channel-route-conversation";
import { inheritedChannelRouteToolActivity } from "../channel-route-tool-activity";
import { type ManagedAgentConfigurationValue } from "./managed-agent-configuration-fields";
import { selectedOptionDisplay } from "./channel-identity-form-parts";
import {
  EMPTY_RECORD,
  type HubAutomation,
  type HubConnection,
  type HubDaemon,
  type RecordValue,
  type RouteTarget,
} from "./channel-settings-types";
import {
  channelAccountKey,
  objectField,
  stringField,
  useChannelName,
} from "./channel-settings-records";
import { channelFormInitialState, onlyDaemonId } from "./channel-route-form-state";
import { type RouteDestination, routeDestinationOptions } from "./channel-route-destination";

/**
 * "Start or continue a Bot": the Bots on offer, the one picked, and what saving changes on the
 * Route being edited. A stored Route turns out to be a Bot's only once the Bots load, so the form
 * switches to it then, unless the user already picked a target.
 */
export function useRouteBotTarget(input: {
  daemons: HubDaemon[];
  initialBot: RouteBotRequest | null;
  editedRoute: RecordValue | undefined;
  editedEnvironment: RecordValue | null;
  /** The Route's named agent, before a Route default set from a conversation. */
  editedNamedAgent: RecordValue | null;
  targetChosen: RefObject<boolean>;
  setTarget: Dispatch<SetStateAction<RouteTarget>>;
}) {
  const { daemons, initialBot, editedRoute, editedEnvironment, editedNamedAgent } = input;
  const { targetChosen, setTarget } = input;
  const { options, loading } = useRouteBotOptions(daemons);
  const [key, setKey] = useState<string | null>(() =>
    initialBot === null ? null : routeBotKey(initialBot.serverId, initialBot.botId),
  );
  const stored = useMemo(
    () => routeBotMatch(editedRoute, editedEnvironment, options),
    [editedRoute, editedEnvironment, options],
  );
  const adopted = useRef(false);
  useEffect(() => {
    if (stored === null || adopted.current) return;
    adopted.current = true;
    if (!targetChosen.current) setTarget("bot");
    setKey((current) => current ?? stored.key);
  }, [setTarget, stored, targetChosen]);
  const selected = options.find((option) => option.key === key) ?? null;
  return {
    options,
    loading,
    offered: options.length > 0,
    selected,
    setKey,
    /** The Bot the stored Route runs: saved as an Agent, it drops its `workspace.organize`. */
    storedBot: stored,
    launchChanged:
      stored !== null && selected?.key === stored.key && botLaunchChanged(stored, editedNamedAgent),
    /** Saving a Bot target removes a Route default set from a conversation (`agentControls`). */
    replacesRouteDefault: editedRoute?.["agentControls"] !== undefined,
  };
}

type ChannelFormInitialState = ReturnType<typeof channelFormInitialState>;

/** False once the form unmounts, so a confirmation that resolves late saves nothing. */
export function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/**
 * The picked Connection: one that already has Routes (its account), or one
 * with none yet, which this Route gives its first.
 */
export function useRouteDestination(
  initialAccountKey: string | null,
  createdConnectionId: string | null,
  existingAccounts: RecordValue[],
) {
  const [destination, setDestinationState] = useState<RouteDestination | null>(() =>
    initialAccountKey === null ? null : { kind: "account", key: initialAccountKey },
  );
  const [accountIdDraft, setAccountId] = useState<string | null>(null);
  const setDestination = useCallback((next: RouteDestination | null) => {
    setDestinationState(next);
    setAccountId(null);
  }, []);
  // A new Connection's Route goes onto the account the Hub added with it; a Hub
  // that adds none leaves the Connection itself to build the account from. The
  // account can arrive a render after the Connection, so the pick moves to it
  // once; every pick happens once, so a later read never undoes the user's.
  const picked = useRef<string | null>(null);
  useEffect(() => {
    if (createdConnectionId === null) return;
    const account = existingAccounts.find(
      (candidate) => stringField(candidate, "connectionId") === createdConnectionId,
    );
    const next: RouteDestination =
      account === undefined
        ? { kind: "connection", id: createdConnectionId }
        : { kind: "account", key: channelAccountKey(account) };
    const mark = `${createdConnectionId}:${next.kind}`;
    if (picked.current === mark || picked.current === `${createdConnectionId}:account`) return;
    picked.current = mark;
    setDestination(next);
  }, [createdConnectionId, existingAccounts, setDestination]);
  return { destination, setDestination, accountIdDraft, setAccountId };
}

/** The Route's Rules, and the reply and permission behavior that follows who they let in. */
export function useRouteAudienceState(initial: ChannelFormInitialState) {
  const [audienceRules, setAudienceRulesState] = useState<AudienceRuleDraft[]>(
    initial.audienceRules,
  );
  const [behavior, setBehavior] = useState<ChannelRouteBehavior>(initial.behavior.behavior);
  const [approvalChoice, setApprovalChoice] = useState<RouteApprovalChoice>(
    initial.behavior.approvalChoice,
  );
  const open = isOpenAudienceDraft(audienceRules);
  const replyPlaces = useMemo(
    () => ({
      dms: audienceRules.some(({ place }) => place === "dm"),
      groups: audienceRules.some(({ place }) => place === "groups"),
    }),
    [audienceRules],
  );
  // Opening the Route to Anyone (or closing it again) starts from that
  // audience's behavior; everything stays editable afterwards.
  const setAudienceRules = useCallback<Dispatch<SetStateAction<AudienceRuleDraft[]>>>(
    (update) => {
      const next = typeof update === "function" ? update(audienceRules) : update;
      setAudienceRulesState(next);
      const nextOpen = isOpenAudienceDraft(next);
      if (nextOpen === open) return;
      const defaults = nextOpen
        ? DEFAULT_OPEN_AUDIENCE_ROUTE_BEHAVIOR
        : DEFAULT_MEMBER_ROUTE_BEHAVIOR;
      setBehavior(defaults);
      setApprovalChoice(defaults.approvalMode ?? "custom");
    },
    [audienceRules, open],
  );
  return {
    audienceRules,
    setAudienceRules,
    open,
    replyPlaces,
    behavior,
    setBehavior,
    approvalChoice,
    setApprovalChoice,
  };
}

/** The Replies and permission fields' edits to the Route's behavior. */
export function useRouteBehaviorChanges(
  setBehavior: Dispatch<SetStateAction<ChannelRouteBehavior>>,
  setApprovalChoice: Dispatch<SetStateAction<RouteApprovalChoice>>,
) {
  const changeReplyThread = useCallback(
    (thread: boolean) =>
      setBehavior((current) => ({
        ...current,
        replyAnchor: thread ? "thread" : "default",
      })),
    [setBehavior],
  );
  const changeDmReplyThread = useCallback(
    (thread: boolean) =>
      setBehavior((current) => ({ ...current, dmReplyAnchor: thread ? "thread" : "default" })),
    [setBehavior],
  );
  const changeOutboundPath = useCallback(
    (value: string) =>
      setBehavior((current) => ({
        ...current,
        outboundPath: value as ChannelRouteBehavior["outboundPath"],
        outboundPathInherited: false,
      })),
    [setBehavior],
  );
  const changeFinalAnswers = useCallback(
    (finalAnswers: boolean) => setBehavior((current) => ({ ...current, finalAnswers })),
    [setBehavior],
  );
  const changeProgressMessage = useCallback(
    (progressMessage: boolean) => setBehavior((current) => ({ ...current, progressMessage })),
    [setBehavior],
  );
  const changeTypingIndicator = useCallback(
    (typingIndicator: boolean) => setBehavior((current) => ({ ...current, typingIndicator })),
    [setBehavior],
  );
  const changeApprovalChoice = useCallback(
    (value: string) => setApprovalChoice(value as RouteApprovalChoice),
    [setApprovalChoice],
  );
  const changeQuestions = useCallback(
    (value: string) =>
      setBehavior((current) => ({ ...current, questions: value as ChannelRouteQuestions })),
    [setBehavior],
  );
  return {
    changeReplyThread,
    changeDmReplyThread,
    changeOutboundPath,
    changeFinalAnswers,
    changeProgressMessage,
    changeTypingIndicator,
    changeApprovalChoice,
    changeQuestions,
  };
}

/** Where a direct Agent runs and how: its Host, Project, folder, workspace and provider. */
export function useRouteAgentTarget(
  initial: ChannelFormInitialState,
  daemons: readonly HubDaemon[],
) {
  // A new Route on a Hub with one Host runs there: pick it, as the user would,
  // so its Projects and providers load at once.
  const [daemonId, setDaemonId] = useState<string | null>(
    () => initial.daemonId ?? (initial.isEditing ? null : onlyDaemonId(daemons)),
  );
  const [projectId, setProjectId] = useState<string | null>(initial.projectId);
  const [cwd, setCwd] = useState(initial.cwd);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [agentConfiguration, setAgentConfiguration] = useState<ManagedAgentConfigurationValue>(
    initial.agentConfiguration,
  );
  const [providerOptions, setProviderOptions] = useState(initial.providerOptions);
  const changeDaemon = useCallback((value: string | null) => {
    setDaemonId(value);
    setProjectId(null);
    setCwd("");
  }, []);
  return {
    daemonId,
    changeDaemon,
    projectId,
    setProjectId,
    cwd,
    setCwd,
    workspace,
    setWorkspace,
    agentConfiguration,
    setAgentConfiguration,
    providerOptions,
    setProviderOptions,
  };
}

/** Create Automation beside the Automation picker: its form, and picking what it creates. */
export function useRouteAutomationCreator({
  createRouteAutomation,
  selectedConnection,
  setAutomationName,
  setTarget,
}: {
  createRouteAutomation(yaml: string): Promise<string>;
  selectedConnection: { id: string; provider: string } | undefined;
  setAutomationName(name: string | null): void;
  setTarget(target: RouteTarget): void;
}) {
  const [showAutomationCreator, setShowAutomationCreator] = useState(false);
  const [automationCreatePending, setAutomationCreatePending] = useState(false);
  const [automationCreateError, setAutomationCreateError] = useState<string | null>(null);
  const showAutomationForm = useCallback(() => {
    if (selectedConnection === undefined) {
      setAutomationCreateError("Choose a Connection before creating its Automation.");
      return;
    }
    setAutomationCreateError(null);
    setShowAutomationCreator(true);
  }, [selectedConnection]);
  const cancelAutomationCreate = useCallback(() => {
    setShowAutomationCreator(false);
    setAutomationCreateError(null);
  }, []);
  const saveAutomation = useCallback(
    async (yaml: string) => {
      setAutomationCreatePending(true);
      setAutomationCreateError(null);
      try {
        const createdName = await createRouteAutomation(yaml);
        setAutomationName(createdName);
        setTarget("automation");
        setShowAutomationCreator(false);
      } catch (error) {
        setAutomationCreateError(
          error instanceof Error ? error.message : "Automation could not be created.",
        );
      } finally {
        setAutomationCreatePending(false);
      }
    },
    [createRouteAutomation, setAutomationName, setTarget],
  );
  return {
    showAutomationCreator,
    automationCreatePending,
    automationCreateError,
    showAutomationForm,
    cancelAutomationCreate,
    saveAutomation,
  };
}

/** What a Route inherits: the organization's `defaults:`, then its Connection's. */
export function useRouteInheritedDefaults(
  policy: RecordValue,
  selectedAccount: RecordValue | undefined,
) {
  const inheritedConversation = useMemo(
    () =>
      inheritedChannelRouteConversation([
        objectField(policy, "defaults") ?? undefined,
        objectField(selectedAccount ?? EMPTY_RECORD, "defaults") ?? undefined,
      ]),
    [policy, selectedAccount],
  );
  const inheritedToolActivity = useMemo(
    () =>
      inheritedChannelRouteToolActivity([
        objectField(policy, "defaults") ?? undefined,
        objectField(selectedAccount ?? EMPTY_RECORD, "defaults") ?? undefined,
      ]),
    [policy, selectedAccount],
  );
  const inheritedConditions = useMemo<InheritedConditions>(
    () =>
      inheritedRuleConditions([
        objectField(policy, "defaults") ?? undefined,
        objectField(selectedAccount ?? EMPTY_RECORD, "defaults") ?? undefined,
      ]),
    [policy, selectedAccount],
  );
  return { inheritedConversation, inheritedToolActivity, inheritedConditions };
}

/** The Route form's pickers: the Connections, Hosts and Automations on offer, and the picked one's display. */
export function useRouteFormOptions(input: {
  existingAccounts: RecordValue[];
  connections: HubConnection[];
  adminScoped: boolean;
  provider: string | undefined;
  daemons: HubDaemon[];
  automations: HubAutomation[];
  destinationValue: string | null;
  automationName: string | null;
  daemonId: string | null;
}) {
  const { existingAccounts, connections, adminScoped, provider, daemons, automations } = input;
  const { destinationValue, automationName, daemonId } = input;
  const channelName = useChannelName();
  const destinationOptions = useMemo(
    () =>
      routeDestinationOptions(existingAccounts, connections, adminScoped, channelName, provider),
    [adminScoped, channelName, connections, existingAccounts, provider],
  );
  const daemonOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      daemons.map((daemon) => ({
        id: daemon.id,
        value: daemon.id,
        label: daemon.slug,
      })),
    [daemons],
  );
  const automationOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      automations.map((automation) => ({
        id: automation.id,
        value: automation.name,
        label: automation.name,
      })),
    [automations],
  );
  const destinationDisplay = useMemo(
    () => selectedOptionDisplay(destinationOptions, destinationValue),
    [destinationOptions, destinationValue],
  );
  const automationDisplay = useMemo(
    () => selectedOptionDisplay(automationOptions, automationName),
    [automationName, automationOptions],
  );
  const daemonDisplay = useMemo(
    () => selectedOptionDisplay(daemonOptions, daemonId),
    [daemonId, daemonOptions],
  );
  const automationNames = useMemo(() => automations.map(({ name }) => name), [automations]);
  return {
    channelName,
    destinationOptions,
    destinationDisplay,
    daemonOptions,
    daemonDisplay,
    automationOptions,
    automationDisplay,
    automationNames,
  };
}
