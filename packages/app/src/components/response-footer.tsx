import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";

const FooterRevealedContext = createContext(false);
export const useResponseFooterRevealed = () => useContext(FooterRevealedContext);

/** Reserve footer geometry while optional metadata follows its hover/touch visibility. */
export function ResponseFooter({
  children,
  style,
  revealed = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  revealed?: boolean;
}) {
  const compact = useIsCompactFormFactor();
  const [hovered, setHovered] = useState(false);
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  return (
    <View style={style} onPointerEnter={enter} onPointerLeave={leave}>
      <FooterRevealedContext.Provider value={revealed || hovered || compact || isNative}>
        {children}
      </FooterRevealedContext.Provider>
    </View>
  );
}
