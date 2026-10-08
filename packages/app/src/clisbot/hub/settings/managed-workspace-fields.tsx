import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Field, FormTextInput } from "@/components/ui/form-field";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { i18n } from "@/i18n/i18next";
import type { WorkspaceBehavior, WorkspaceConfigurationValue } from "../workspace-configuration";

/**
 * Where the Agent works, other than the Project folder itself: a folder inside
 * it, or an isolated worktree of its repository. The two exclude each other:
 * a worktree is created from the repository and the Agent starts at its root.
 */
export type WorkLocation = "folder" | Exclude<WorkspaceBehavior, "project">;

// Labels are getters so a module-level list still reads the current language.
export const WORK_LOCATION_OPTIONS: SelectFieldOption<WorkLocation>[] = [
  {
    id: "folder",
    value: "folder",
    get label() {
      return i18n.t("hub.access.workLocation.folderLabel");
    },
    get description() {
      return i18n.t("hub.access.workLocation.folderDescription");
    },
  },
  {
    id: "branch-off",
    value: "branch-off",
    get label() {
      return i18n.t("hub.access.workLocation.branchOffLabel");
    },
    get description() {
      return i18n.t("hub.access.workLocation.branchOffDescription");
    },
  },
  {
    id: "checkout-branch",
    value: "checkout-branch",
    get label() {
      return i18n.t("hub.access.workLocation.checkoutBranchLabel");
    },
    get description() {
      return i18n.t("hub.access.workLocation.checkoutBranchDescription");
    },
  },
  {
    id: "checkout-pr",
    value: "checkout-pr",
    get label() {
      return i18n.t("hub.access.workLocation.checkoutPrLabel");
    },
    get description() {
      return i18n.t("hub.access.workLocation.checkoutPrDescription");
    },
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
  const { t } = useTranslation();
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
        <Field
          label={t("hub.access.workLocation.newBranch")}
          hint={t("hub.access.workLocation.newBranchHint")}
        >
          <FormTextInput
            initialValue={value.newBranch}
            onChangeText={setNewBranch}
            placeholder="feature/customer-request"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
          />
        </Field>
        <Field
          label={t("hub.access.workLocation.baseBranch")}
          hint={t("hub.access.workLocation.baseBranchHint")}
        >
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
      <Field
        label={t("hub.access.workLocation.branch")}
        hint={t("hub.access.workLocation.branchHint")}
      >
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
      <Field label={t("hub.access.workLocation.pullRequestNumber")}>
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
