import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { FULL_AUTO_ACCEPT_MODE_ID } from "@clisbot/protocol/full-auto-accept";
import type { AgentMode } from "@clisbot/protocol/agent-types";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import type { AgentModeControlValue } from "@/composer/agent-controls/mode-control";
import { resolveNextAgentModeId } from "@/composer/agent-controls/mode";
import { useComposerKeyboardScope } from "@/composer/keyboard-scope";
import { useComposerPickerPlacement } from "@/composer/picker-placement";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { useModePresentation, type ModePresentation } from "./mode-presentation";

export interface ModeDropdownProps extends AgentModeControlValue {
  /** False collapses the trigger to its icon when the composer bar is short of room. */
  showLabel: boolean;
  /** The bar's dropdown owns the mode-cycle shortcut; the panel's copy does not. */
  ownsCycleShortcut: boolean;
  onClose?: () => void;
  testID: string;
}

function ModeOptionRow(props: {
  option: ComboboxOption;
  presentation: ModePresentation;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}): ReactElement {
  const Icon = props.presentation.icon;
  const leading = useMemo(() => <Icon size={16} color={styles.optionIcon.color} />, [Icon]);
  return (
    <ComboboxItem
      label={props.presentation.label}
      description={props.presentation.description}
      descriptionLayout="stacked"
      selected={props.selected}
      active={props.active}
      onPress={props.onPress}
      leadingSlot={leading}
      testID={`mode-option-${props.option.id}`}
    />
  );
}

/** Full auto-accept is chosen on purpose, never stepped into by the cycle shortcut. */
function cycleOptions(modes: readonly AgentMode[]): AgentMode[] {
  return modes.filter((mode) => mode.id !== FULL_AUTO_ACCEPT_MODE_ID);
}

function useModeCycleShortcut(props: ModeDropdownProps): void {
  const { isActiveComposer } = useComposerKeyboardScope();
  const handlerId = useRef(`composer-mode:${Math.random().toString(36).slice(2)}`);
  const { disabled, modeOptions, onSelectMode, selectedModeId, ownsCycleShortcut } = props;
  const handle = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      if (action.id !== "message-input.mode-cycle" || disabled || !isActiveComposer) return false;
      const next = resolveNextAgentModeId({
        modeOptions: cycleOptions(modeOptions),
        selectedMode: selectedModeId,
      });
      if (next) onSelectMode(next);
      return next !== null;
    },
    [disabled, isActiveComposer, modeOptions, onSelectMode, selectedModeId],
  );
  useKeyboardActionHandler({
    handlerId: handlerId.current,
    actions: ["message-input.mode-cycle"],
    enabled: ownsCycleShortcut && isActiveComposer && !disabled && modeOptions.length > 1,
    priority: 200,
    handle,
  });
}

/** The Mode dropdown: icon and name on the bar and in the panel footer. */
export function ModeDropdown(props: ModeDropdownProps) {
  const { t } = useTranslation();
  const placement = useComposerPickerPlacement();
  const present = useModePresentation();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  useModeCycleShortcut(props);
  const { provider, modeOptions, selectedModeId, onSelectMode, onClose } = props;
  const selected = modeOptions.find((mode) => mode.id === selectedModeId) ?? modeOptions[0];
  const options = useMemo(
    () => modeOptions.map((mode) => ({ id: mode.id, label: present(provider, mode).label })),
    [modeOptions, present, provider],
  );
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) onClose?.();
    },
    [onClose],
  );
  const handleSelect = useCallback(
    (id: string) => {
      onSelectMode(id);
      handleOpenChange(false);
    },
    [handleOpenChange, onSelectMode],
  );
  const renderOption = useCallback(
    (args: { option: ComboboxOption; selected: boolean; active: boolean; onPress: () => void }) => {
      const mode = modeOptions.find((entry) => entry.id === args.option.id) ?? modeOptions[0];
      return <ModeOptionRow {...args} presentation={present(provider, mode!)} />;
    },
    [modeOptions, present, provider],
  );
  const handlePress = useCallback(() => handleOpenChange(!open), [handleOpenChange, open]);
  if (!selected) return null;
  const current = present(provider, selected);
  return (
    <>
      <AgentControlTrigger
        ref={anchorRef}
        icon={current.icon}
        surface="toolbar"
        label={t("agentControls.mode.title")}
        value={current.label}
        showToolbarLabel={props.showLabel}
        showCaret={false}
        open={open}
        disabled={props.disabled}
        onPress={handlePress}
        accessibilityLabel={t("agentControls.mode.selectWithValue", { value: current.label })}
        testID={props.testID}
      />
      <Combobox
        options={options}
        value={selected.id}
        onSelect={handleSelect}
        searchable={false}
        open={open}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        desktopPlacement={placement}
        desktopMinWidth={300}
        title={t("agentControls.mode.title")}
        renderOption={renderOption}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  optionIcon: {
    color: theme.colors.foreground,
  },
}));
