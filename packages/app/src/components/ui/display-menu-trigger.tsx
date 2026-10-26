import { Text, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { extraMutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { MenuTrigger, type MenuTriggerState } from "@/components/ui/menu/menu-root";
import {
  isToolbarLabelTriggerHighlighted,
  toolbarLabelTriggerStyle,
  toolbarLabelTriggerTextStyle,
  ToolbarLabelTriggerIcon,
} from "@/components/ui/toolbar-label-trigger";
import { ICON_SIZE, SPACING } from "@/styles/theme";

const ThemedChevron = withUnistyles(ChevronDown);

/** The label trigger is a text line; the press area reaches the touch target. */
const HIT_SLOP = { top: SPACING[3], bottom: SPACING[3], left: SPACING[1], right: SPACING[1] };

/**
 * The one "Display ▾" trigger a list's Display menu opens from. A dot marks a filter in force,
 * so a narrowed list never looks like a short one. Place inside the menu's root.
 */
export function DisplayMenuTrigger({
  label,
  active,
  testID,
}: {
  label: string;
  active: boolean;
  testID: string;
}) {
  return (
    <MenuTrigger
      style={toolbarLabelTriggerStyle}
      hitSlop={HIT_SLOP}
      accessibilityLabel={label}
      testID={testID}
    >
      {(state: MenuTriggerState) => (
        <>
          <Text
            style={toolbarLabelTriggerTextStyle(isToolbarLabelTriggerHighlighted(state))}
            numberOfLines={1}
          >
            {label}
          </Text>
          {active ? <View style={styles.dot} testID={`${testID}-filtered`} /> : null}
          <ToolbarLabelTriggerIcon>
            <ThemedChevron size={ICON_SIZE.xs} uniProps={extraMutedIconColorMapping} />
          </ToolbarLabelTriggerIcon>
        </>
      )}
    </MenuTrigger>
  );
}

const styles = StyleSheet.create((theme) => ({
  dot: {
    width: theme.spacing[1.5],
    height: theme.spacing[1.5],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
}));
