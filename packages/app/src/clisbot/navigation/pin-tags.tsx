import { useCallback, useMemo, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ChipButton } from "@/components/ui/filter-chips";
import { CONTROL_HEIGHTS } from "@/components/ui/control-geometry";
import { SPACING } from "@/styles/theme";
import { PinMark } from "@/components/ui/pin-mark";
import { usePinnedRows, type PinRow } from "@/clisbot/bots/sidebar/use-pinned-rows";
import { rememberChatReturn } from "@/clisbot/home/mobile-navigation";
import { useBotCatalog } from "@/clisbot/bots/data/runtime";
import { useNavigationActivity } from "./activity";
import { resolveBotOwnership, resolveOwnership, type Ownership } from "./ownership";
import { fitPinTags, splitPinTags, type PinTag } from "./pin-tags-model";
import { useReaderAccounts } from "./reader";
import { HOME_PATH } from "./sections";
import { useNavigationStore } from "./store";

interface RowTag extends PinTag {
  row: PinRow;
}

function useRowOwnership() {
  const accounts = useReaderAccounts();
  const { workspaceAuthor } = useNavigationActivity();
  const { bots, chats } = useBotCatalog();
  return useCallback(
    (row: PinRow): Ownership => {
      if (row.kind === "bot") {
        const bot =
          bots.loadState.status === "loaded"
            ? bots.loadState.data.find(
                (entry) => entry.serverId === row.bot.serverId && entry.id === row.bot.botId,
              )
            : undefined;
        return resolveBotOwnership(bot ?? {}, accounts);
      }
      if (row.kind === "chat") {
        const chat =
          chats.loadState.status === "loaded"
            ? chats.loadState.data.find(
                (entry) => entry.serverId === row.chat.serverId && entry.id === row.chat.chatId,
              )
            : undefined;
        return resolveOwnership({ createdBy: chat?.record?.createdBy, accounts });
      }
      if (row.kind === "workspace" || row.kind === "session")
        return resolveOwnership({
          createdBy:
            (row.kind === "session" ? row.session.agent.createdBy : undefined) ??
            workspaceAuthor(row.workspace.serverId, row.workspace.workspaceId),
          accounts,
        });
      return "mine";
    },
    [accounts, bots.loadState, chats.loadState, workspaceAuthor],
  );
}

/**
 * Pins as tags on Home, the reader's first. They wrap onto at most two lines; `+N` at the end of
 * the second opens the rest below, and the last tag folds them back.
 */
export function HomePinTags() {
  const { t } = useTranslation();
  const tags = useHomePinTags();
  const open = useOpenPinTag();
  const [expanded, setExpanded] = useState(false);
  const fit = usePinTagFit(tags);
  const expand = useCallback(() => setExpanded(true), []);
  const collapse = useCallback(() => setExpanded(false), []);
  if (tags.length === 0) return null;
  const shown = expanded ? tags.length : (fit.count ?? tags.length);
  const hidden = tags.length - shown;
  const moreLabel = t("navigation.pins.more", { count: Math.max(hidden, 1) });
  return (
    <View style={styles.frame} onLayout={fit.onFrameLayout}>
      <PinTagMeasurer tags={tags} moreLabel={moreLabel} fit={fit} />
      <View style={[styles.wrap, !expanded && styles.twoLines]} testID="home-pin-tags">
        {tags.slice(0, shown).map((tag) => (
          <Tag key={tag.key} tag={tag} onPress={open} />
        ))}
        {hidden > 0 ? (
          <ChipButton label={moreLabel} onPress={expand} testID="home-pin-tags-more" />
        ) : null}
        {expanded && fit.count !== null && fit.count < tags.length ? (
          <ChipButton
            label={t("navigation.pins.less")}
            onPress={collapse}
            testID="home-pin-tags-less"
          />
        ) : null}
      </View>
    </View>
  );
}

