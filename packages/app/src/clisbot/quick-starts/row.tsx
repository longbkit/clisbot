import { useCallback } from "react";
import { View, Text, Pressable, type PressableStateCallbackType } from "react-native";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { QuickStartView } from "@clisbot/protocol/quick-starts/types";
import type { QuickStartDestination } from "./model";
import { styles } from "./styles";
export function QuickStartRow({
  item,
  destination,
  pinned,
  tile,
  onApply,
  onMenu,
  menuOpen,
  onAction,
  disabled,
  mine,
}: {
  item: QuickStartView;
  destination?: QuickStartDestination;
  pinned?: boolean;
  tile?: boolean;
  onApply: (item: QuickStartView) => void;
  onMenu?: (item: QuickStartView | null) => void;
  menuOpen?: boolean;
  disabled?: boolean;
  mine?: boolean;
  onAction?: (action: QuickStartAction, item: QuickStartView) => void;
}) {
  const apply = useCallback(() => onApply(item), [item, onApply]);
  const menu = useCallback((open: boolean) => onMenu?.(open ? item : null), [item, onMenu]);
  const act = useCallback((action: QuickStartAction) => onAction?.(action, item), [onAction, item]);
  if (tile)
    return (
      <Pressable
        onPress={apply}
        style={tileStyle}
        accessibilityRole="button"
        accessibilityLabel={item.name}
      >
        <View>{destination?.avatar}</View>
        <View style={styles.grow}>
          <Text numberOfLines={1} style={styles.text}>
            {item.name}
          </Text>
          <Text numberOfLines={1} style={styles.detail}>
            {describeTarget(item, destination)}
          </Text>
        </View>
      </Pressable>
    );
  return (
    <View style={styles.libraryRow}>
      <Pressable
        style={styles.use}
        onPress={apply}
        accessibilityRole="button"
        accessibilityLabel={item.name}
      >
        <View>{destination?.avatar}</View>
        <View style={styles.grow}>
          <Text style={styles.text}>{item.name}</Text>
          <Text numberOfLines={1} style={styles.detail}>
            {mine && item.visibility === "host" ? "Shared · " : ""}
            {describeTarget(item, destination)}
          </Text>
        </View>
      </Pressable>
      <DropdownMenu compactMode="sheet" open={menuOpen} onOpenChange={menu}>
        <DropdownMenuTrigger
          accessibilityRole="button"
          accessibilityLabel={`Actions for ${item.name}`}
          style={styles.more}
          disabled={disabled}
        >
          <MoreIcon size={18} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sheetTitle={item.name}>
          <QuickStartMenu item={item} pinned={!!pinned} disabled={!!disabled} onAction={act} />
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}
/** One line under a Quick start's name: where it opens, and a fresh worktree when it makes one. */
export function describeTarget(item: QuickStartView, destination?: QuickStartDestination): string {
  const label = destination?.option.label ?? "Unavailable destination";
  const worktree = item.target.kind === "project" && item.target.workspace.kind === "worktree";
  return worktree ? `${label} · New worktree` : label;
}
const tileStyle = ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
  styles.tile,
  (hovered || pressed) && styles.tileHovered,
];
export type QuickStartAction = "pin" | "first" | "duplicate" | "edit" | "share" | "delete";
function MenuAction({
  id,
  label,
  disabled,
  onAction,
}: {
  id: QuickStartAction;
  label: string;
  disabled?: boolean;
  onAction: (action: QuickStartAction) => void;
}) {
  const press = useCallback(() => onAction(id), [id, onAction]);
  return (
    <DropdownMenuItem onSelect={press} disabled={disabled} destructive={id === "delete"}>
      {label}
    </DropdownMenuItem>
  );
}
export function QuickStartMenu({
  item,
  pinned,
  disabled,
  onAction,
}: {
  item: QuickStartView;
  pinned: boolean;
  disabled: boolean;
  onAction: (action: QuickStartAction) => void;
}) {
  return (
    <>
      <MenuAction
        id="pin"
        label={pinned ? "Unpin from Home" : "Pin to Home"}
        disabled={disabled}
        onAction={onAction}
      />
      {pinned ? (
        <MenuAction id="first" label="Move to first" disabled={disabled} onAction={onAction} />
      ) : null}
      <MenuAction id="duplicate" label="Duplicate to mine" onAction={onAction} />
      {item.canEdit ? (
        <>
          <MenuAction id="edit" label="Edit" onAction={onAction} />
          <MenuAction
            id="share"
            label={item.visibility === "host" ? "Stop sharing" : "Share on this Host"}
            disabled={disabled}
            onAction={onAction}
          />
          <MenuAction id="delete" label="Delete" disabled={disabled} onAction={onAction} />
        </>
      ) : null}
    </>
  );
}

const MoreIcon = withUnistyles(MoreHorizontal, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

/** A tile-shaped action in the Home grid, so an empty grid still reads as quick starts. */
export function QuickStartActionTile({
  Icon,
  title,
  detail,
  accessibilityLabel,
  onPress,
}: {
  Icon: typeof MoreHorizontal;
  title: string;
  detail: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={tileStyle}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.actionGlyph}>
        <ActionIcon Icon={Icon} size={14} />
      </View>
      <View style={styles.grow}>
        <Text numberOfLines={1} style={styles.text}>
          {title}
        </Text>
        <Text numberOfLines={1} style={styles.detail}>
          {detail}
        </Text>
      </View>
    </Pressable>
  );
}
function TileIcon({
  Icon,
  size,
  color,
}: {
  Icon: typeof MoreHorizontal;
  size: number;
  color?: string;
}) {
  return <Icon size={size} color={color} />;
}
const ActionIcon = withUnistyles(TileIcon, (theme) => ({ color: theme.colors.foregroundMuted }));
