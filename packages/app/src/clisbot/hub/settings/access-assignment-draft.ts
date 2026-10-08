import { useCallback, useState } from "react";
import { accessConstraintDraft } from "./access-assignment-edit";
import { subjectKey, type AccessAssignment, type AccessCatalog } from "./access-catalog";
import { CAN_SHARE_PRIVILEGE } from "./access-grantor";
import {
  confirmAdministratorLevel,
  levelSwitchPresets,
  SCHEDULE_PRIVILEGE,
} from "./access-level-choice";
import {
  agentConfigurationDraftFrom,
  createAgentConfigurationDraft,
  type AgentConfigurationDraft,
} from "./agent-configuration-grant-fields";
import type { MultiSelection } from "./multi-select-field";

function initialAssignmentDraft(
  editing: AccessAssignment | null,
  initialSubject: string | null,
  initialResource: string | null,
) {
  const constraints = accessConstraintDraft(editing?.constraints ?? {});
  return {
    constraints,
    subject: editing ? subjectKey(editing.subjectKind, editing.subjectId) : initialSubject,
    resource: editing ? `${editing.resourceKind}\0${editing.resourceId}` : initialResource,
    accessLevel: editing ? "current" : null,
    canShare: editing?.privileges.includes(CAN_SHARE_PRIVILEGE) ?? false,
    terminal: editing?.privileges.includes("terminal.use") ?? false,
    // A row saved before Schedules existed starts off; re-selecting its level turns it on.
    schedules: editing?.privileges.includes(SCHEDULE_PRIVILEGE) ?? false,
    // A new grant has no choice yet; the form offers the grantor's default.
    terminalProfiles: editing ? (constraints.terminalProfiles as MultiSelection) : null,
    projectFolders: constraints.projectFolders,
    fastMode: editing?.privileges.includes("agent.fast.use") ?? false,
    agentConfigurations:
      constraints.agentConfigurations.length > 0
        ? constraints.agentConfigurations.map(agentConfigurationDraftFrom)
        : [createAgentConfigurationDraft()],
  };
}

/** The grant form's values, seeded once per mount from the row being edited. */
export function useAccessAssignmentDraft(
  editing: AccessAssignment | null,
  initialSubject: string | null,
  initialResource: string | null,
  isCurrent: () => boolean,
  accessLevels: AccessCatalog["accessLevels"],
) {
  const [initial] = useState(() =>
    initialAssignmentDraft(editing, initialSubject, initialResource),
  );
  const [subjectKeyValue, setSubjectKeyValue] = useState(initial.subject);
  const [resourceKeyValue, setResourceKeyValue] = useState(initial.resource);
  const [alsoResourceKeys, setAlsoResourceKeys] = useState<readonly string[]>([]);
  const [accessLevel, setAccessLevel] = useState(initial.accessLevel);
  const [canShare, setCanShare] = useState(initial.canShare);
  const [terminal, setTerminal] = useState(initial.terminal);
  const [schedules, setSchedules] = useState(initial.schedules);
  const [terminalProfiles, setTerminalProfiles] = useState<MultiSelection | null>(
    initial.terminalProfiles,
  );
  const [projectFolders, setProjectFolders] = useState(initial.projectFolders);
  const [agentConfigurations, setAgentConfigurations] = useState<AgentConfigurationDraft[]>(
    initial.agentConfigurations,
  );
  const [fastMode, setFastMode] = useState(initial.fastMode);
  const changeResource = useCallback((value: string) => {
    setResourceKeyValue(value);
    setAlsoResourceKeys([]);
    setAccessLevel(null);
    setCanShare(false);
    setTerminal(false);
    setSchedules(false);
    setTerminalProfiles(null);
    setProjectFolders(null);
    setFastMode(false);
    setAgentConfigurations([createAgentConfigurationDraft()]);
  }, []);
  // Administrator is confirmed before it is even selected; cancelling keeps the previous level.
  const changeLevel = useCallback(
    (value: string) =>
      void (async () => {
        if (value === "administrator" && !(await confirmAdministratorLevel())) return;
        if (!isCurrent()) return;
        setAccessLevel(value);
        // A level starts its switches where it names them: Full access shares and has the shell.
        const kind = resourceKeyValue?.split("\0")[0] ?? "";
        const presets = levelSwitchPresets(accessLevels[kind]?.[value] ?? []);
        setCanShare(presets.canShare);
        setTerminal(presets.terminal);
        setSchedules(presets.schedules);
      })(),
    [accessLevels, isCurrent, resourceKeyValue],
  );
  // The field offers no "all" option here, so it only ever reports exact ids.
  const changeAlsoResources = useCallback(
    (value: MultiSelection) => setAlsoResourceKeys(value === "*" ? [] : value),
    [],
  );
  const addAgentConfiguration = useCallback(
    () => setAgentConfigurations((current) => [...current, createAgentConfigurationDraft()]),
    [],
  );
  return {
    constraintsValid: initial.constraints.valid,
    subjectKeyValue,
    setSubjectKeyValue,
    resourceKeyValue,
    changeResource,
    alsoResourceKeys,
    changeAlsoResources,
    accessLevel,
    changeLevel,
    canShare,
    setCanShare,
    terminal,
    setTerminal,
    schedules,
    setSchedules,
    terminalProfiles,
    setTerminalProfiles,
    projectFolders,
    setProjectFolders,
    agentConfigurations,
    setAgentConfigurations,
    addAgentConfiguration,
    fastMode,
    setFastMode,
  };
}
