import { useCallback, useMemo } from "react";
import { Text, View, Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Field } from "@/components/ui/form-field";
import type { BotFormModel, BotFormState } from "./bot-form-model";

const TEMPLATES = {
  personal: { title: "Personal", description: "Works for one person" },
  team: { title: "Team", description: "Shared team context" },
} as const;

type TemplateKind = keyof typeof TEMPLATES;

/** Two choices on one row. The template is fixed once the bot exists. */
export function BotTemplateField({
  state,
  model,
  editing,
}: {
  state: BotFormState;
  model: BotFormModel;
  editing: boolean;
}) {
  return (
    <Field
      label="Template"
      hint={
        editing
          ? "Set when the bot was created."
          : "Seeds the bot's instructions and workspace files. Sharing is set in Project Access."
      }
    >
      <View accessibilityRole="radiogroup" style={styles.row}>
        {(Object.keys(TEMPLATES) as TemplateKind[]).map((kind) => (
          <TemplateOption
            key={kind}
            kind={kind}
            selected={state.kind === kind}
            disabled={editing}
            onSelect={model.setKind}
          />
        ))}
      </View>
    </Field>
  );
}

function TemplateOption({
  kind,
  selected,
  disabled,
  onSelect,
}: {
  kind: TemplateKind;
  selected: boolean;
  disabled: boolean;
  onSelect: BotFormModel["setKind"];
}) {
  const accessibilityState = useMemo(() => ({ checked: selected, disabled }), [selected, disabled]);
  const select = useCallback(() => onSelect(kind), [kind, onSelect]);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${TEMPLATES[kind].title} assistant`}
      aria-checked={selected}
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPress={select}
      style={[styles.option, selected && styles.selected, disabled && !selected && styles.faded]}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.dot} /> : null}
      </View>
      <View style={styles.content}>
        <Text style={styles.title}>{TEMPLATES[kind].title}</Text>
        <Text style={styles.description} numberOfLines={1}>
          {TEMPLATES[kind].description}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", gap: theme.spacing[2] },
  option: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  // A selected choice is a surface3 fill (docs/design.md, segmented control); the radio dot
  // carries the selection, so the border stays the neutral one.
  selected: { backgroundColor: theme.colors.surface3 },
  faded: { opacity: 0.5 },
  content: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: theme.colors.foreground },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.foreground,
  },
}));
