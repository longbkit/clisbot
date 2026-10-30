import React, { createContext, memo, type ReactNode, useContext } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

const RetainedPanelActiveContext = createContext(true);

export function useRetainedPanelActive(): boolean {
  return useContext(RetainedPanelActiveContext);
}

interface RetainedPanelProps {
  active: boolean;
  /**
   * Whether the panel is on screen; defaults to `active`. Phone tabs show a pressed tab before it
   * becomes active, so the press's commit does not render the tab's content.
   */
  shown?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface RetainedPanelActivityProps {
  active: boolean;
  children: ReactNode;
}

export function RetainedPanelActivity({ active, children }: RetainedPanelActivityProps) {
  const parentActive = useRetainedPanelActive();
  return (
    <RetainedPanelActiveContext value={parentActive && active}>
      {children}
    </RetainedPanelActiveContext>
  );
}

/**
 * Keeps expensive panel state mounted without letting an inactive panel render
 * on screen. The stable, non-collapsible native root is intentional: retained
 * panels must not detach or reparent their native descendants when visibility
 * changes.
 */
export const RetainedPanel = memo(function RetainedPanel({
  active,
  shown = active,
  children,
  style,
  testID,
}: RetainedPanelProps) {
  const visibleStyle = StyleSheet.compose<ViewStyle, ViewStyle, ViewStyle>(styles.root, style);
  const panelStyle = shown
    ? visibleStyle
    : StyleSheet.compose<ViewStyle, ViewStyle, ViewStyle>(visibleStyle, styles.hidden);

  return (
    <RetainedPanelActivity active={active}>
      <View
        collapsable={false}
        pointerEvents={shown ? "auto" : "none"}
        style={panelStyle}
        testID={testID}
      >
        {children}
      </View>
    </RetainedPanelActivity>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  hidden: {
    display: "none",
  },
});
