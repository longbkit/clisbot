import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/ui/form-field";
import { useHostFeature } from "@/runtime/host-features";
import type { BotFormModel, BotFormState } from "./bot-form-model";
import type { BotTemplateChoice } from "./bot-template-choice";
import { BotTemplateConflicts } from "./bot-template-conflicts";

// No template first: a bot from a Project starts with none (`initialTemplateChoice`).
const TEMPLATE_CHOICES: readonly BotTemplateChoice[] = ["none", "personal", "team"];
// COMPAT(botTemplatePreview): an older Host ignores `template.seed` and always seeds, so it is
// offered only the two templates it writes.
const SEEDING_CHOICES: readonly BotTemplateChoice[] = ["personal", "team"];

/** A template's name and one-line summary on its card, and what it writes, in full, below. */
const TEMPLATE_COPY = {
  none: {
    title: "bots.workspace.botForm.noneTitle",
    summary: "bots.workspace.botForm.noneDescription",
    detail: "bots.workspace.botForm.noneDetail",
    label: "bots.workspace.botForm.noneLabel",
  },
  personal: {
    title: "bots.workspace.shared.form.kindPersonal",
    summary: "bots.workspace.botForm.personalDescription",
    detail: "bots.workspace.botForm.personalDetail",
    label: "bots.workspace.botForm.personalLabel",
  },
  team: {
    title: "bots.workspace.shared.form.kindTeam",
    summary: "bots.workspace.botForm.teamDescription",
    detail: "bots.workspace.botForm.teamDetail",
    label: "bots.workspace.botForm.teamLabel",
  },
} as const satisfies Record<BotTemplateChoice, Record<string, string>>;

/**
 * One card per template with its name and a one-line summary, then what the chosen one writes,
 * then what to do with files already there. Fixed once the bot exists.
 */
export function BotTemplateField({
  state,
  model,
  editing,
}: {
  state: BotFormState;
  model: BotFormModel;
  editing: boolean;
}) {
  const { t } = useTranslation();
  const canSkip = useHostFeature(state.selectedServerId, "botTemplatePreview");
  const choices = canSkip ? TEMPLATE_CHOICES : SEEDING_CHOICES;
  const selected =
    !canSkip && state.template.choice === "none" ? state.kind : state.template.choice;
  return (
    <Field
      label={t("bots.workspace.botForm.template")}
      hint={
        editing
          ? t("bots.workspace.botForm.templateHintEditing")
          : t("bots.workspace.botForm.templateHint")
      }
    >
      <View style={styles.stack}>
        <View accessibilityRole="radiogroup" style={styles.choices}>
          {choices.map((kind) => (
            <TemplateOption
              key={kind}
              kind={kind}
              selected={selected === kind}
              disabled={editing}
              onSelect={model.setTemplate}
            />
          ))}
        </View>
        <TemplateDetail kind={selected} />
        {editing ? null : <BotTemplateConflicts state={state} model={model} />}
      </View>
    </Field>
  );
}

function TemplateDetail({ kind }: { kind: BotTemplateChoice }) {
  const { t } = useTranslation();
  const copy = TEMPLATE_COPY[kind];
  return (
    <View style={styles.detail} testID="bot-template-detail">
      <Text style={styles.detailBody}>{t(copy.detail)}</Text>
    </View>
  );
}

function TemplateOption({
  kind,
  selected,
  disabled,
  onSelect,
}: {
  kind: BotTemplateChoice;
  selected: boolean;
  disabled: boolean;
  onSelect: BotFormModel["setTemplate"];
}) {
  const { t } = useTranslation();
  const accessibilityState = useMemo(() => ({ checked: selected, disabled }), [selected, disabled]);
  const select = useCallback(() => onSelect(kind), [kind, onSelect]);
  const optionStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.option,
      hovered && !selected && !disabled && styles.hovered,
      selected && styles.selected,
      disabled && !selected && styles.faded,
    ],
    [disabled, selected],
  );
  const copy = TEMPLATE_COPY[kind];
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={t(copy.label)}
      aria-checked={selected}
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPress={select}
      style={optionStyle}
      testID={`bot-template-${kind}`}
    >
      <Text style={[styles.title, selected && styles.titleSelected]}>{t(copy.title)}</Text>
      <Text style={styles.summary}>{t(copy.summary)}</Text>
    </Pressable>
  );
}

// A template card steps up as a segment of `<SegmentedControl variant="track">` does: the track
// fill at rest, lighter on hover, and the raised card of a selected sidebar row with a
// medium-weight name when chosen (docs/design.md, sizes).
const styles = StyleSheet.create((theme) => ({
  stack: { gap: theme.spacing[2] },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  // Cards share the row and wrap two or three to a line, so more templates stay readable.
  option: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 140,
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surfaceSegmentedTrack,
  },
  hovered: { backgroundColor: theme.colors.surfaceSegmentedHover },
  selected: { backgroundColor: theme.colors.surfaceSegmentedSelected, ...theme.shadow.raised },
  faded: { opacity: theme.opacity[50] },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  titleSelected: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
  summary: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  detail: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  detailBody: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.5,
  },
}));
