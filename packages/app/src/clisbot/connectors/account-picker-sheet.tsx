import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ConnectorAccount } from "@clisbot/protocol/connectors/types";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { CheckOption } from "./check-option";
import { accountLabel } from "./model";

/**
 * Which of an app's accounts a Project's agents may act as. "Every account" also covers accounts connected
 * later; picking some keeps sessions to those.
 */
export function AccountPickerSheet({
  appName,
  accounts,
  initial,
  onClose,
  onSave,
}: {
  appName: string;
  accounts: ConnectorAccount[];
  initial: "all" | string[];
  onClose(): void;
  onSave(selection: "all" | string[]): void;
}) {
  const [selection, setSelection] = useState(initial);
  const toggle = useCallback(
    (id: string) =>
      setSelection((current) => {
        const picked = current === "all" ? accounts.map((account) => account.id) : current;
        return picked.includes(id) ? picked.filter((other) => other !== id) : [...picked, id];
      }),
    [accounts],
  );
  const every = useCallback(() => setSelection("all"), []);
  const save = useCallback(() => onSave(selection), [onSave, selection]);
  const header = useMemo(() => ({ title: `${appName} accounts` }), [appName]);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="ghost" size="sm" onPress={every}>
          Every account
        </Button>
        <View style={styles.group}>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="default" onPress={save} testID="connectors-accounts-save">
            Save
          </Button>
        </View>
      </View>
    ),
    [every, onClose, save],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={480}
    >
      <View style={settingsStyles.card}>
        {accounts.map((account, index) => (
          <AccountOption
            key={account.id}
            account={account}
            bordered={index > 0}
            checked={selection === "all" || selection.includes(account.id)}
            onToggle={toggle}
          />
        ))}
      </View>
      <Text style={[settingsStyles.rowHint, styles.note]}>
        {selection === "all"
          ? "Every account, including ones connected later."
          : "Only the checked accounts. The agent names the account on each call; with one, Clisbot names it."}
      </Text>
    </AdaptiveModalSheet>
  );
}

function AccountOption({
  account,
  bordered,
  checked,
  onToggle,
}: {
  account: ConnectorAccount;
  bordered: boolean;
  checked: boolean;
  onToggle(id: string): void;
}) {
  return (
    <CheckOption
      id={account.id}
      bordered={bordered}
      checked={checked}
      onToggle={onToggle}
      testID={`connectors-account-option-${account.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{accountLabel(account)}</Text>
        <Text style={settingsStyles.rowHint}>{account.id}</Text>
      </View>
    </CheckOption>
  );
}

const styles = StyleSheet.create((theme) => ({
  footer: {
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  group: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  note: { marginTop: theme.spacing[3] },
}));