/** Every pin tag in Home's mode, the reader's own first. */
function useHomePinTags(): RowTag[] {
  const { rows } = usePinnedRows();
  const ownershipOf = useRowOwnership();
  const mode = useNavigationStore((state) => state.homeMode);
  return useMemo(() => {
    const tags = rows.flatMap((row): RowTag[] =>
      row.kind === "unavailable"
        ? []
        : [
            {
              key: row.key,
              title: row.title,
              area: row.kind === "bot" || row.kind === "chat" ? "chat" : "work",
              ownership: ownershipOf(row),
              row,
            },
          ],
    );
    const { mine, others } = splitPinTags(tags, mode);
    return [...mine, ...others];
  }, [mode, ownershipOf, rows]);
}

function useOpenPinTag() {
  const router = useRouter();
  const { openBot } = usePinnedRows();
  return useCallback(
    (tag: RowTag) => {
      rememberChatReturn(HOME_PATH);
      if (tag.row.kind === "bot") void openBot(tag.row.bot.serverId, tag.row.bot.botId);
      else router.push(tag.row.route as Href);
    },
    [openBot, router],
  );
}

type PinTagFit = ReturnType<typeof usePinTagFit>;

/** Measured widths decide how many tags two lines hold; null until every width is known. */
function usePinTagFit(tags: readonly RowTag[]) {
  const [frame, setFrame] = useState(0);
  const [widths, setWidths] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [moreWidth, setMoreWidth] = useState(0);
  const onFrameLayout = useCallback(
    (event: LayoutChangeEvent) => setFrame(event.nativeEvent.layout.width),
    [],
  );
  const measure = useCallback((key: string, width: number) => {
    setWidths((current) => {
      if (current.get(key) === width) return current;
      return new Map(current).set(key, width);
    });
  }, []);
  const count = useMemo(() => {
    const measured = tags.map((tag) => widths.get(tag.key));
    if (!frame || !moreWidth || measured.some((width) => width === undefined)) return null;
    return fitPinTags(measured as number[], {
      width: frame - 2 * SPACING[3],
      gap: SPACING[2],
      moreWidth,
    });
  }, [frame, moreWidth, tags, widths]);
  return { count, onFrameLayout, measure, setMoreWidth };
}

/** The tags laid out on one hidden line, only to measure their widths. */
function PinTagMeasurer({
  tags,
  moreLabel,
  fit,
}: {
  tags: readonly RowTag[];
  moreLabel: string;
  fit: PinTagFit;
}) {
  const { measure, setMoreWidth } = fit;
  const measureMore = useCallback(
    (event: LayoutChangeEvent) => setMoreWidth(event.nativeEvent.layout.width),
    [setMoreWidth],
  );
  return (
    <View style={styles.measurer} pointerEvents="none" aria-hidden>
      {tags.map((tag) => (
        <MeasuredTag key={tag.key} tag={tag} onWidth={measure} />
      ))}
      <View onLayout={measureMore}>
        <ChipButton label={moreLabel} onPress={noop} />
      </View>
    </View>
  );
}

function MeasuredTag({
  tag,
  onWidth,
}: {
  tag: RowTag;
  onWidth: (key: string, width: number) => void;
}) {
  const layout = useCallback(
    (event: LayoutChangeEvent) => onWidth(tag.key, event.nativeEvent.layout.width),
    [onWidth, tag.key],
  );
  return (
    <View onLayout={layout}>
      <ChipButton label={tag.title} leading={pinMark} truncate onPress={noop} />
    </View>
  );
}

const noop = () => undefined;

function Tag({ tag, onPress }: { tag: RowTag; onPress: (tag: RowTag) => void }) {
  const press = useCallback(() => onPress(tag), [onPress, tag]);
  return (
    <ChipButton
      label={tag.title}
      leading={pinMark}
      truncate
      onPress={press}
      testID={`home-pin-tag-${tag.key}`}
    />
  );
}

const pinMark = <PinMark />;

const styles = StyleSheet.create((theme) => ({
  frame: { position: "relative", overflow: "hidden" },
  // The controls' inset (`section-controls.tsx`); one gap between tags and between lines.
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  // Two lines while collapsed, before the widths are measured too, so nothing jumps.
  twoLines: { maxHeight: 2 * CONTROL_HEIGHTS.tight + theme.spacing[2], overflow: "hidden" },
  measurer: { position: "absolute", top: 0, left: 0, flexDirection: "row", opacity: 0 },
}));
