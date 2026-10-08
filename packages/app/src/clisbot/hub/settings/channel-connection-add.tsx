import { useHubEditLock } from "@/device-access/hub-edit-lock";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { channelApiProblem } from "../channel-api";
import {
  channelConnectionProblem,
  connectableChannelEntries,
  connectionNamesFor,
  type ChannelConnectionProblem,
} from "../channel-connection-form";
import type { ChannelCatalogEntry, ChannelCatalogState } from "../channel-catalog";
import { useChannelCatalog } from "./channel-catalog-queries";
import { ChannelPicker } from "./channel-picker";
import { ChannelConnectionSetup } from "./channel-connection-setup";

/**
 * Add a Connection for any channel: pick the channel, then fill the
 * catalog-driven credential form for it. This is the one Add-connection surface
 * in the app — the Channels accounts editor and Configuration settings both
 * mount it, so a channel becomes connectable in both the moment the Hub's
 * catalog carries it and `CONNECTION_SHAPES` knows its request body.
 *
 * `create` owns the POST and whatever the caller does with the result; a
 * rejection comes back here and is rendered as the Hub's guidance.
 */
export function AddChannelConnection({
  allowProviderApplications,
  connections,
  disabled = false,
  create,
  onCancel,
}: {
  /** Slack Socket Mode is created from a Provider Application; operators only. */
  allowProviderApplications: boolean;
  /** The Hub's Connections, so a new one is named past the names they use. */
  connections: readonly { provider: string; name: string }[];
  disabled?: boolean;
  create(body: Record<string, unknown>): Promise<void>;
  onCancel?: (() => void) | undefined;
}) {
  useHubEditLock();
  const catalog = useChannelCatalog();
  const entries = useMemo(
    () => connectableChannelEntries(catalog.entries, { allowProviderApplications }),
    [allowProviderApplications, catalog.entries],
  );
  const [choice, setChoice] = useState<string | null>(null);
  const selected = entries.find((entry) => entry.id === choice) ?? entries[0];
  const save = useChannelConnectionSave(selected, create);
  if (selected === undefined) return <NoConnectableChannel catalog={catalog} />;
  return (
    <View style={styles.view}>
      {entries.length > 1 ? (
        <ChannelPicker entries={entries} value={selected.id} onChange={setChoice} />
      ) : null}
      <ChannelConnectionSetup
        key={selected.id}
        entry={selected}
        takenNames={connectionNamesFor(selected.id, connections)}
        save={save}
        {...(onCancel === undefined || disabled ? {} : { onCancel })}
      />
    </View>
  );
}

/** Nothing to offer: the catalog is not loaded, or this Hub runs no such channel. */
function NoConnectableChannel({ catalog }: { catalog: ChannelCatalogState }) {
  const { t } = useTranslation();
  if (catalog.availability === "loading") {
    return (
      <Alert
        variant="info"
        title={t("hub.channels.catalogView.loading")}
        description={catalog.message ?? ""}
      />
    );
  }
  if (catalog.availability !== "available") {
    return (
      <Alert
        variant="warning"
        title={t("hub.channels.catalogView.unavailable")}
        description={catalog.message ?? ""}
      />
    );
  }
  return (
    <Alert
      variant="info"
      title={t("hub.channels.connectionAdd.noneTitle")}
      description={t("hub.channels.connectionAdd.noneBody")}
    />
  );
}

/**
 * Turn a rejected `POST connections` into the guidance the form renders. Shared
 * with the Catalog view, which picks its channel from the catalog list instead.
 */
export function useChannelConnectionSave(
  entry: ChannelCatalogEntry | undefined,
  create: (body: Record<string, unknown>) => Promise<void>,
): (body: Record<string, unknown>) => Promise<ChannelConnectionProblem | null> {
  return useCallback(
    async (body) => {
      try {
        await create(body);
      } catch (error) {
        return channelConnectionProblem(entry, channelApiProblem(error));
      }
      return null;
    },
    [create, entry],
  );
}

const styles = StyleSheet.create((theme) => ({
  view: {
    gap: theme.spacing[2],
  },
}));
