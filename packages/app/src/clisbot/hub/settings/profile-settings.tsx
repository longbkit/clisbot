import { useCallback, useMemo, useState } from "react";
import { Image, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";

type HubAccount = ReturnType<typeof useHubAccount>;
type HubRun = (operation: () => Promise<void>) => Promise<void>;

/**
 * You on this Hub: name, email, and the instance role when you run the Hub. Edit opens the form
 * in the same card. Display name and image save through Better Auth's `update-user`; the image
 * is a link, since Hub stores no image files yet and accepts only https links on hosts the
 * operator trusts. `update-user` needs the browser session cookie, so only clients on the Hub
 * origin can edit.
 */
export function ProfileSettings({
  hub,
  account,
  isInstanceOperator,
  pending,
  run,
}: {
  hub: HubAccount;
  account: { name: string; email: string; image?: string | null | undefined };
  isInstanceOperator: boolean;
  pending: boolean;
  run: HubRun;
}) {
  const compact = useIsCompactFormFactor();
  const fieldSize = compact ? "md" : "sm";
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [image, setImage] = useState(account.image ?? "");
  const startEditing = useCallback(() => setEditing(true), []);
  const cancel = useCallback(() => {
    setName(account.name);
    setImage(account.image ?? "");
    setEditing(false);
  }, [account.image, account.name]);
  const save = useCallback(
    () =>
      void run(async () => {
        await hub.updateProfile({ name: name.trim(), image: image.trim() || null });
        setEditing(false);
      }),
    [hub, image, name, run],
  );
  const editable = hub.signInKind === "password";
  if (!editing) {
    return (
      <SettingsSection title="Profile">
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            {account.image ? <ProfileImage uri={account.image} /> : null}
            <View style={[settingsStyles.rowContent, account.image ? styles.identity : null]}>
              <Text style={settingsStyles.rowTitle}>{account.name}</Text>
              <Text style={settingsStyles.rowHint}>{account.email}</Text>
              {isInstanceOperator ? (
                <Text style={settingsStyles.rowHint}>Operator of this Hub instance</Text>
              ) : null}
            </View>
            {editable ? (
              <Button size="sm" variant="outline" disabled={pending} onPress={startEditing}>
                Edit
              </Button>
            ) : null}
          </View>
        </View>
      </SettingsSection>
    );
  }
  return (
    <SettingsSection title="Profile">
      <View style={[settingsStyles.card, styles.form]}>
        {account.image ? <ProfileImage uri={account.image} /> : null}
        <Field label="Display name">
          <FormTextInput
            size={fieldSize}
            initialValue={name}
            onChangeText={setName}
            editable={!pending}
          />
        </Field>
        <Field
          label="Profile image link"
          hint="An https link, for example your Google or Gravatar photo. Leave empty to remove it."
        >
          <FormTextInput
            size={fieldSize}
            initialValue={image}
            onChangeText={setImage}
            placeholder="https://"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
          />
        </Field>
        <View style={styles.actions}>
          <Button disabled={pending || name.trim().length === 0} loading={pending} onPress={save}>
            Save profile
          </Button>
          <Button variant="ghost" disabled={pending} onPress={cancel}>
            Cancel
          </Button>
        </View>
      </View>
    </SettingsSection>
  );
}

function ProfileImage({ uri }: { uri: string }) {
  const source = useMemo(() => ({ uri }), [uri]);
  return <Image source={source} style={styles.avatar} accessibilityLabel="" />;
}

const styles = StyleSheet.create((theme) => ({
  form: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  identity: {
    marginLeft: theme.spacing[3],
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
}));
