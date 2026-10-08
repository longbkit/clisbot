import { useCallback, useState } from "react";
import type { z } from "zod";
import { i18n } from "@/i18n/i18next";
import { HubApiError } from "../api-client";
import {
  HubChannelRuntimeRetrySchema,
  HubChannelTestSchema,
  HubChannelTestPreviewSchema,
} from "../contracts";
import { type HubConnection, type RecordValue } from "./channel-settings-types";
import { arrayField, stringField, withAccountPatch } from "./channel-settings-records";
import {
  type ChannelSettingsQueries,
  type ConfirmDialog,
  type Mutate,
  type ReplaceConfiguration,
} from "./channel-settings-mutations";
import { ChannelTestPreview } from "./channel-connection-test-message";

/** What a Connection's card does to it: remove, switch or limit it, retry it, disconnect it. */
export function useAccountActions({
  queries,
  mutate,
  replaceConfiguration,
  confirmDialog,
}: {
  queries: ChannelSettingsQueries;
  mutate: Mutate;
  replaceConfiguration: ReplaceConfiguration;
  confirmDialog: ConfirmDialog;
}) {
  const { hub, channels, connections, runtimeStatus } = queries;
  const removeAccount = useCallback(
    async (account: RecordValue) => {
      const channel = stringField(account, "channel") ?? "Channel";
      const accountId = stringField(account, "accountId") ?? "account";
      const connectionId = stringField(account, "connectionId");
      const connection = connections.data?.connections.find(({ id }) => id === connectionId);
      const resourceId = `${channel}/${accountId}`;
      const remainingConsumers =
        connection?.consumers.filter(
          (consumer) =>
            consumer.resourceKind !== "channel_account" || consumer.resourceId !== resourceId,
        ) ?? [];
      const confirmed = await confirmDialog({
        title: i18n.t("hub.channels.connectionActions.removeTitle", { name: accountId }),
        message:
          remainingConsumers.length > 0
            ? i18n.t("hub.channels.connectionActions.removeShared", {
                consumers: remainingConsumers.map(({ name }) => name).join(", "),
              })
            : i18n.t("hub.channels.connectionActions.removeOnly"),
        confirmLabel: i18n.t("hub.channels.connectionActions.removeRoutes"),
        destructive: true,
      });
      if (!confirmed) return;
      await mutate(async () => {
        await replaceConfiguration(
          (channels.data?.accounts ?? []).filter(
            (candidate) =>
              stringField(candidate, "channel") !== channel ||
              stringField(candidate, "accountId") !== accountId,
          ),
        );
        await connections.refetch();
        if (connectionId === null || remainingConsumers.length > 0) return;
        const disconnect = await confirmDialog({
          title: i18n.t("hub.channels.connectionActions.disconnectTooTitle"),
          message: i18n.t("hub.channels.connectionActions.disconnectMessage"),
          confirmLabel: i18n.t("hub.channels.connectionActions.disconnect"),
          cancelLabel: i18n.t("hub.channels.connectionActions.keepCredential"),
          destructive: true,
        });
        if (!disconnect) return;
        await hub.api().delete(`connections/${encodeURIComponent(connectionId)}`);
        await connections.refetch();
      });
    },
    [channels.data?.accounts, connections, hub, mutate, replaceConfiguration, confirmDialog],
  );

  /** One account-level edit (`enabled`, `limits`); an undefined value removes the key. */
  const updateAccount = useCallback(
    async (account: RecordValue, patch: RecordValue) => {
      await mutate(() =>
        replaceConfiguration(
          (channels.data?.accounts ?? []).map((candidate) =>
            candidate === account ? withAccountPatch(candidate, patch) : candidate,
          ),
        ),
      );
    },
    [channels.data?.accounts, mutate, replaceConfiguration],
  );

  const retryAccount = useCallback(
    async (account: RecordValue) => {
      const channel = stringField(account, "channel");
      const accountId = stringField(account, "accountId");
      if (channel === null || accountId === null) return;
      await mutate(async () => {
        const response = await hub
          .api()
          .post(
            `channel-accounts/${encodeURIComponent(channel)}/${encodeURIComponent(accountId)}/retry`,
            {},
            HubChannelRuntimeRetrySchema,
          );
        await runtimeStatus.refetch();
        if (response.status?.transport !== "started") {
          throw new Error(
            response.status?.detail ??
              response.result.detail ??
              i18n.t("hub.channels.connectionActions.retryFailed"),
          );
        }
      });
    },
    [hub, mutate, runtimeStatus],
  );

  // A Connection with no Routes is only its credential: removing it disconnects.
  const disconnectConnection = useCallback(
    async (connection: HubConnection) => {
      const confirmed = await confirmDialog({
        title: i18n.t("hub.channels.connectionActions.disconnectTitle", { name: connection.name }),
        message: i18n.t("hub.channels.connectionActions.disconnectMessage"),
        confirmLabel: i18n.t("hub.channels.connectionActions.disconnect"),
        destructive: true,
      });
      if (!confirmed) return;
      await mutate(async () => {
        await hub.api().delete(`connections/${encodeURIComponent(connection.id)}`);
        await connections.refetch();
      });
    },
    [confirmDialog, connections, hub, mutate],
  );
  return { removeAccount, updateAccount, retryAccount, disconnectConnection };
}

