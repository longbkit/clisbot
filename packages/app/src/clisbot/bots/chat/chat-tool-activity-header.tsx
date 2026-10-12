import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ToolCallSheetProvider } from "@/components/tool-call-sheet";
import type { ToolCallPresentationIcon } from "@/tool-calls/presentation";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { renderLiveItem } from "./chat-live-item";
import { botIdentity } from "./chat-rows";
import {
  toolActivityCountLabel,
  toolActivityLatestLabel,
  toolActivityPresentation,
} from "./chat-tool-activity-bar";
import type { BotToolActivity } from "./tool-activity";
import type { ChatToolActivityHeader } from "./tool-activity-context";

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const dangerMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });
const ThemedSpinner = withUnistyles(LoadingSpinner, mutedMapping);

/**
 * The `header` tool call display: the subtitle names the running call (and its Bot in a group),
 * or, once every turn ended, keeps the Host and the last turn's count. Pressing it opens the
 * turns' calls: a popover on wide screens, a sheet on compact ones.
 */
export function ChatToolActivityHeaderLine({
  header,
  context,
}: {
  header: ChatToolActivityHeader;
  /** The subtitle the header shows without tool activity: the Host, or a group's members. */
  context: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const top = header.activities[0];
  if (!top) return null;
  const bot = botIdentity(header.bots, top.botId);
  const presentation = toolActivityPresentation(top.activity.latest, bot.cwd);
  const count = toolActivityCountLabel(t, top.activity);
  const latest = toolActivityLatestLabel(presentation);
  const running = top.turnActive;
  const lead = running ? `${header.group ? `${bot.name} · ` : ""}${latest}` : context;
  const trailing = running ? count : (count ?? latest);
  return (
    <DropdownMenu compactMode="sheet" open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        accessibilityLabel={`${t("bots.chat.toolActivity.show")}: ${lead}${trailing ? `, ${trailing}` : ""}`}
        testID="chat-tool-activity-header"
        style={styles.trigger}
      >
        <ActivityGlyph
          running={top.activity.running}
          failed={top.activity.failedCount > 0}
          icon={presentation.icon}
        />
        <Text numberOfLines={1} style={styles.lead}>
          {lead}
        </Text>
        {trailing ? (
          <Text
            numberOfLines={1}
            style={[styles.trailing, top.activity.failedCount > 0 && styles.failed]}
          >
            {` · ${trailing}`}
          </Text>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        sheetTitle={t("bots.chat.toolActivity.label")}
        align="start"
        width={440}
        maxHeight={520}
        scrollable
        testID="chat-tool-activity-details"
      >
        <ToolCallSheetProvider>
          {header.activities.map((entry, index) => (
            <ToolActivitySection
              key={entry.botId}
              entry={entry}
              header={header}
              separated={index > 0}
            />
          ))}
        </ToolCallSheetProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ActivityGlyph({
  running,
  failed,
  icon,
}: {
  running: boolean;
  failed: boolean;
  icon: ToolCallPresentationIcon;
}) {
  const Icon = useMemo(
    () => withUnistyles(icon, failed ? dangerMapping : mutedMapping),
    [icon, failed],
  );
  if (running) return <ThemedSpinner size="small" style={styles.glyph} />;
  return (
    <View style={styles.glyph}>
      <Icon size={12} />
    </View>
  );
}

/** One Bot's latest turn: its name and state, then the same rows the transcript would show. */
function ToolActivitySection({
  entry,
  header,
  separated,
}: {
  entry: BotToolActivity;
  header: ChatToolActivityHeader;
  separated: boolean;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(header.serverId);
  const bot = botIdentity(header.bots, entry.botId);
  const state = entry.turnActive
    ? t("bots.chat.toolActivity.running")
    : t("bots.chat.toolActivity.lastTurn");
  const count = toolActivityCountLabel(t, entry.activity);
  const { items } = entry.activity;
  return (
    <>
      {separated ? <DropdownMenuSeparator /> : null}
      <DropdownMenuLabel numberOfLines={1}>
        {[bot.name, state, count].filter(Boolean).join(" · ")}
      </DropdownMenuLabel>
      <View style={styles.rows}>
        {items.map((item, index) =>
          renderLiveItem(item, header.serverId, index === items.length - 1, bot, client, true),
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
    flexShrink: 1,
    gap: theme.spacing[1],
  },
  glyph: { width: 12, height: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  lead: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  trailing: {
    flexShrink: 0,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  failed: { color: theme.colors.statusDanger },
  rows: { paddingHorizontal: theme.spacing[2], paddingBottom: theme.spacing[2] },
}));
