import { useIsCompactFormFactor } from "@/constants/layout";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ScrollView } from "@/components/ui/scroll-view";
import { StyleSheet } from "react-native-unistyles";

/** Sheet-owned scrolling keeps the submission action clear of the keyboard. */
export function BotFormLayout({
  children,
  footer,
  inline = false,
}: {
  children: ReactNode;
  footer: ReactNode;
  inline?: boolean;
}) {
  const compact = useIsCompactFormFactor();
  if (inline)
    return (
      <View style={[styles.fields, styles.inlineFields]}>
        {children}
        {footer}
      </View>
    );
  return (
    <View style={[styles.root, compact && styles.fill]}>
      <ScrollView
        style={[styles.scroll, compact && styles.fill]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.fields}>{children}</View>
      </ScrollView>
      <View style={styles.footer}>{footer}</View>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  inlineFields: { padding: 0 },
  fill: { flex: 1 },
  root: {
    flexGrow: { xs: 1, md: 0 },
    flexShrink: 1,
    minHeight: 0,
    maxHeight: "100%",
  },
  scroll: { flexGrow: { xs: 1, md: 0 }, flexShrink: 1, minHeight: 0 },
  fields: { padding: theme.spacing[4], gap: theme.spacing[3] },
  footer: {
    padding: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
}));
