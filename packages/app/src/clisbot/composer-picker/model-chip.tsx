import { forwardRef, useCallback } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ModelProviderGlyph } from "@/components/model-browser";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";

interface ModelChipProps {
  provider: string;
  serverId: string | null;
  /** "6 Astra Medium": the short model name and its effort (see `model-name.ts`). */
  label: string;
  glyphSize: number;
  open: boolean;
  disabled: boolean;
  accessibilityLabel: string;
  /** On a phone the short name keeps its width; neighbours such as Tools give way first. */
  keepName: boolean;
  onPress: () => void;
}

/** The bar's Model chip: provider icon and short model name. It opens the options panel. */
export const ModelChip = forwardRef<View, ModelChipProps>(function ModelChip(props, ref) {
  const { open, disabled, keepName } = props;
  const style = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.chip,
      keepName && styles.keepName,
      Boolean(hovered) && styles.hovered,
      (pressed || open) && styles.pressed,
      disabled && styles.disabled,
    ],
    [disabled, keepName, open],
  );
  return (
    <ComboboxTrigger
      ref={ref}
      collapsable={false}
      disabled={disabled}
      onPress={props.onPress}
      style={style}
      chevron={null}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      testID="composer-model-chip"
    >
      {props.provider ? (
        <View style={props.glyphSize >= 20 ? styles.glyph20 : styles.glyph16}>
          <ModelProviderGlyph
            provider={props.provider}
            serverId={props.serverId}
            size={props.glyphSize}
          />
        </View>
      ) : null}
      <Text style={styles.label} numberOfLines={1} ellipsizeMode="tail">
        {props.label}
      </Text>
    </ComboboxTrigger>
  );
});

const styles = StyleSheet.create((theme) => ({
  chip: {
    height: 28,
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "transparent",
  },
  keepName: {
    flexShrink: 0,
    maxWidth: 160,
  },
  hovered: {
    backgroundColor: theme.colors.surface2,
  },
  pressed: {
    backgroundColor: theme.colors.surface0,
  },
  disabled: {
    opacity: theme.opacity[50],
  },
  glyph16: {
    width: 16,
    height: 16,
    flexShrink: 0,
  },
  glyph20: {
    width: 20,
    height: 20,
    flexShrink: 0,
  },
  label: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
}));
