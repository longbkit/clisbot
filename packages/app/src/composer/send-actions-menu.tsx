import { preventHeldSendClick } from "./prevent-held-send-click";
import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import { ArrowUp, CornerDownLeft } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import {
  useCallback,
  useEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react";
import type { View, GestureResponderEvent } from "react-native";
import { useTranslation } from "react-i18next";
import { PressHighlight } from "@/components/ui/press-highlight";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  useContextMenu,
} from "@/components/ui/context-menu";
import { SendPressGate } from "./send-press-gate";

const ThemedQueue = withUnistyles(CornerDownLeft);
const ThemedSteer = withUnistyles(ArrowUp);
const QUEUE_ICON = <ThemedQueue size={16} uniProps={mutedIconColorMapping} />;
const STEER_ICON = <ThemedSteer size={16} uniProps={mutedIconColorMapping} />;

const SEND_MENU_DATA_SET = { sendActions: "longpress" };

type TriggerProps = Omit<ComponentProps<typeof PressHighlight>, "ref" | "children"> & {
  children?: ReactNode;
  triggerRef?: Ref<View | null>;
};
interface SendActionsProps extends TriggerProps {
  oneOffQueueAvailable?: boolean;
  onOneOffSend?: (action: "queue" | "steer") => void;
}

/** Same Send touch target: short tap sends, long press only opens the existing menu sheet. */
export function SendActionsButton({
  onOneOffSend,
  oneOffQueueAvailable = true,
  ...props
}: SendActionsProps) {
  const { t } = useTranslation();
  const queue = useCallback(() => onOneOffSend?.("queue"), [onOneOffSend]);
  const steer = useCallback(() => onOneOffSend?.("steer"), [onOneOffSend]);
  if (!onOneOffSend || props.disabled) {
    const { triggerRef, ...buttonProps } = props;
    return <PressHighlight {...buttonProps} ref={triggerRef} />;
  }
  return (
    <ContextMenu>
      <SendActionsTrigger {...props} queueAvailable={oneOffQueueAvailable} />
      <ContextMenuContent sheetTitle={t("composer.hostQueue.sendActions")}>
        <ContextMenuLabel>{t("composer.hostQueue.once")}</ContextMenuLabel>
        {oneOffQueueAvailable ? (
          <ContextMenuItem
            style={styles.touchRow}
            testID="composer-send-once-queue"
            leading={QUEUE_ICON}
            onSelect={queue}
          >
            {t("composer.hostQueue.queueOnce")}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          style={styles.touchRow}
          testID="composer-send-once-steer"
          leading={STEER_ICON}
          onSelect={steer}
        >
          {t("composer.hostQueue.steerOnce")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SendActionsTrigger({
  onPress,
  onPressIn,
  queueAvailable,
  ...props
}: TriggerProps & { queueAvailable: boolean }) {
  const { t } = useTranslation();
  const menu = useContextMenu();
  const gate = useRef(new SendPressGate());
  const releaseGuard = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseGuard.current?.(), []);
  const open = useCallback(() => {
    if (props.disabled) return;
    gate.current.openMenu();
    menu.setAnchorRect(null);
    menu.setOpen(true);
  }, [props.disabled, menu]);
  const openHeld = useCallback(() => {
    if (props.disabled) return;
    releaseGuard.current?.();
    releaseGuard.current = preventHeldSendClick();
    open();
  }, [props.disabled, open]);
  const accessibleOpen = useCallback<NonNullable<TriggerProps["onAccessibilityAction"]>>(
    (event) => {
      if (event.nativeEvent.actionName === "longpress") open();
    },
    [open],
  );
  const begin = useCallback(
    (event: GestureResponderEvent) => {
      gate.current.begin();
      onPressIn?.(event);
    },
    [onPressIn],
  );
  const contextOpen = useCallback(() => gate.current.openMenu(), []);
  const press = useCallback(
    (event: GestureResponderEvent) => {
      if (gate.current.takePrimary() && !menu.open) onPress?.(event);
    },
    [menu.open, onPress],
  );
  return (
    <ContextMenuTrigger
      {...props}
      dataSet={SEND_MENU_DATA_SET}
      accessibilityHint={t(
        queueAvailable ? "composer.hostQueue.longPressHint" : "composer.hostQueue.sendActions",
      )}
      accessibilityActions={[{ name: "longpress", label: t("composer.hostQueue.sendActions") }]}
      onAccessibilityAction={accessibleOpen}
      onPressIn={begin}
      onLongPress={openHeld}
      onContextMenu={contextOpen}
      onPress={press}
    />
  );
}

const styles = StyleSheet.create({
  touchRow: { minHeight: { xs: MIN_TOUCH_TARGET_SIZE, md: 28 } },
});
