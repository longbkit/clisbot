import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { HubSettingsDetailScrollProvider } from "./detail-scroll";

// Settings keeps its 720 column. A Hub view that lays out a table or a
// master-detail asks for the wide column while it is on screen, and gives it
// back when it leaves, so compact forms and lists never stretch.

type RequestWide = (wide: boolean) => void;

const WideContentContext = createContext<RequestWide | null>(null);

/**
 * The Settings detail column: `style` normally, `style` plus `wideStyle` while
 * the view on screen asks for it. Also provides the detail scroll.
 */
export function SettingsDetailContent({
  style,
  wideStyle,
  onNavigate,
  children,
}: {
  style: StyleProp<ViewStyle>;
  wideStyle: StyleProp<ViewStyle>;
  onNavigate(): void;
  children: ReactNode;
}) {
  const [wide, setWide] = useState(false);
  const columnStyle = useMemo(() => (wide ? [style, wideStyle] : style), [style, wide, wideStyle]);
  return (
    <View style={columnStyle}>
      <HubSettingsDetailScrollProvider onNavigate={onNavigate}>
        <WideContentContext.Provider value={setWide}>{children}</WideContentContext.Provider>
      </HubSettingsDetailScrollProvider>
    </View>
  );
}

/** Asks for the wide column while `wide` holds and the caller is mounted. */
export function useWideContent(wide = true): void {
  const request = useContext(WideContentContext);
  useEffect(() => {
    if (request === null || !wide) return;
    request(true);
    return () => request(false);
  }, [request, wide]);
}
