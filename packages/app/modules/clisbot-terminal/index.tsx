import { requireNativeView } from "expo";
import { useCallback, useMemo } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import type {
  ClisbotTerminalCellMetrics,
  ClisbotTerminalFrame,
  ClisbotTerminalTheme,
} from "./contract";
import { encodeTerminalCustomGlyphs, type ClisbotTerminalCustomGlyph } from "./custom-glyphs";
import { encodeTerminalFrame, type NativeClisbotTerminalFrame } from "./frame-encoding";

export * from "./contract";

export interface ClisbotTerminalViewProps {
  frame: ClisbotTerminalFrame;
  theme: ClisbotTerminalTheme;
  fontFamily: string;
  /** Font size in points after the system font scale is applied. */
  fontSize: number;
  onCellMetrics?: (metrics: ClisbotTerminalCellMetrics) => void;
  style?: StyleProp<ViewStyle>;
}

interface NativeClisbotTerminalViewProps extends Omit<
  ClisbotTerminalViewProps,
  "frame" | "onCellMetrics"
> {
  frame: NativeClisbotTerminalFrame;
  customGlyphs: ClisbotTerminalCustomGlyph[];
  onCellMetrics?: (event: { nativeEvent: ClisbotTerminalCellMetrics }) => void;
}

const NativeClisbotTerminalView =
  requireNativeView<NativeClisbotTerminalViewProps>("ClisbotTerminal");
const CUSTOM_GLYPHS = encodeTerminalCustomGlyphs();

export function ClisbotTerminalView({ frame, onCellMetrics, ...props }: ClisbotTerminalViewProps) {
  const nativeFrame = useMemo(() => encodeTerminalFrame(frame), [frame]);
  const handleCellMetrics = useCallback(
    (event: { nativeEvent: ClisbotTerminalCellMetrics }) => onCellMetrics?.(event.nativeEvent),
    [onCellMetrics],
  );
  return (
    <NativeClisbotTerminalView
      {...props}
      frame={nativeFrame}
      customGlyphs={CUSTOM_GLYPHS}
      onCellMetrics={handleCellMetrics}
    />
  );
}
