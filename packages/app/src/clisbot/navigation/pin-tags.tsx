import { useCallback, useMemo } from "react";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ChipButton, ChipRow } from "@/components/ui/filter-chips";
import { PinMark } from "@/components/ui/pin-mark";
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
    <ChipRow contentStyle={styles.row} testID="home-pin-tags">
      {shown.map((tag) => (
        <Tag key={tag.key} tag={tag} onPress={open} />
      ))}
      {others.length > 0 ? (
        <ChipButton
          label={
            showOthers
              ? t("navigation.pins.hideOthers")
              : t("navigation.pins.showOthers", { count: others.length })
          }
          onPress={toggleOthers}
          testID="home-pin-tags-others"
        />
      ) : null}
    </ChipRow>
  );
}

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
  row: { flexDirection: "row", gap: theme.spacing[2] },
}));
