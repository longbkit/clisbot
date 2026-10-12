import { Pressable, Text } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

/** A Home group title that doubles as the way into its full list; the chevron says it goes somewhere. */
export function SectionLink({
  title,
  count,
  accessibilityLabel,
  onPress,
  testID,
}: {
  title: string;
  count?: number;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={linkStyle}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <Text style={styles.heading}>
        {title}
        {count ? <Text style={styles.count}> {count}</Text> : null}
      </Text>
      <LinkChevron size={14} />
    </Pressable>
  );
}
const linkStyle = ({ hovered }: { hovered?: boolean }) => [
  styles.link,
  hovered && styles.linkHovered,
];
const LinkChevron = withUnistyles(ChevronRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const styles = StyleSheet.create((t) => ({
  heading: {
    color: t.colors.foreground,
    fontSize: t.fontSize.base,
    fontWeight: t.fontWeight.medium,
  },
  count: { color: t.colors.foregroundMuted, fontWeight: t.fontWeight.normal },
  link: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: t.spacing[1],
    // The hover fill needs room; pull it back so the title stays on the rows' rail.
    marginLeft: -t.spacing[1],
    paddingHorizontal: t.spacing[1],
    paddingVertical: t.spacing[0.5],
    borderRadius: t.borderRadius.md,
    marginBottom: t.spacing[1],
  },
  linkHovered: { backgroundColor: t.colors.interactionHighlight },
}));
