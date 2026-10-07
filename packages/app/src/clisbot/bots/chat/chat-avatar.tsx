import { useMemo } from "react";
import { View } from "react-native";
import { Hash } from "lucide-react-native";
import { projectIconRadius } from "@/components/project-icon-view";
import { deriveIdentityColorName, identityColor, identityTint } from "@/styles/identity-colors";
import { BotFace } from "./bot-face";

/**
 * The mark of a conversation: a Group chat is a `#` on its own identity colour, a direct chat is
 * its Bot's face. Same shape as `BotFace` and a project icon, so the sidebar row and the chat
 * heading show one mark for one conversation.
 */
export function ChatAvatar({
  chatId,
  group,
  bot,
  size = 20,
}: {
  chatId: string;
  group: boolean;
  bot?: { botId: string; name: string; avatar?: string | null } | null;
  size?: number;
}) {
  if (!group && bot) {
    return <BotFace botId={bot.botId} name={bot.name} avatar={bot.avatar} size={size} />;
  }
  return <GroupMark chatId={chatId} size={size} />;
}

function GroupMark({ chatId, size }: { chatId: string; size: number }) {
  const colorName = deriveIdentityColorName(chatId);
  const frame = useMemo(
    () => ({
      width: size,
      height: size,
      borderRadius: projectIconRadius(size),
      backgroundColor: identityTint(colorName),
      alignItems: "center" as const,
      justifyContent: "center" as const,
      flexShrink: 0,
    }),
    [colorName, size],
  );
  return (
    <View style={frame} testID={`chat-avatar-${chatId}`}>
      <Hash size={Math.round(size * 0.6)} color={identityColor(colorName)} strokeWidth={2.25} />
    </View>
  );
}
