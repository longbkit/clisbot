import { useCallback, useState, useMemo } from "react";
import { Text, View, Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import type { BotFormModel, BotFormState } from "./bot-form-model";
import { botFormStyles } from "./bot-form-styles";
export function BotTemplateField({
  state,
  model,
  editing,
}: {
  state: BotFormState;
  model: BotFormModel;
  editing: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const toggle = useCallback(() => setPreview((value) => !value), []);
  return (
    <View style={styles.stack}>
      <View style={styles.header}>
        <Text style={botFormStyles.text}>Bot template</Text>
        <Button variant="ghost" size="sm" onPress={toggle}>
          {preview ? "Hide preview" : "Preview templates"}
        </Button>
      </View>
      {(["personal", "team"] as const)
        .filter((kind) => !editing || kind === state.kind)
        .map((kind) => (
          <TemplateOption
            key={kind}
            kind={kind}
            selected={state.kind === kind}
            disabled={editing}
            onSelect={model.setKind}
          />
        ))}
      {preview ? (
        <Text style={botFormStyles.hint}>
          Template sets up the bot’s instructions and workspace files. Team context does not grant
          access automatically; sharing is managed through Project Access.
        </Text>
      ) : null}
    </View>
  );
}
function TemplateOption({
  kind,
  selected,
  disabled,
  onSelect,
}: {
  kind: "personal" | "team";
  selected: boolean;
  disabled: boolean;
  onSelect: BotFormModel["setKind"];
}) {
  const accessibilityState = useMemo(() => ({ checked: selected, disabled }), [selected, disabled]);
  const select = useCallback(() => onSelect(kind), [kind, onSelect]);
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPress={select}
      style={[styles.option, selected && styles.selected]}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.dot} /> : null}
      </View>
      <View style={styles.content}>
        <Text style={botFormStyles.summary}>
          {kind === "personal" ? "Personal assistant" : "Team assistant"}
        </Text>
        <Text style={botFormStyles.hint}>
          {kind === "personal"
            ? "Works on behalf of one person."
            : "Works with shared team context."}
        </Text>
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create((theme) => ({
  stack: { gap: theme.spacing[2] },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    minHeight: 64,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  selected: {
    borderColor: theme.colors.foreground,
    backgroundColor: theme.colors.surface2,
  },
  content: { flex: 1, gap: theme.spacing[1] },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
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
