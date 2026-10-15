import { useCallback, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/i18next";
import { useChatOptionsState } from "./chat-options-context";
import { ChatToolActivityHeaderLine } from "./chat-tool-activity-header";
import { useChatToolActivityHeader } from "./tool-activity-context";

export function conversationHeaderSummary(
  group: boolean,
  members: number,
  hostName: string,
  tabs: number,
) {
  return {
    context: group ? i18n.t("bots.chat.header.members", { count: members }) : hostName,
    tabs: i18n.t("bots.chat.header.tabs", { count: tabs }),
  };
}

export function ConversationHeading({
  avatar,
  title,
  group,
  memberCount,
  hostName,
  tabCount,
  onPress,
  expanded,
}: {
  /** The conversation's mark, the same one its sidebar row shows. */
  avatar: ReactNode;
  title: string;
  group: boolean;
  memberCount: number;
  hostName: string;
  tabCount: number;
  /** Compact conversation identities open the existing tab sheet instead of Chat options. */
  onPress?: () => void;
  expanded?: boolean;
}) {
  const { t } = useTranslation();
  const { visible, setVisible } = useChatOptionsState();
  const openOptions = useCallback(() => setVisible(true), [setVisible]);
  const open = onPress ?? openOptions;
  const isExpanded = expanded ?? visible;
  const toolActivity = useChatToolActivityHeader();
  const summary = conversationHeaderSummary(group, memberCount, hostName, tabCount);
  const accessibilityLabel = onPress
    ? `${title}. ${t("workspace.tabs.switcher.trigger", { count: tabCount })}`
    : t("bots.chat.header.accessibilityLabel", { title, ...summary });
  // Clisbot: the `header` tool call display takes the subtitle while a Bot's turn used tools.
  if (toolActivity?.activities.length)
    return (
      <HeadingWithToolActivity
        avatar={avatar}
        title={title}
        accessibilityLabel={accessibilityLabel}
        expanded={isExpanded}
        open={open}
      >
        <ChatToolActivityHeaderLine header={toolActivity} context={summary.context} />
      </HeadingWithToolActivity>
    );
  return (
    <Pressable
      onPress={open}
      style={styles.heading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      aria-expanded={isExpanded}
      testID="conversation-header-details"
    >
      {avatar}
      <View style={styles.text}>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        <View style={styles.summary}>
          <Text numberOfLines={1} style={styles.context}>
            {summary.context}
          </Text>
          <Text style={styles.tabCount}> · {summary.tabs}</Text>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The heading with the tool activity line as its subtitle. The line is a trigger of its own, so
 * the mark and the title keep opening the chat options beside it rather than around it.
 */
function HeadingWithToolActivity({
  avatar,
  title,
  accessibilityLabel,
  expanded,
  open,
  children,
}: {
  avatar: ReactNode;
  title: string;
  accessibilityLabel: string;
  expanded: boolean;
  open: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.heading}>
      <Pressable onPress={open} accessible={false} focusable={false}>
        {avatar}
      </Pressable>
      <View style={styles.text}>
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          aria-expanded={expanded}
          testID="conversation-header-details"
        >
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
        </Pressable>
        {children}
      </View>
    </View>
  );
}

// Title and summary read as the conversation's sidebar row: `foreground` medium over
// `foregroundExtraMuted` metadata, beside the same mark.
const styles = StyleSheet.create((theme) => ({
  heading: {
    flexShrink: 1,
    minWidth: 0,
    minHeight: { xs: 48, md: 32 },
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  text: { flexShrink: 1, minWidth: 0, justifyContent: "center" },
  title: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 18,
  },
  summary: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  context: {
    flexShrink: 1,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  tabCount: {
    flexShrink: 0,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
}));
