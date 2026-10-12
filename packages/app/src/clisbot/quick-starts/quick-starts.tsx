import { useResourcePrincipalScope } from "@/clisbot/bots/data/resource-principal-scope";
import { View, Text } from "react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Pin, Plus } from "lucide-react-native";
import { SectionLink } from "@/clisbot/home/section-link";
import type { QuickStartInput, QuickStartView } from "@clisbot/protocol/quick-starts/types";
import { useQuickStarts } from "./use-quick-starts";
import { useQuickStartLibrary } from "./use-library";
import { QuickStartWindow } from "./library-window";
import { QuickStartActionTile, QuickStartRow } from "./row";
import { findDestination, type QuickStartDestination } from "./model";
import { styles } from "./styles";
export type { QuickStartDestination } from "./model";
interface Props {
  serverId: string;
  destinations: QuickStartDestination[];
  snapshot: () => QuickStartInput | null;
  onApply: (item: QuickStartInput) => void;
}
export function QuickStarts(props: Props) {
  const principal = useResourcePrincipalScope();
  return <ScopedQuickStarts key={`${props.serverId}:${principal}`} {...props} />;
}
function ScopedQuickStarts({ serverId, destinations, snapshot, onApply }: Props) {
  const source = useQuickStarts(serverId);
  const compact = useIsCompactFormFactor();
  const library = useQuickStartLibrary(source, snapshot, onApply, destinations);
  const { open, error, openLibrary, apply, create } = library;
  const items = source.data?.items ?? [];
  const pinned = (source.data?.preferences?.pinnedIds ?? []).flatMap(
    (id) => items.find((item) => item.id === id) ?? [],
  );
  if (!source.supported) return null;
  return (
    <View style={styles.section}>
      <SectionLink
        title="Quick start"
        accessibilityLabel="View all quick starts"
        onPress={openLibrary}
      />
      <PinnedGrid
        pinned={pinned}
        hasItems={items.length > 0}
        columns={compact ? 2 : 3}
        destinations={destinations}
        onApply={apply}
        onOpenLibrary={openLibrary}
        onCreate={create}
      />
      {error && !open ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <QuickStartWindow
        source={source}
        serverId={serverId}
        library={library}
        destinations={destinations}
        snapshot={snapshot}
        compact={compact}
      />
    </View>
  );
}

/** Pinned tiles; with none pinned, one tile in the first slot says how to fill the grid. */
function PinnedGrid({
  pinned,
  hasItems,
  columns,
  destinations,
  onApply,
  onOpenLibrary,
  onCreate,
}: {
  pinned: QuickStartView[];
  hasItems: boolean;
  columns: number;
  destinations: QuickStartDestination[];
  onApply: (item: QuickStartView) => void;
  onOpenLibrary: () => void;
  onCreate: () => void;
}) {
  const empty = hasItems ? (
    <QuickStartActionTile
      Icon={Pin}
      title="Pin a quick start"
      detail="Keep it on Home"
      accessibilityLabel="Pin a quick start to Home"
      onPress={onOpenLibrary}
    />
  ) : (
    <QuickStartActionTile
      Icon={Plus}
      title="New quick start"
      detail="Reuse a prompt"
      accessibilityLabel="Create a quick start"
      onPress={onCreate}
    />
  );
  const rows = tileRows(pinned, columns);
  return (
    <View style={styles.grid}>
      {rows.length ? (
        rows.map((row) => (
          <View key={row.map((item) => item.id).join(":")} style={styles.gridRow}>
            {row.map((item) => (
              <QuickStartRow
                key={item.id}
                item={item}
                tile
                destination={findDestination(destinations, item.target)}
                onApply={onApply}
              />
            ))}
            <Spacers count={columns - row.length} />
          </View>
        ))
      ) : (
        <View style={styles.gridRow}>
          {empty}
          <Spacers count={columns - 1} />
        </View>
      )}
    </View>
  );
}
function Spacers({ count }: { count: number }) {
  return SPACER_KEYS.slice(0, count).map((key) => <View key={key} style={styles.tileSpacer} />);
}

/** Pinned tiles fill at most two rows of `columns`; the caller pads a short last row. */
function tileRows<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (const item of items.slice(0, columns * 2)) {
    const last = rows.at(-1);
    if (last && last.length < columns) last.push(item);
    else rows.push([item]);
  }
  return rows;
}
/** Keys for the empty slots that keep a short last row's tiles at column width. */
const SPACER_KEYS = ["slot-1", "slot-2", "slot-3"];
