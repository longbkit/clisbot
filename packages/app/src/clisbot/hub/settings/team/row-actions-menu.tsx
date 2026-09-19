import { MoreHorizontal } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { buttonControlHeight, buttonIconSize } from "@/components/ui/control-geometry";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MenuTriggerState } from "@/components/ui/menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { Theme } from "@/styles/theme";

const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
function triggerStyle({ hovered, pressed, open }: MenuTriggerState) {
  return [styles.trigger, (hovered || pressed || open) && styles.highlight];
}

export interface RowAction {
  label: string;
  onSelect(): void;
  destructive?: boolean;
  disabled?: boolean;
}

/** The overflow menu of a People row: infrequent actions behind Paseo's menu presentation. */
export function RowActionsMenu({
  label,
  actions,
  disabled,
}: {
  label: string;
  actions: readonly RowAction[];
  disabled: boolean;
}) {
  const compact = useIsCompactFormFactor();
  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        style={triggerStyle}
      >
        <ThemedMoreHorizontal size={buttonIconSize[compact ? "md" : "sm"]} uniProps={mutedColor} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sheetTitle={label}>
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            disabled={disabled || action.disabled === true}
            destructive={action.destructive}
            onSelect={action.onSelect}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: { xs: buttonControlHeight.md, md: buttonControlHeight.sm },
    height: { xs: buttonControlHeight.md, md: buttonControlHeight.sm },
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  highlight: { backgroundColor: theme.colors.interactionHighlight },
}));
