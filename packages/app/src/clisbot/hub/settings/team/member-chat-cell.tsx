import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { buttonControlHeight } from "@/components/ui/control-geometry";
import { settingsStyles } from "@/styles/settings";
import type { RealmLink } from "./member-directory";

/**
 * Where the Member is recognized when they chat: one line per identity realm, linked or not.
 * "Link" opens the Member's Chat accounts, where an instance operator links an account by hand.
 */
export function MemberChatCell({
  links,
  canLink,
  pending,
  onLink,
}: {
  links: readonly RealmLink[];
  canLink: boolean;
  pending: boolean;
  onLink(): void;
}) {
  if (links.length === 0) {
    return <Text style={settingsStyles.rowHint}>No chat bots yet</Text>;
  }
  return (
    <View style={styles.list}>
      {links.map((link) => (
        <View key={link.key} style={styles.line}>
          <Text style={settingsStyles.rowHint}>
            {link.linked ? `✓ ${link.label}` : `${link.label} · not linked`}
          </Text>
          {link.linked || !canLink ? null : (
            <Button
              size="xs"
              variant="ghost"
              disabled={pending}
              onPress={onLink}
              accessibilityLabel={`Link ${link.label}`}
            >
              Link
            </Button>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { gap: theme.spacing[0.5] },
  // A button tall, like the Teams column's lines, so the two read level.
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: buttonControlHeight.xs,
  },
}));
