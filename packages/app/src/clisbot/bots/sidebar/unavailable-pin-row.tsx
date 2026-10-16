import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, MessageSquare } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import type { Rect } from "@/components/ui/anchor";
import { BotsSidebarRow } from "./row";
import { PinOptionsMenu } from "./pin-options";
import { pinAction } from "../chat/chat-resource-actions";
import type { ResourcePin } from "./pins";

/** Persisted identity only: no previous-admission name, avatar, status or private action. */
export function UnavailablePinRow({
  pin,
  onUnpin,
}: {
  pin: ResourcePin;
  onUnpin: (pin: ResourcePin) => void;
}) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const unpin = useCallback(() => {
    onUnpin(pin);
    close();
  }, [onUnpin, pin, close]);
  const unpinLabel = t("bots.chat.actions.unpin");
  const actions = useMemo(() => [{ ...pinAction(true), label: unpinLabel }], [unpinLabel]);
  const title = pin.kind === "bot" ? t("bots.workspace.shared.bot") : t("bots.chat.common.chat");
  const unavailable = t("common.states.unavailable");
  return (
    <>
      <BotsSidebarRow
        title={title}
        subtitle={unavailable}
        statusLabel={unavailable}
        selected={false}
        disabled
        leading={pin.kind === "bot" ? botMark : chatMark}
        testID={`sidebar-unavailable-pin-${pin.kind}:${pin.serverId}:${pin.id}`}
        onOpenMenu={setAnchor}
        menuLabel={t("bots.workspace.sidebar.pinnedItemOptions")}
      />
      <PinOptionsMenu
        visible={anchor !== null}
        anchor={anchor ?? undefined}
        title={title}
        actions={actions}
        onSelect={unpin}
        onClose={close}
      />
    </>
  );
}
const BotMark = withUnistyles(Bot),
  ChatMark = withUnistyles(MessageSquare);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const botMark = <BotMark size={20} uniProps={mutedColor} />;
const chatMark = <ChatMark size={20} uniProps={mutedColor} />;
