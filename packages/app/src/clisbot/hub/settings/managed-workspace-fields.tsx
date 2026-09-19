import { useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Field, FormTextInput } from "@/components/ui/form-field";
import type { SelectFieldOption } from "@/components/ui/select-field";
import type { WorkspaceBehavior, WorkspaceConfigurationValue } from "../workspace-configuration";

/**
 * Where the Agent works, other than the Project folder itself: a folder inside
 * it, or an isolated worktree of its repository. The two exclude each other:
 * a worktree is created from the repository and the Agent starts at its root.
 */
export type WorkLocation = "folder" | Exclude<WorkspaceBehavior, "project">;

export const WORK_LOCATION_OPTIONS: SelectFieldOption<WorkLocation>[] = [
  {
    id: "folder",
    value: "folder",
    label: "A folder inside the Project",
    description: "Work in a subfolder of the Project folder.",
  },
  {
    id: "branch-off",
    value: "branch-off",
    label: "New isolated worktree",
    description: "Create a new branch and worktree for this Agent.",
  },
  {
    id: "checkout-branch",
    value: "checkout-branch",
    label: "Existing branch",
    description: "Check out an existing branch in an isolated worktree.",
  },
  {
    id: "checkout-pr",
    value: "checkout-pr",
    label: "Pull request",
    description: "Check out a pull request in an isolated worktree.",
  },
];

/**
 * The fields a worktree choice needs: a new branch (and optional base), an
 * existing branch, or a pull request number. Nothing for the Project folder.
 */
export function WorktreeTargetFields({
  value,
  onChange,
  disabled,
}: {
  value: WorkspaceConfigurationValue;
  onChange(value: WorkspaceConfigurationValue): void;
  disabled: boolean;
}) {
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
  if (value.behavior === "branch-off")
    return (
      <View style={styles.group}>
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
      </View>
    );
  if (value.behavior === "checkout-branch")
    return (
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
    );
  if (value.behavior === "checkout-pr")
    return (
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
    );
  return null;
}

const styles = StyleSheet.create((theme) => ({
  group: {
    gap: theme.spacing[3],
  },
}));
