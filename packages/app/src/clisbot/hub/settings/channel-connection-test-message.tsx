import { routeAudienceDraft } from "./channel-route-audience";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ConnectionTestMessagePanel } from "./channel-connection-settings";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { type SelectFieldOption } from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";
import { HubChannelTestPreviewSchema } from "../contracts";
import { splitConversationIds } from "../conversation-picker";
import { type RecordValue } from "./channel-settings-types";
import { arrayField, stringField } from "./channel-settings-records";
import {
  channelDestinationLabel,
  useObservedConversations,
} from "./channel-observed-conversations";

/**
 * Where a test message can go: every conversation the bot has seen, plus the
 * ones a Route names. It starts on the first a Route names.
 */
export function ConnectionTestMessage({
  account,
  pending,
  send,
  close,
}: {
  account: RecordValue;
  pending: boolean;
  send(conversationId: string): void;
  close(): void;
}) {
  const channel = stringField(account, "channel");
  const accountId = stringField(account, "accountId");
  const observed = useObservedConversations(channel, accountId, true);
  const routes = arrayField(account, "routes") as RecordValue[];
  const destinations = useMemo<SelectFieldOption<string>[]>(() => {
    const named = routes.flatMap((route) =>
      routeAudienceDraft(route).flatMap((rule) => splitConversationIds(rule.where.conversations)),
    );
    const seen = [
      ...(observed.data?.destinations ?? []),
      ...(observed.data?.conversations ?? []),
    ].map((item) => item.id);
    return [...new Set([...named, ...seen])].map((id) => ({
      id,
      value: id,
      label: channelDestinationLabel(id, observed.data),
    }));
  }, [observed.data, routes]);
  const initial = routes.map(routeTestTarget).find((target) => target !== null);
  return (
    <ConnectionTestMessagePanel
      key={observed.data === undefined ? "loading" : "loaded"}
      destinations={destinations}
      initialDestination={initial?.conversationId ?? destinations[0]?.value ?? null}
      pending={pending}
      send={send}
      close={close}
    />
  );
}

export function ChannelTestPreview({
  preview,
}: {
  preview: z.infer<typeof HubChannelTestPreviewSchema>;
}) {
  const { t } = useTranslation();
  let destination = t("hub.channels.testPreview.newMessage");
  if (preview.threadId !== null)
    destination = t("hub.channels.testPreview.inThread", {
      thread: preview.threadLabel
        ? `${preview.threadLabel} (${preview.threadId})`
        : preview.threadId,
    });
  else if (preview.channel === "telegram" && preview.requestedThreadId === "1")
    destination = t("hub.channels.testPreview.generalTopic");
  return (
    <View style={styles.testPreview}>
      <View>
        <Text style={settingsStyles.rowTitle}>{t("hub.channels.testPreview.sendTo")}</Text>
        <Text selectable style={settingsStyles.rowHint}>
          {preview.label ? `${preview.label} (${preview.conversationId})` : preview.conversationId}
        </Text>
        <Text style={settingsStyles.rowHint}>{destination}</Text>
      </View>
      <View style={styles.testMessageSection}>
        <Text style={settingsStyles.rowTitle}>{t("hub.channels.testPreview.messageToSend")}</Text>
        <View testID="channel-test-message" style={[settingsStyles.card, styles.testMessage]}>
          <Text selectable style={settingsStyles.rowTitle}>
            {preview.text}
          </Text>
        </View>
      </View>
      <Text style={settingsStyles.rowHint}>{t("hub.channels.testPreview.footer")}</Text>
    </View>
  );
}

/** The first named conversation of the Route's rules: where a test message can go. */
function routeTestTarget(route: RecordValue): { conversationId: string } | null {
  for (const rule of routeAudienceDraft(route)) {
    const [conversationId] = splitConversationIds(rule.where.conversations);
    if (conversationId !== undefined) return { conversationId };
  }
  return null;
}

const styles = StyleSheet.create((theme) => ({
  testPreview: {
    gap: theme.spacing[4],
  },
  testMessageSection: {
    gap: theme.spacing[2],
  },
  testMessage: {
    padding: theme.spacing[3],
  },
}));
