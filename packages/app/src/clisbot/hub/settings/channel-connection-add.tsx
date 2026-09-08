import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { channelApiProblem } from "../channel-api";
import {
  channelConnectionProblem,
  connectableChannelEntries,
  type ChannelConnectionProblem,
} from "../channel-connection-form";
import type { ChannelCatalogEntry, ChannelCatalogState } from "../channel-catalog";
import { useChannelCatalog } from "./channel-catalog-queries";
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
  disabled = false,
  create,
  onCancel,
}: {
  /** Slack Socket Mode is created from a Provider Application; operators only. */
  allowProviderApplications: boolean;
  disabled?: boolean;
  create(body: Record<string, unknown>): Promise<void>;
  onCancel?: (() => void) | undefined;
}) {
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
        <Field label="Channel">
          <SegmentedControl
            options={entries.map((entry) => ({ value: entry.id, label: entry.label }))}
            value={selected.id}
            onValueChange={setChoice}
            size="sm"
          />
        </Field>
      ) : null}
      <ChannelConnectionSetup
        key={selected.id}
        entry={selected}
        save={save}
        {...(onCancel === undefined || disabled ? {} : { onCancel })}
      />
    </View>
  );
}

/** Nothing to offer: the catalog is not loaded, or this Hub runs no such channel. */
function NoConnectableChannel({ catalog }: { catalog: ChannelCatalogState }) {
  if (catalog.availability === "loading") {
    return <Alert variant="info" title="Loading channels" description={catalog.message ?? ""} />;
  }
  if (catalog.availability !== "available") {
    return (
      <Alert
        variant="warning"
        title="Catalog not available on this Hub"
        description={catalog.message ?? ""}
      />
    );
  }
  return (
    <Alert
      variant="info"
      title="No channel here accepts a pasted credential"
      description="Every channel this Hub runs is either linked by QR or needs a Provider Application an instance operator administers."
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
