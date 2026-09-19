import { MoreHorizontal } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buttonControlHeight, buttonIconSize } from "@/components/ui/control-geometry";
import type { MenuTriggerState } from "@/components/ui/menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { Theme } from "@/styles/theme";

const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
function triggerStyle({ hovered, pressed, open }: MenuTriggerState) {
  return [styles.trigger, (hovered || pressed || open) && styles.highlight];
}

/** Infrequent actions share Paseo's menu presentation and confirmation handoff. */
export interface ChannelMenuAction {
  label: string;
  onSelect(): void;
}

export function ChannelActionsMenu({
  label,
  disabled,
  actions = [],
  remove,
}: {
  label: string;
  disabled: boolean;
  /** Listed first; Remove, when offered, stays last and apart. */
  actions?: readonly ChannelMenuAction[];
  remove?: () => void;
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
          <DropdownMenuItem key={action.label} disabled={disabled} onSelect={action.onSelect}>
            {action.label}
          </DropdownMenuItem>
        ))}
        {remove === undefined ? null : (
          <DropdownMenuItem disabled={disabled} onSelect={remove}>
            Remove
          </DropdownMenuItem>
        )}
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
