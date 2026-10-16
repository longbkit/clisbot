import { useCallback, useEffect, useMemo } from "react";
import type { GestureResponderEvent, PressableProps } from "react-native";
import { nativePerformanceTrace, traceInstant } from "@/performance/native-trace";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "./header-toggle-button";
import {
  iconButtonChromeGlyphSize,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import type { ShortcutKey } from "@/utils/format-shortcut";

const ThemedArrowLeft = withUnistyles(ArrowLeft);
const NO_SHORTCUT: ShortcutKey[] = [];
let nextTraceId = 0;

function backTraceProps(
  id: string | undefined,
): Pick<
  PressableProps,
  "onTouchStart" | "onTouchEnd" | "onTouchCancel" | "onPressIn" | "onPressOut" | "onLayout"
> {
  if (!id) return {};
  const touch = (phase: string) => (event: GestureResponderEvent) => {
    const e = event.nativeEvent;
    traceInstant(`clisbot.back.${phase}`, {
      id,
      ms: String(e.timestamp),
      x: String(e.pageX),
      y: String(e.pageY),
      tag: String(e.target),
    });
  };
  return {
    onTouchStart: touch("touchStart"),
    onTouchEnd: touch("touchEnd"),
    onTouchCancel: touch("touchCancel"),
    onPressIn: touch("pressIn"),
    onPressOut: touch("pressOut"),
    onLayout: (event) => {
      const { x, y, width, height } = event.nativeEvent.layout;
      traceInstant("clisbot.back.layout", {
        id,
        x: String(x),
        y: String(y),
        w: String(width),
        h: String(height),
      });
      event.currentTarget.measureInWindow((left, top, w, h) => {
        traceInstant("clisbot.back.bounds", {
          id,
          x: String(left),
          y: String(top),
          w: String(w),
          h: String(h),
        });
      });
    },
  };
}

export function HeaderBackButton({
  onBack,
  testID = "header-back-button",
}: {
  onBack?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const traceId = useMemo(
    () => (nativePerformanceTrace.isEnabled() ? `b${++nextTraceId}` : undefined),
    [],
  );
  const traceProps = useMemo(() => backTraceProps(traceId), [traceId]);
  useEffect(() => {
    if (!traceId) return;
    traceInstant("clisbot.back.mount", { id: traceId });
    return () => traceInstant("clisbot.back.unmount", { id: traceId });
  }, [traceId]);
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (traceId)
        traceInstant("clisbot.back.headerEnter", {
          id: traceId,
          ms: String(event.nativeEvent.timestamp),
        });
      if (onBack) onBack();
      else router.back();
      if (traceId) traceInstant("clisbot.back.headerReturn", { id: traceId });
    },
    [onBack, traceId],
  );
  return (
    <HeaderToggleButton
      {...traceProps}
      onPress={handlePress}
      tooltipLabel={t("common.actions.back")}
      tooltipKeys={NO_SHORTCUT}
      tooltipSide="right"
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t("common.actions.back")}
    >
      <ThemedArrowLeft
        size={iconButtonChromeGlyphSize("large")}
        strokeWidth={1.5}
        uniProps={mutedIconColorMapping}
      />
    </HeaderToggleButton>
  );
}
