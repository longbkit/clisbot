import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";
import type { WorkspaceBehavior, WorkspaceConfigurationValue } from "../workspace-configuration";

const WORKSPACE_OPTIONS = [
  {
    id: "project",
    value: "project" as const,
    label: "Use Project folder",
    description: "Work directly in the selected Project folder.",
  },
  {
    id: "branch-off",
    value: "branch-off" as const,
    label: "New isolated worktree",
    description: "Create a new branch and worktree for this Agent.",
  },
  {
    id: "checkout-branch",
    value: "checkout-branch" as const,
    label: "Existing branch",
    description: "Check out an existing branch in an isolated worktree.",
  },
  {
    id: "checkout-pr",
    value: "checkout-pr" as const,
    label: "Pull request",
    description: "Check out a pull request in an isolated worktree.",
  },
];

export function ManagedWorkspaceFields({
  value,
  onChange,
  disabled,
}: {
  value: WorkspaceConfigurationValue;
  onChange(value: WorkspaceConfigurationValue): void;
  disabled: boolean;
}) {
  const selected = WORKSPACE_OPTIONS.find((option) => option.value === value.behavior);
  const selectedDisplay = useMemo(
    () => (selected ? { label: selected.label, description: selected.description } : null),
    [selected],
  );
  const setBehavior = useCallback(
    (behavior: WorkspaceBehavior) => onChange({ ...value, behavior }),
    [onChange, value],
  );
  const setNewBranch = useCallback(
    (newBranch: string) => onChange({ ...value, newBranch }),
    [onChange, value],
  );
  const setBase = useCallback((base: string) => onChange({ ...value, base }), [onChange, value]);
  const setBranch = useCallback(
    (branch: string) => onChange({ ...value, branch }),
    [onChange, value],
  );
  const setPullRequestNumber = useCallback(
    (pullRequestNumber: string) => onChange({ ...value, pullRequestNumber }),
    [onChange, value],
  );

  return (
    <View style={styles.group}>
      <View>
        <Text style={settingsStyles.rowTitle}>Workspace</Text>
        <Text style={settingsStyles.rowHint}>
          Choose how the Agent uses the selected Project repository.
        </Text>
      </View>
      <SelectField
        label="Workspace behavior"
        value={value.behavior}
        selectedDisplay={selectedDisplay}
        options={WORKSPACE_OPTIONS}
        onChange={setBehavior}
        placeholder="Choose how the Agent uses the Project"
        emptyText="No Workspace behaviors are available."
        title="Workspace behavior"
        disabled={disabled}
      />
      {value.behavior === "branch-off" ? (
        <>
          <Field label="New branch" hint="Required branch name for the new worktree.">
            <FormTextInput
              initialValue={value.newBranch}
              onChangeText={setNewBranch}
              placeholder="feature/customer-request"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!disabled}
            />
          </Field>
          <Field label="Base branch" hint="Optional. The repository default is used when empty.">
            <FormTextInput
              initialValue={value.base}
              onChangeText={setBase}
              placeholder="main"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!disabled}
            />
          </Field>
        </>
      ) : null}
      {value.behavior === "checkout-branch" ? (
        <Field label="Branch" hint="Existing local or remote branch name.">
          <FormTextInput
            initialValue={value.branch}
            onChangeText={setBranch}
            placeholder="release/next"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
          />
        </Field>
      ) : null}
      {value.behavior === "checkout-pr" ? (
        <Field label="Pull request number">
          <FormTextInput
            initialValue={value.pullRequestNumber}
            onChangeText={setPullRequestNumber}
            placeholder="123"
            keyboardType="number-pad"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
          />
        </Field>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  group: {
    gap: theme.spacing[3],
  },
}));
