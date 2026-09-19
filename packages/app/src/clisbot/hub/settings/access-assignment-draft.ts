import { useCallback, useState } from "react";
import { accessConstraintDraft } from "./access-assignment-edit";
import { subjectKey, type AccessAssignment } from "./access-catalog";
import { CAN_SHARE_PRIVILEGE } from "./access-grantor";
import { confirmAdministratorLevel } from "./access-level-choice";
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
) {
  const [initial] = useState(() =>
    initialAssignmentDraft(editing, initialSubject, initialResource),
  );
  const [subjectKeyValue, setSubjectKeyValue] = useState(initial.subject);
  const [resourceKeyValue, setResourceKeyValue] = useState(initial.resource);
  const [alsoResourceKeys, setAlsoResourceKeys] = useState<readonly string[]>([]);
  const [accessLevel, setAccessLevel] = useState(initial.accessLevel);
  const [canShare, setCanShare] = useState(initial.canShare);
  const [agentConfigurations, setAgentConfigurations] = useState<AgentConfigurationDraft[]>(
    initial.agentConfigurations,
  );
  const [fastMode, setFastMode] = useState(initial.fastMode);
  const changeResource = useCallback((value: string) => {
    setResourceKeyValue(value);
    setAlsoResourceKeys([]);
    setAccessLevel(null);
    setCanShare(false);
    setFastMode(false);
    setAgentConfigurations([createAgentConfigurationDraft()]);
  }, []);
  // Administrator is confirmed before it is even selected; cancelling keeps the previous level.
  const changeLevel = useCallback(
    (value: string) =>
      void (async () => {
        if (value === "administrator" && !(await confirmAdministratorLevel())) return;
        if (isCurrent()) setAccessLevel(value);
      })(),
    [isCurrent],
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
    agentConfigurations,
    setAgentConfigurations,
    addAgentConfiguration,
    fastMode,
    setFastMode,
  };
}
