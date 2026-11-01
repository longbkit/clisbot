import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentFeature } from "@clisbot/protocol/agent-types";
import { getAgentFeatureIcon } from "@/agent-controls/icons";
import { Combobox } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { AgentControlTrigger } from "@/composer/agent-controls/control";

type SelectFeature = Extract<AgentFeature, { type: "select" }>;
type ToggleFeature = Extract<AgentFeature, { type: "toggle" }>;

function ToggleRow(props: { feature: ToggleFeature; onSet: (id: string, value: unknown) => void }) {
  const { feature, onSet } = props;
  const change = useCallback((value: boolean) => onSet(feature.id, value), [feature.id, onSet]);
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.label} numberOfLines={1}>
        {feature.label}
      </Text>
      <Switch
        value={feature.value}
        onValueChange={change}
        accessibilityLabel={feature.label}
        testID={`composer-picker-feature-${feature.id}`}
      />
    </View>
  );
}

function SelectRow(props: { feature: SelectFeature; onSet: (id: string, value: unknown) => void }) {
  const { feature, onSet } = props;
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () => feature.options.map((option) => ({ id: option.id, label: option.label })),
    [feature.options],
  );
  const current = feature.options.find((option) => option.id === feature.value)?.label;
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const select = useCallback((id: string) => onSet(feature.id, id), [feature.id, onSet]);
  return (
    <>
      <AgentControlTrigger
        ref={anchorRef}
        icon={getAgentFeatureIcon(feature.icon)}
        surface="sheet"
        label={feature.label}
        value={current ?? feature.label}
        open={open}
        onPress={toggle}
        accessibilityLabel={`${feature.label}: ${current ?? ""}`}
        testID={`composer-picker-feature-${feature.id}`}
      />
      <Combobox
        options={options}
        value={String(feature.value)}
        onSelect={select}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        presentation="push"
        searchable={false}
        title={feature.label}
      />
    </>
  );
}

/** Provider options that are neither speed nor mode, such as Copilot's Agent. */
export function MoreFeatures(props: {
  features: readonly AgentFeature[];
  onSetFeature: (featureId: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  if (props.features.length === 0) return null;
  return (
    <View style={styles.section} testID="composer-picker-more">
      <Text style={styles.heading}>{t("composer.picker.more")}</Text>
      {props.features.map((feature) =>
        feature.type === "toggle" ? (
          <ToggleRow key={feature.id} feature={feature} onSet={props.onSetFeature} />
        ) : (
          <SelectRow key={feature.id} feature={feature} onSet={props.onSetFeature} />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSubtle,
  },
  heading: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  toggleRow: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  label: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));
