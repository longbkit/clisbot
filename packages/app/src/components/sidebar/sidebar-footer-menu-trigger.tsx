import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DensityIcon } from "@/components/ui/density-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePointerCapabilities } from "@/hooks/pointer-capabilities";
import { density } from "@/styles/density";
import { SidebarFooterIconHighlight } from "./sidebar-footer-icon-highlight";

/**
 * A footer icon that opens a menu. Sized and drawn like the footer's other icon buttons; the
 * tooltip stays out of the way while the menu is open.
 */
export function SidebarFooterMenuTrigger({
  icon,
  label,
  menuOpen,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  menuOpen: boolean;
  testID: string;
}): ReactElement {
  const compact = useIsCompactFormFactor();
  const { finePointer } = usePointerCapabilities();
  return (
    <Tooltip delayDuration={300} enabledOnDesktop={!menuOpen}>
      <TooltipTrigger asChild>
        <View>
          <DropdownMenuTrigger
            style={[styles.trigger, (compact || !finePointer) && styles.touchTrigger]}
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={label}
          >
            {({ hovered, pressed, open }) => (
              <>
                <SidebarFooterIconHighlight visible={pressed || open} />
                <DensityIcon
                  icon={icon}
                  size="md"
                  color={hovered ? "foreground" : "foregroundMuted"}
                />
              </>
            )}
          </DropdownMenuTrigger>
        </View>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: density.iconButton,
    height: density.iconButton,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
  touchTrigger: { width: MIN_TOUCH_TARGET_SIZE, height: MIN_TOUCH_TARGET_SIZE },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
