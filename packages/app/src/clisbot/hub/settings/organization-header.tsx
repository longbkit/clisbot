import { useCallback, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { DetailRow, OrganizationTitle } from "../organization-identity";

type HubAccount = ReturnType<typeof useHubAccount>;
type HubRun = (operation: () => Promise<void>) => Promise<void>;

/**
 * The organization every Hub action applies to, shown first and largest on Account. Owners
 * rename it in place; the slug that CLI and daemon flows use does not change.
 */
export function OrganizationHeader({
  hub,
  organizationName,
  organizationSlug,
  roleLabel,
  isOwner,
  pending,
  run,
}: {
  hub: HubAccount;
  organizationName: string;
  organizationSlug: string;
  roleLabel: string;
  isOwner: boolean;
  pending: boolean;
  run: HubRun;
}) {
  const [renaming, setRenaming] = useState(false);
  const startRenaming = useCallback(() => setRenaming(true), []);
  const stopRenaming = useCallback(() => setRenaming(false), []);
  return (
    <View style={[settingsStyles.card, styles.card]}>
      <View style={styles.titleRow}>
        <OrganizationTitle name={organizationName} />
        {isOwner && !renaming ? (
          <Button size="sm" variant="outline" disabled={pending} onPress={startRenaming}>
            Rename
          </Button>
        ) : null}
      </View>
      <DetailRow label="Organization ID" value={organizationSlug} />
      <DetailRow label="Your role" value={roleLabel} />
      {renaming ? (
        <RenameOrganization
          hub={hub}
          currentName={organizationName}
          pending={pending}
          run={run}
          onDone={stopRenaming}
        />
      ) : null}
    </View>
  );
}

function RenameOrganization({
  hub,
  currentName,
  pending,
  run,
  onDone,
}: {
  hub: HubAccount;
  currentName: string;
  pending: boolean;
  run: HubRun;
  onDone: () => void;
}) {
  const compact = useIsCompactFormFactor();
  const [name, setName] = useState(currentName);
  const save = useCallback(
    () =>
      void run(async () => {
        await hub.renameOrganization(name.trim());
        onDone();
      }),
    [hub, name, onDone, run],
  );
  const unchanged = name.trim() === currentName || name.trim().length === 0;
  return (
    <View style={styles.form}>
      <Field label="Organization name" hint="Shown to everyone in this organization.">
        <FormTextInput
          size={compact ? "md" : "sm"}
          initialValue={name}
          onChangeText={setName}
          editable={!pending}
        />
      </Field>
      <View style={styles.actions}>
        <Button disabled={pending || unchanged} loading={pending} onPress={save}>
          Save name
        </Button>
        <Button variant="ghost" disabled={pending} onPress={onDone}>
          Cancel
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  form: {
    gap: theme.spacing[3],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