/** Removing and reordering one account's Routes. */
export function useRouteActions({
  accounts,
  mutate,
  replaceConfiguration,
  confirmDialog,
}: {
  accounts: RecordValue[] | undefined;
  mutate: Mutate;
  replaceConfiguration: ReplaceConfiguration;
  confirmDialog: ConfirmDialog;
}) {
  const replaceAccountRoutes = useCallback(
    (account: RecordValue, routes: RecordValue[]) =>
      replaceConfiguration(
        (accounts ?? []).map((candidate) =>
          candidate === account ? Object.assign({}, candidate, { routes }) : candidate,
        ),
      ),
    [accounts, replaceConfiguration],
  );

  const removeRoute = useCallback(
    async (account: RecordValue, routeIndex: number) => {
      const routes = arrayField(account, "routes") as RecordValue[];
      const confirmed = await confirmDialog({
        title: i18n.t("hub.channels.connectionActions.removeRouteTitle", {
          position: routeIndex + 1,
        }),
        message: i18n.t("hub.channels.connectionActions.removeRouteMessage"),
        confirmLabel: i18n.t("hub.channels.connectionActions.removeRoute"),
        destructive: true,
      });
      if (!confirmed) return;
      await mutate(() =>
        replaceAccountRoutes(
          account,
          routes.filter((_, index) => index !== routeIndex),
        ),
      );
    },
    [mutate, replaceAccountRoutes, confirmDialog],
  );

  const moveRoute = useCallback(
    async (account: RecordValue, from: number, to: number) => {
      const routes = [...(arrayField(account, "routes") as RecordValue[])];
      if (to < 0 || to >= routes.length) return;
      const [route] = routes.splice(from, 1);
      if (route === undefined) return;
      routes.splice(to, 0, route);
      await mutate(() => replaceAccountRoutes(account, routes));
    },
    [mutate, replaceAccountRoutes],
  );
  return { removeRoute, moveRoute };
}

/**
 * A test message checks the Connection itself: it is sent where the user
 * picks, not tied to a Route.
 */
export function useTestMessage({
  hub,
  mutate,
  confirmDialog,
}: {
  hub: ChannelSettingsQueries["hub"];
  mutate: Mutate;
  confirmDialog: ConfirmDialog;
}) {
  const [testResult, setTestResult] = useState<string | null>(null);
  const sendTestMessage = useCallback(
    async (account: RecordValue, conversationId: string) => {
      const channel = stringField(account, "channel");
      const accountId = stringField(account, "accountId");
      if (channel === null || accountId === null) return;
      const target = { conversationId };
      setTestResult(null);
      await mutate(async () => {
        const resource = `channel-accounts/${encodeURIComponent(channel)}/${encodeURIComponent(accountId)}`;
        const params = new URLSearchParams({
          conversationId: target.conversationId,
        });
        let preview: z.infer<typeof HubChannelTestPreviewSchema>;
        try {
          preview = await hub
            .api()
            .get(`${resource}/test-preview?${params.toString()}`, HubChannelTestPreviewSchema);
        } catch (error) {
          if (error instanceof HubApiError && error.status === 404)
            throw new Error(i18n.t("hub.channels.connectionActions.previewUnavailable"), {
              cause: error,
            });
          throw error;
        }
        const confirmed = await confirmDialog({
          title: i18n.t("hub.channels.connectionActions.sendTestTitle"),
          message: i18n.t("hub.channels.connectionActions.sendTestMessage"),
          body: <ChannelTestPreview preview={preview} />,
          confirmLabel: i18n.t("hub.channels.connectionActions.sendTest"),
        });
        if (!confirmed) return;
        await hub.api().post(
          `${resource}/test`,
          {
            ...target,
            expectedText: preview.text,
            expectedRevisionId: preview.revisionId,
            expectedPreviewId: preview.previewId,
          },
          HubChannelTestSchema,
        );
        setTestResult(
          i18n.t("hub.channels.connectionActions.testSent", {
            target: preview.label ?? preview.conversationId,
          }),
        );
      });
    },
    [hub, mutate, confirmDialog],
  );
  return { testResult, sendTestMessage };
}
