import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { buttonControlHeight } from "@/components/ui/control-geometry";
import { tableStyles } from "../table-styles";
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
  const { t } = useTranslation();
  if (links.length === 0) {
    return <Text style={tableStyles.cellText}>{t("hub.team.members.chat.none")}</Text>;
  }
  return (
    <View style={styles.list}>
      {links.map((link) => (
        <View key={link.key} style={styles.line}>
          <Text style={tableStyles.cellText}>
            {link.linked
              ? t("hub.team.members.chat.linked", { label: link.label })
              : t("hub.team.members.chat.notLinked", { label: link.label })}
          </Text>
          {link.linked || !canLink ? null : (
            <Button
              size="xs"
              variant="ghost"
              disabled={pending}
              onPress={onLink}
              accessibilityLabel={t("hub.team.members.chat.linkLabel", { label: link.label })}
            >
              {t("hub.team.members.chat.link")}
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
