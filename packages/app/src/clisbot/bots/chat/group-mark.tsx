import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { UsersRound } from "lucide-react-native";
import { projectIconRadius } from "@/components/project-icon-view";
import { deriveIdentityColorName, type IdentityColorName } from "@/styles/identity-colors";
import { botInitials, GlossyFill, GlossyMark } from "./bot-face";

export interface GroupMarkMember {
  botId: string;
  name: string;
  avatar?: string | null;
}

export interface MosaicCell {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Absent for the overflow cell, which shows `+N` on the chat's own colour. */
  member?: GroupMarkMember;
  overflow?: number;
}

/** Below this a cell is colour only; a letter would be a smudge. */
const MIN_GLYPH_CELL = 12;

/**
 * A Group chat's mark: its members' faces tiled into one rounded square, as messaging apps draw a
 * group — one Bot fills it, two split it, three take a half and two quarters, four and more
 * quarter it with `+N` in the last cell. With no members known it falls back to a people glyph
 * on the chat's own identity colour.
 */
export function GroupMark({
  chatId,
  members,
  size,
}: {
  chatId: string;
  members: readonly GroupMarkMember[];
  size: number;
}) {
  const chatColor = deriveIdentityColorName(chatId);
  const cells = useMemo(() => mosaicCells(members, size), [members, size]);
  const radius = projectIconRadius(size);
  const frameStyle = useMemo(
    () => [styles.frame, { width: size, height: size, borderRadius: radius }],
    [size, radius],
  );
  if (cells.length === 0) {
    return (
      <GlossyMark colorName={chatColor} size={size} testID={`chat-avatar-${chatId}`}>
        <UsersRound size={Math.round(size * 0.55)} color="#ffffff" strokeWidth={2.25} />
      </GlossyMark>
    );
  }
  return (
    <View style={frameStyle} testID={`chat-avatar-${chatId}`}>
      {cells.map((cell) => (
        <MosaicTile key={cell.member?.botId ?? "overflow"} cell={cell} chatColor={chatColor} />
      ))}
      <View style={[styles.rim, { borderRadius: radius }]} pointerEvents="none" />
    </View>
  );
}

function MosaicTile({ cell, chatColor }: { cell: MosaicCell; chatColor: IdentityColorName }) {
  const colorName = cell.member ? deriveIdentityColorName(cell.member.botId) : chatColor;
  const extent = Math.min(cell.width, cell.height);
  const tileStyle = useMemo(
    () => [styles.tile, { left: cell.left, top: cell.top, width: cell.width, height: cell.height }],
    [cell.left, cell.top, cell.width, cell.height],
  );
  const glyphStyle = useMemo(
    () => [styles.glyph, { fontSize: Math.round(extent * (cell.member ? 0.5 : 0.42)) }],
    [extent, cell.member],
  );
  const glyph = cell.member
    ? cell.member.avatar?.trim() || botInitials(cell.member.name).charAt(0)
    : `+${cell.overflow}`;
  return (
    <View style={tileStyle}>
      <GlossyFill colorName={colorName} width={cell.width} height={cell.height} />
      {extent >= MIN_GLYPH_CELL ? (
        <Text style={glyphStyle} numberOfLines={1}>
          {glyph}
        </Text>
      ) : null}
    </View>
  );
}

/** Tile rectangles in points, members in Members order, a 1pt seam between tiles. */
export function mosaicCells(members: readonly GroupMarkMember[], size: number): MosaicCell[] {
  const seam = 1;
  const half = (size - seam) / 2;
  const far = half + seam;
  if (members.length === 0) return [];
  if (members.length === 1)
    return [{ left: 0, top: 0, width: size, height: size, member: members[0] }];
  const leftColumn = { left: 0, top: 0, width: half, height: size, member: members[0] };
  if (members.length === 2) {
    return [leftColumn, { left: far, top: 0, width: half, height: size, member: members[1] }];
  }
  const topRight = { left: far, top: 0, width: half, height: half, member: members[1] };
  if (members.length === 3) {
    return [
      leftColumn,
      topRight,
      { left: far, top: far, width: half, height: half, member: members[2] },
    ];
  }
  const overflow = members.length > 4 ? members.length - 3 : 0;
  return [
    { left: 0, top: 0, width: half, height: half, member: members[0] },
    topRight,
    { left: 0, top: far, width: half, height: half, member: members[2] },
    overflow > 0
      ? { left: far, top: far, width: half, height: half, overflow }
      : { left: far, top: far, width: half, height: half, member: members[3] },
  ];
}

// White on every theme: the identity fills are held to one contrast band against a white letter.
const styles = StyleSheet.create((theme) => ({
  frame: { overflow: "hidden", flexShrink: 0 },
  tile: {
    position: "absolute",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  rim: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
  },
  glyph: {
    color: "#ffffff",
    fontWeight: theme.fontWeight.semibold,
    lineHeight: undefined,
  },
}));
