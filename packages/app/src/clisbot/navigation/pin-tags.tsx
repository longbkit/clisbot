import { useCallback, useMemo } from "react";
import { ScrollView, Text, type PressableStateCallbackType } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { PressHighlight } from "@/components/ui/press-highlight";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Pin } from "lucide-react-native";
import { usePinnedRows, type PinRow } from "@/clisbot/bots/sidebar/use-pinned-rows";
import { rememberChatReturn } from "@/clisbot/home/mobile-navigation";
import { useBotCatalog } from "@/clisbot/bots/data/runtime";
import { useNavigationActivity } from "./activity";
import { resolveBotOwnership, resolveOwnership, type Ownership } from "./ownership";
import { splitPinTags, type PinTag } from "./pin-tags-model";
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
          createdBy: workspaceAuthor(row.workspace.serverId, row.workspace.workspaceId),
          accounts,
        });
      return "mine";
    },
    [accounts, bots.loadState, chats.loadState, workspaceAuthor],
  );
}

/** Pins as tags on Home; only the reader's by default, others behind `+N · Show`. */
export function HomePinTags() {
  const { t } = useTranslation();
  const router = useRouter();
  const { rows, openBot } = usePinnedRows();
  const ownershipOf = useRowOwnership();
  const mode = useNavigationStore((state) => state.homeMode);
  const showOthers = useNavigationStore((state) => state.showOthersPins);
  const setShowOthers = useNavigationStore((state) => state.setShowOthersPins);
  const { mine, others } = useMemo(() => {
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
    return splitPinTags(tags, mode);
  }, [mode, ownershipOf, rows]);
  const open = useCallback(
    (tag: RowTag) => {
      rememberChatReturn(HOME_PATH);
      if (tag.row.kind === "bot") void openBot(tag.row.bot.serverId, tag.row.bot.botId);
      else router.push(tag.row.route as Href);
    },
    [openBot, router],
  );
  const toggleOthers = useCallback(() => setShowOthers(!showOthers), [setShowOthers, showOthers]);
  if (mine.length === 0 && others.length === 0) return null;
  const shown = showOthers ? [...mine, ...others] : mine;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      testID="home-pin-tags"
    >
      {shown.map((tag) => (
        <Tag key={tag.key} tag={tag} onPress={open} />
      ))}
      {others.length > 0 ? (
        <PressHighlight
          accessibilityRole="button"
          onPress={toggleOthers}
          hitSlop={TAG_HIT_SLOP}
          style={tagStyle}
          testID="home-pin-tags-others"
        >
          <Text style={styles.muted}>
            {showOthers
              ? t("navigation.pins.hideOthers")
              : t("navigation.pins.showOthers", { count: others.length })}
          </Text>
        </PressHighlight>
      ) : null}
    </ScrollView>
  );
}

function Tag({ tag, onPress }: { tag: RowTag; onPress: (tag: RowTag) => void }) {
  const press = useCallback(() => onPress(tag), [onPress, tag]);
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={tag.title}
      onPress={press}
      hitSlop={TAG_HIT_SLOP}
      style={tagStyle}
      testID={`home-pin-tag-${tag.key}`}
    >
      <ThemedPin size={11} />
      <Text style={styles.label} numberOfLines={1}>
        {tag.title}
      </Text>
    </PressHighlight>
  );
}

/** Tags stay compact; the press area reaches 44pt. */
const TAG_HIT_SLOP = { top: 10, bottom: 10, left: 2, right: 2 };

const ThemedPin = withUnistyles(Pin, (theme) => ({ color: theme.colors.foregroundMuted }));

function tagStyle({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.tag, (pressed || hovered) && styles.tagHovered];
}

const styles = StyleSheet.create((theme) => ({
  row: { gap: theme.spacing[2], paddingHorizontal: theme.spacing[4] },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    maxWidth: 200,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  tagHovered: { backgroundColor: theme.colors.surface2 },
  label: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, flexShrink: 1 },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
