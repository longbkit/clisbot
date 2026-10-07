import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/**
 * Whether the rows below name their project on a line above the title. A grouping with no
 * project headers (Workspace, Session, either Status) sets it for its groups, so a row says
 * which project it belongs to the way T3 Code's thread card does: project on top, the workspace
 * or session under it. Rows outside such a group — Pinned, Project groupings — read the default.
 */
const ProjectAboveContext = createContext(false);

export function ProjectAboveProvider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}): ReactElement {
  return <ProjectAboveContext.Provider value={value}>{children}</ProjectAboveContext.Provider>;
}

export function useProjectAbove(): boolean {
  return useContext(ProjectAboveContext);
}

/** The project's name above a row's title, starting on the title's rail. */
export function ProjectAboveLine({ name }: { name: string }): ReactElement {
  return (
    <Text style={styles.line} numberOfLines={1}>
      {name}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Past the leading icon column and its gap, the inset every row title in the sidebar uses.
  line: {
    paddingLeft: theme.iconSize.md + theme.spacing[2],
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
}));
