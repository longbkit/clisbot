import { MoreHorizontal, Trash2, type LucideIcon } from "lucide-react-native";
import { useMemo } from "react";
import type { GestureResponderEvent } from "react-native";
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
function PlainMenuIcon({ icon: Icon, color }: { icon: LucideIcon; color?: string }) {
  return <Icon size={14} color={color} />;
}
const MenuIcon = withUnistyles(PlainMenuIcon);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
// The menu can sit inside a row that presses (a Route row opens its editor).
function keepPressInMenu(event: GestureResponderEvent) {
  event.stopPropagation();
}
function triggerStyle({ hovered, pressed, open }: MenuTriggerState) {
  return [styles.trigger, (hovered || pressed || open) && styles.highlight];
}

/** Infrequent actions share Clisbot's menu presentation and confirmation handoff. */
export interface ChannelMenuAction {
  label: string;
  /** Every item carries one, so the labels share a rail. */
  icon: LucideIcon;
  onSelect(): void;
}

/** One item, its icon on the menu's leading rail. */
function ChannelMenuItem({
  label,
  icon,
  onSelect,
  disabled,
}: ChannelMenuAction & { disabled: boolean }) {
  const leading = useMemo(() => <MenuIcon icon={icon} uniProps={mutedColor} />, [icon]);
  return (
    <DropdownMenuItem disabled={disabled} leading={leading} onSelect={onSelect}>
      {label}
    </DropdownMenuItem>
  );
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
        onPressIn={keepPressInMenu}
        style={triggerStyle}
      >
        <ThemedMoreHorizontal size={buttonIconSize[compact ? "md" : "sm"]} uniProps={mutedColor} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sheetTitle={label}>
        {actions.map((action) => (
          <ChannelMenuItem
            key={action.label}
            label={action.label}
            icon={action.icon}
            onSelect={action.onSelect}
            disabled={disabled}
          />
        ))}
        {remove === undefined ? null : (
          <ChannelMenuItem label="Remove" icon={Trash2} onSelect={remove} disabled={disabled} />
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
