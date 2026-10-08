import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useFetchQuery } from "@/data/query";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { HubAccessAssignmentsSchema, HubMembersSchema } from "../contracts";
import { hubResourceQueryKey } from "../query-keys";
import {
  automationRunWarning,
  automationScopeLabel,
  type HubAutomationScope,
  type HubScopedAutomation,
} from "./automation-access";
import {
  assignmentScope,
  automationAssignments,
  grantAutomationAccess,
  grantErrorMessage,
  removeAutomationAccess,
  type HubAccessAssignment,
} from "./automation-access-grant";

/** Who may run or administer this Automation, with the Run warning beside the grant. */
export function AutomationAccessSection({ automation }: { automation: HubScopedAutomation }) {
  const { t } = useTranslation();
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const accountId = hub.signedIn?.account.id ?? null;
  const scope = { origin: hub.origin, organizationId, accountId };
  const assignments = useFetchQuery({
    queryKey: [
      ...hubResourceQueryKey(scope, "access-assignments"),
      automation.id,
      "automation-access",
    ],
    queryFn: () => hub.api().get("access-assignments", HubAccessAssignmentsSchema),
    enabled: organizationId.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const members = useFetchQuery({
    queryKey: hubResourceQueryKey(scope, "members"),
    queryFn: () => hub.api().get("members", HubMembersSchema),
    enabled: organizationId.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const rows = automationAssignments(assignments.data?.assignments, automation.id);
  const memberName = useCallback(
    (membershipId: string) =>
      members.data?.members.find(({ id }) => id === membershipId)?.name ?? membershipId,
    [members.data?.members],
  );
  const mutate = useCallback(
    async (action: () => Promise<unknown>) => {
      setPending(true);
      setError(null);
      try {
        await action();
        await assignments.refetch();
      } catch (cause) {
        setError(grantErrorMessage(cause));
      } finally {
        setPending(false);
      }
    },
    [assignments],
  );
  const grant = useCallback(
    (membershipId: string, level: HubAutomationScope) =>
      mutate(() => grantAutomationAccess(hub.api(), automation.id, membershipId, level)),
    [automation.id, hub, mutate],
  );
  const remove = useCallback(
    (assignmentId: string) => mutate(() => removeAutomationAccess(hub.api(), assignmentId)),
    [hub, mutate],
  );
  const granted = new Set(rows.map(({ subjectId }) => subjectId));
  const candidates = (members.data?.members ?? []).filter(({ id }) => !granted.has(id));
  return (
    <SettingsSection title={t("hub.automations.access.title")}>
      <Alert variant="warning" title={automationRunWarning(automation)} />
      {error ? <Alert variant="error" title={error} /> : null}
      <View style={settingsStyles.card}>
        {rows.length === 0 ? (
          <Text style={settingsStyles.rowHint}>{t("hub.automations.access.noOne")}</Text>
        ) : (
          rows.map((row, index) => (
            <AssignmentRow
              key={row.id}
              row={row}
              name={memberName(row.subjectId)}
              border={index > 0}
              pending={pending}
              remove={remove}
            />
          ))
        )}
      </View>
      <GrantForm candidates={candidates} pending={pending} grant={grant} />
    </SettingsSection>
  );
}

function AssignmentRow({
  row,
  name,
  border,
  pending,
  remove,
}: {
  row: HubAccessAssignment;
  name: string;
  border: boolean;
  pending: boolean;
  remove(assignmentId: string): void;
}) {
  const { t } = useTranslation();
  const removeRow = useCallback(() => remove(row.id), [remove, row.id]);
  const scope = automationScopeLabel(assignmentScope(row));
  return (
    <View style={[settingsStyles.row, border ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{name}</Text>
        <Text style={settingsStyles.rowHint}>
          {row.subjectKind === "team" ? t("hub.automations.access.teamScope", { scope }) : scope}
        </Text>
      </View>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        accessibilityLabel={t("hub.automations.access.removeName", { name })}
        onPress={removeRow}
      >
        {t("hub.automations.access.remove")}
      </Button>
    </View>
  );
}

function GrantForm({
  candidates,
  pending,
  grant,
}: {
  candidates: readonly { id: string; name: string }[];
  pending: boolean;
  grant(membershipId: string, level: HubAutomationScope): void;
}) {
  const { t } = useTranslation();
  const [membershipId, setMembershipId] = useState<string | null>(null);
  const [level, setLevel] = useState<HubAutomationScope>("run");
  const options = useMemo(
    () => candidates.map(({ id, name }) => ({ id, value: id, label: name })),
    [candidates],
  );
  const selected = options.find(({ value }) => value === membershipId);
  const selectedDisplay = useMemo(
    () => (selected === undefined ? null : { label: selected.label }),
    [selected],
  );
  const levelOptions = useMemo(
    () => [
      { id: "run", value: "run" as const, label: t("hub.automations.scope.run") },
      { id: "admin", value: "admin" as const, label: t("hub.automations.scope.admin") },
    ],
    [t],
  );
  const levelDisplay = useMemo(
    () => ({ label: levelOptions.find(({ value }) => value === level)?.label ?? level }),
    [level, levelOptions],
  );
  const submit = useCallback(() => {
    if (membershipId === null) return;
    grant(membershipId, level);
    setMembershipId(null);
  }, [grant, level, membershipId]);
  return (
    <View style={styles.form}>
      <SelectField
        label={t("hub.automations.access.member")}
        value={membershipId}
        selectedDisplay={selectedDisplay}
        placeholder={t("hub.automations.access.chooseMember")}
        emptyText={t("hub.automations.access.everyMemberHasAccess")}
        options={options}
        onChange={setMembershipId}
        disabled={pending}
      />
      <SelectField
        label={t("hub.automations.access.level")}
        value={level}
        selectedDisplay={levelDisplay}
        placeholder={t("hub.automations.access.chooseLevel")}
        emptyText=""
        options={levelOptions}
        onChange={setLevel}
        disabled={pending}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={pending || membershipId === null}
        onPress={submit}
      >
        {t("hub.automations.access.grant")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { gap: theme.spacing[3], marginTop: theme.spacing[3] },
}));
