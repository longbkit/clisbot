import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useIsCompactFormFactor } from "@/constants/layout";
import { resolveProviderModeName } from "./mode-presentation";
import type { PermissionCarry, PermissionOption } from "./permission-carry";

/**
 * The one step before a provider switch, inside the app on every platform (the confirmation's
 * own sheet primitives, never a native alert): from and to, the new session's permission (chosen
 * explicitly where nothing safe can be kept), and what happens to the history. Cancel, the close
 * button, Escape, Back and a dismissed sheet all change nothing.
 */
export interface ProviderSwitchReviewInput {
  from: string;
  to: string;
  /** What the session runs in now, so the mapping reads even for a provider's own mode names. */
  fromPermission: PermissionOption | null;
  carry: PermissionCarry;
  history: "chat" | "work";
}

const SNAP_POINTS = ["70%", "90%"];

export function optionTestId(option: PermissionOption): string {
  return `provider-switch-permission-${option.modeId ?? "provider-default"}`;
}

interface OptionName {
  label: string;
  /** The provider's own name under a shared name (`resolveProviderModeName`). */
  providerName: string | undefined;
}

/** The same names as the Mode picker: the shared name, and the provider's own beside it. */
function useOptionName() {
  const { t } = useTranslation();
  return useCallback(
    (option: PermissionOption | undefined): OptionName => {
      if (!option) return { label: "", providerName: undefined };
      if (option.modeId === null)
        return { label: t("composer.providerSwitch.providerDefault"), providerName: undefined };
      if (!option.labelKey) return { label: option.label, providerName: undefined };
      const label = t(`composer.picker.modeLabels.${option.labelKey}`);
      const mode = { id: option.modeId, label: option.label };
      return { label, providerName: resolveProviderModeName(option.labelKey, mode, label) };
    },
    [t],
  );
}

function withProviderName(name: OptionName): string {
  return name.providerName ? `${name.label} (${name.providerName})` : name.label;
}

function PermissionRow(props: {
  option: PermissionOption;
  name: OptionName;
  selected: boolean;
  onSelect: (option: PermissionOption) => void;
}) {
  const { option, onSelect } = props;
  const select = useCallback(() => onSelect(option), [onSelect, option]);
  const accessibilityState = useMemo(() => ({ checked: props.selected }), [props.selected]);
  return (
    <PressHighlight
      accessibilityRole="radio"
      accessibilityState={accessibilityState}
      aria-checked={props.selected}
      accessibilityLabel={withProviderName(props.name)}
      onPress={select}
      style={[styles.row, props.selected && styles.rowSelected]}
      testID={optionTestId(option)}
    >
      <View style={[styles.radio, props.selected && styles.radioSelected]} />
      <Text style={styles.rowLabel}>
        {props.name.label}
        {props.name.providerName ? (
          <Text
            style={styles.providerName}
            testID={`provider-switch-provider-name-${option.modeId ?? "provider-default"}`}
          >
            {`  ${props.name.providerName}`}
          </Text>
        ) : null}
      </Text>
    </PressHighlight>
  );
}

function ReviewBody(props: {
  input: ProviderSwitchReviewInput;
  selected: PermissionOption | undefined;
  onSelect: (option: PermissionOption) => void;
}) {
  const { t } = useTranslation();
  const name = useOptionName();
  const { input, selected } = props;
  const reason = t(`composer.providerSwitch.reasons.${input.carry.reason}`, {
    mode: withProviderName(name(input.carry.selected)),
  });
  return (
    <View style={styles.body}>
      <Text style={styles.route} testID="provider-switch-route">
        <Text testID="provider-switch-from">{input.from}</Text>
        {" · "}
        <Text testID="provider-switch-from-permission">
          {input.fromPermission
            ? withProviderName(name(input.fromPermission))
            : t("composer.providerSwitch.unknownMode")}
        </Text>
        {"  →  "}
        <Text testID="provider-switch-to">{input.to}</Text>
        {" · "}
        <Text testID="provider-switch-to-permission">
          {selected ? withProviderName(name(selected)) : t("composer.providerSwitch.chooseBelow")}
        </Text>
      </Text>
      <Text style={styles.heading}>{t("composer.providerSwitch.permissionHeading")}</Text>
      <Text style={styles.muted} testID="provider-switch-reason">
        {reason}
      </Text>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {input.carry.options.map((option) => (
          <PermissionRow
            key={option.modeId ?? "provider-default"}
            option={option}
            name={name(option)}
            selected={selected === option}
            onSelect={props.onSelect}
          />
        ))}
      </View>
      <Text style={styles.muted} testID="provider-switch-history">
        {t(
          input.history === "chat"
            ? "composer.providerSwitch.chatHistory"
            : "composer.providerSwitch.workHistory",
        )}
      </Text>
    </View>
  );
}

export function ProviderSwitchReview(props: {
  input: ProviderSwitchReviewInput;
  onCancel: () => void;
  onConfirm: (option: PermissionOption) => void;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const { input, onCancel, onConfirm } = props;
  const [selected, setSelected] = useState(input.carry.selected);
  const header = useMemo(
    () => ({ title: t("composer.providerSwitch.title", { provider: input.to }) }),
    [input.to, t],
  );
  const confirm = useCallback(() => {
    if (selected) onConfirm(selected);
  }, [onConfirm, selected]);
  const footer = useMemo(
    () => (
      <View style={[styles.actions, compact && styles.compactActions]}>
        <Button
          variant="secondary"
          style={compact ? undefined : styles.action}
          onPress={onCancel}
          testID="provider-switch-cancel"
        >
          {t("composer.providerSwitch.cancel")}
        </Button>
        <Button
          style={compact ? undefined : styles.action}
          disabled={!selected}
          onPress={confirm}
          testID="provider-switch-confirm"
        >
          {t("composer.providerSwitch.confirm")}
        </Button>
      </View>
    ),
    [compact, confirm, onCancel, selected, t],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onCancel}
      onDismiss={onCancel}
      snapPoints={SNAP_POINTS}
      testID="provider-switch-review"
      footer={footer}
    >
      <ReviewBody input={input} selected={selected} onSelect={setSelected} />
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[3] },
  route: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  heading: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  options: { gap: theme.spacing[1] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 44,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowSelected: { borderColor: theme.colors.borderAccent },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
  },
  radioSelected: { borderWidth: 5, borderColor: theme.colors.accent },
  rowLabel: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.base },
  providerName: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  actions: { flex: 1, flexDirection: "row", gap: theme.spacing[2] },
  action: { flex: 1 },
  compactActions: { flexDirection: "column" },
}));
