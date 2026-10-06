import { draftBaseline } from "./automation-input-draft";
import { saveChangedAccounts } from "../channel-account-requests";
import { useChannelSettingsQueries } from "./channel-settings-hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useConfirmation } from "@/components/confirmation-provider";
import { hubResourceQueryKey } from "../query-keys";
import {
  HubChannelConfigurationSchema,
  HubChannelValidationSchema,
  HubConnectionSchema,
} from "../contracts";
import { followsConnectionAdd } from "./channel-connection-revision";
import {
  type ChannelEditor,
  type HubChannelConfiguration,
  type HubConnections,
  type RecordValue,
} from "./channel-settings-types";

export type ChannelSettingsQueries = ReturnType<typeof useChannelSettingsQueries>;
export type Mutate = (operation: () => Promise<void>) => Promise<boolean>;
export type ReplaceConfiguration = (
  accounts: RecordValue[],
  resource?: RecordValue,
  policy?: RecordValue,
) => Promise<void>;
export type ConfirmDialog = ReturnType<typeof useConfirmation>;

/** One Hub write at a time: whether it runs, and the error the last one ended with. */
export function useChannelMutation() {
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationPending, setPending] = useState(false);
  const mutate = useCallback(async (operation: () => Promise<void>) => {
    setMutationError(null);
    setPending(true);
    try {
      await operation();
      return true;
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Hub request failed.");
      return false;
    } finally {
      setPending(false);
    }
  }, []);
  return { mutationError, mutationPending, mutate };
}

/** Writes a whole candidate configuration: staged in a draft, per account, or validated and saved. */
export function useReplaceConfiguration(
  queries: ChannelSettingsQueries,
  adminScoped: boolean,
): ReplaceConfiguration {
  const queryClient = useQueryClient();
  const { hub, scope, inputDraft, channels, history, runtimeStatus } = queries;
  const { organizationId, accountId: hubAccountId } = scope;
  return useCallback(
    async (
      accounts: RecordValue[],
      resource = channels.data?.resource ?? {},
      policy = channels.data?.policy ?? {},
    ) => {
      const current = channels.data;
      if (current === undefined) throw new Error("Channel configuration is still loading.");
      const candidate = {
        policy,
        accounts,
        resource,
      };
      if (inputDraft) {
        inputDraft.stage({
          ...candidate,
          ...draftBaseline(
            inputDraft.draft,
            { revisionId: current.revision?.id ?? null, accounts: current.accounts },
            adminScoped,
          ),
        });
        return;
      }
      if (adminScoped) {
        // A Connection Admin saves one account file at a time; the Hub
        // validates it and refuses a changed Connection.
        await saveChangedAccounts(
          hub.api(),
          accounts,
          current.accounts,
          current.revision?.id ?? null,
        );
        await Promise.all([channels.refetch(), runtimeStatus.refetch()]);
        return;
      }
      await hub.api().post("channel-configuration/validate", candidate, HubChannelValidationSchema);
      const saved = await hub.api().put(
        "channel-configuration",
        {
          expectedRevisionId: current.revision?.id ?? null,
          ...candidate,
        },
        HubChannelConfigurationSchema,
      );
      queryClient.setQueryData(
        hubResourceQueryKey(
          { origin: hub.origin, organizationId, accountId: hubAccountId },
          "channel-configuration",
        ),
        saved,
      );
      void Promise.all([channels.refetch(), history.refetch(), runtimeStatus.refetch()]);
    },
    [
      adminScoped,
      channels,
      history,
      hub,
      runtimeStatus,
      queryClient,
      organizationId,
      hubAccountId,
      inputDraft,
    ],
  );
}

/** The Route form's two saves: the Route itself, and a Connection added on its way. */
export function useRouteEditorSaves({
  queries,
  adminScoped,
  mutate,
  replaceConfiguration,
  editorRevisionId,
  setEditorRevisionId,
  setEditor,
}: {
  queries: ChannelSettingsQueries;
  adminScoped: boolean;
  mutate: Mutate;
  replaceConfiguration: ReplaceConfiguration;
  editorRevisionId: string | null;
  setEditorRevisionId: Dispatch<SetStateAction<string | null>>;
  setEditor(editor: ChannelEditor | null): void;
}) {
  const queryClient = useQueryClient();
  const { hub, scope, inputDraft, channels, connections, runtimeStatus } = queries;
  const { organizationId, accountId: hubAccountId } = scope;
  const saveChannelBehavior = useCallback(
    (accounts: RecordValue[], resource: RecordValue) => {
      void mutate(async () => {
        if (inputDraft) {
          if (!channels.data) throw new Error("Channel configuration is still loading.");
          inputDraft.stage({
            ...draftBaseline(
              inputDraft.draft,
              { revisionId: editorRevisionId, accounts: channels.data.accounts },
              adminScoped,
            ),
            accounts,
            resource,
            policy: channels.data.policy ?? {},
          });
          setEditor(null);
          return;
        }
        // An admin-scoped screen holds its accounts under its own query key, so
        // the loaded view is the freshest revision it can compare against.
        const currentConfiguration = adminScoped
          ? channels.data
          : queryClient.getQueryData<HubChannelConfiguration>(
              hubResourceQueryKey(
                { origin: hub.origin, organizationId, accountId: hubAccountId },
                "channel-configuration",
              ),
            );
        if ((currentConfiguration?.revision?.id ?? null) !== editorRevisionId) {
          throw new Error(
            "Channel configuration changed while editing. Cancel and reopen this Route before saving.",
          );
        }
        await replaceConfiguration(accounts, resource);
        setEditor(null);
      });
    },
    [
      adminScoped,
      inputDraft,
      channels.data,
      hub,
      mutate,
      replaceConfiguration,
      queryClient,
      organizationId,
      hubAccountId,
      editorRevisionId,
      setEditor,
    ],
  );
  const saveConnection = useCallback(
    async (body: unknown) => {
      const before = channels.data;
      const created = await hub.api().post("connections", body, HubConnectionSchema);
      queryClient.setQueryData<HubConnections>(
        hubResourceQueryKey(
          { origin: hub.origin, organizationId, accountId: hubAccountId },
          "connections",
        ),
        (current) =>
          current
            ? {
                ...current,
                connections: [
                  ...current.connections.filter(({ id }) => id !== created.id),
                  created,
                ],
              }
            : current,
      );
      void connections.refetch();
      // The Hub adds the Connection's account with it (a running bot, no
      // Routes yet): read it before the Route form opens on that account.
      const refreshed = await channels.refetch();
      // That add moved the configuration revision. A Route form opened before
      // it edits on top of the refreshed accounts, so its baseline follows —
      // unless something else changed the configuration first, which still
      // stops the save.
      setEditorRevisionId((current) =>
        followsConnectionAdd(current, before, refreshed.data, created.id)
          ? (refreshed.data?.revision?.id ?? null)
          : current,
      );
      void runtimeStatus.refetch();
      return created;
    },
    [
      channels,
      connections,
      hub,
      queryClient,
      organizationId,
      hubAccountId,
      runtimeStatus,
      setEditorRevisionId,
    ],
  );
  return { saveChannelBehavior, saveConnection };
}
