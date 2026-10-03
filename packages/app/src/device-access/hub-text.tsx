import { Text, type TextProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/** Copy in the isolated onboarding extension follows the existing Settings theme. */
export function HubText({ style, ...props }: TextProps) {
  return (
    <Text
      {...props}
      style={[styles.text, props.accessibilityRole === "alert" ? styles.error : null, style]}
    />
  );
}
const styles = StyleSheet.create((theme) => ({
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.base, lineHeight: 24 },
  error: { color: theme.colors.destructive },
}));
