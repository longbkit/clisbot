import { useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { View } from "react-native";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { placeAgainstAnchor, type AnchorAtRest, type PopoverFrameProps } from "./placement";

type AnchorRect = AnchorAtRest;

function rectWithin(anchor: HTMLElement, host: HTMLElement): AnchorRect {
  const anchorRect = anchor.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  return {
    x: anchorRect.x - hostRect.x,
    y: anchorRect.y - hostRect.y,
    width: anchorRect.width,
    height: anchorRect.height,
    hostHeight: hostRect.height,
  };
}

/**
 * The composer resizes as its text wraps and as the window resizes. ResizeObserver callbacks run
 * after layout and before paint, so committing the new placement synchronously there paints the
 * popover against the composer's new rect in the same frame.
 */
export function PopoverFrame({
  anchorRef,
  anchorAtRest,
  reservedLift,
  topInset,
  position,
  layoutShift,
  bottomInset,
  children,
}: PopoverFrameProps): ReactElement {
  "use no memo";
  // React Compiler memoizes effect captures by reading SharedValue.value during render.
  const frameRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<AnchorRect>(anchorAtRest);

  useLayoutEffect(() => {
    const anchorElement = anchorRef.current as unknown as HTMLElement | null;
    // The frame's parent is the portal layer, which covers the host.
    const host = (frameRef.current as unknown as HTMLElement | null)?.parentElement;
    if (!anchorElement || !host) return undefined;
    setAnchor(rectWithin(anchorElement, host));
    const observer = new ResizeObserver(() => {
      flushSync(() => setAnchor(rectWithin(anchorElement, host)));
    });
    observer.observe(anchorElement);
    observer.observe(host);
    return () => observer.disconnect();
  }, [anchorAtRest, anchorRef]);

  const style = inlineUnistylesStyle({
    position: "absolute" as const,
    left: anchor.x,
    width: anchor.width,
    ...placeAgainstAnchor({
      position,
      anchorTop: anchor.y,
      anchorBottom: anchor.y + anchor.height,
      hostHeight: anchor.hostHeight,
      reservedLift: reservedLift.value,
      layoutShift: layoutShift.value,
      topInset,
      bottomInset,
    }),
  });

  return (
    <View ref={frameRef} testID="composer-autocomplete-popover" style={style}>
      {children}
    </View>
  );
}
