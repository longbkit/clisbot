import type { ReactElement } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { wrappablePath } from "@/utils/shorten-path";

/**
 * Hovering the workspace heading shows the folder it works in, so "where am I" never needs a
 * menu or a copy. Desktop only: touch has no hover, and the header menu shows the same path.
 */
export function WorkspacePathTooltip({
  path,
  enabled,
  children,
}: {
  path: string | null;
  enabled: boolean;
  children: ReactElement;
}) {
  if (!enabled || !path) return children;
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" align="start" maxWidth={420} testID="workspace-path-tooltip">
        <Text style={styles.path}>{wrappablePath(path)}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  path: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
