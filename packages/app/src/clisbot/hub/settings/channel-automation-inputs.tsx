import { AutomationInputDraftContext } from "./automation-input-draft";
import { useContext } from "react";
import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { QueryFeedback } from "./access-settings-feedback";
import {
  type EditingRoute,
  type HubChannelConfiguration,
  type RecordValue,
} from "./channel-settings-types";
import {
  arrayField,
  channelAccountKey,
  channelAccountLabel,
  useChannelName,
} from "./channel-settings-records";
import { ChannelAccountRouteList } from "./channel-route-rows";

/** The Connections whose Routes feed one Automation, and the picker that adds one. */
export function AutomationChannelInputs({
  automationName,
  embedded,
  configuration,
  queries,
  mutationError,
  testResult,
  choosingInput,
  toggleChoosingInput,
  pending,
  editRoute,
  addRoute,
  addRouteTo,
  moveRoute,
  removeRoute,
}: {
  automationName: string;
  embedded: boolean;
  /** The accounts it lists, and the policy whose `defaults:` their Rules inherit. */
  configuration: HubChannelConfiguration | undefined;
  queries: Array<{ isPending: boolean; error: Error | null }>;
  mutationError: string | null;
  testResult: string | null;
  choosingInput: boolean;
  toggleChoosingInput(): void;
  pending: boolean;
  editRoute(route: EditingRoute): void;
  addRoute(): void;
  addRouteTo(accountKey: string): void;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
}) {
  const inputDraft = useContext(AutomationInputDraftContext);
  const choosing = Boolean(inputDraft) || choosingInput;
  const accounts = configuration?.accounts as RecordValue[] | undefined;
  const policy = configuration?.policy;
  const inputAccounts = (accounts ?? []).filter((account) =>
    inputDraft
      ? account.channel === inputDraft.provider
      : choosingInput || accountFeedsAutomation(account, automationName),
  );
  const trailing = useMemo(
    () =>
      embedded || inputDraft ? undefined : (
        <Button size="sm" variant="outline" onPress={toggleChoosingInput}>
          {choosingInput ? "Cancel" : "Add input"}
        </Button>
      ),
    [choosingInput, embedded, inputDraft, toggleChoosingInput],
  );
  const empty =
    !choosing &&
    accounts !== undefined &&
    !accounts.some((account) => accountFeedsAutomation(account, automationName));
  return (
    <AutomationInputSection embedded={embedded} trailing={trailing}>
      <QueryFeedback queries={queries} />
      {mutationError ? <Alert variant="error" title={mutationError} /> : null}
      {testResult ? <Alert variant="success" title={testResult} /> : null}
      {empty ? <Text style={settingsStyles.rowHint}>No Channel inputs configured.</Text> : null}
      {inputAccounts.map((account) => (
        <AutomationChannelAccount
          key={channelAccountKey(account)}
          account={account}
          policy={policy}
          choosing={choosing}
          automationName={automationName}
          pending={pending}
          editRoute={editRoute}
          addRouteTo={addRouteTo}
          moveRoute={moveRoute}
          removeRoute={removeRoute}
        />
      ))}
      {choosing ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending || accounts === undefined}
          onPress={addRoute}
        >
          Use another Connection
        </Button>
      ) : null}
    </AutomationInputSection>
  );
}

/** True when one of the account's Routes runs this Automation. */
function accountFeedsAutomation(account: RecordValue, automationName: string): boolean {
  return arrayField(account, "routes").some(
    (route) => (route as RecordValue).workflow === automationName,
  );
}

function AutomationChannelAccount({
  choosing,
  account,
  policy,
  automationName,
  pending,
  editRoute,
  addRouteTo,
  removeRoute,
  moveRoute,
}: {
  choosing: boolean;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  account: RecordValue;
  policy: RecordValue | undefined;
  automationName: string;
  pending: boolean;
  editRoute(route: EditingRoute): void;
  addRouteTo(accountKey: string): void;
  removeRoute(account: RecordValue, index: number): Promise<void>;
}) {
  const add = useCallback(() => addRouteTo(channelAccountKey(account)), [account, addRouteTo]);
  const channelName = useChannelName();
  const routes = arrayField(account, "routes") as RecordValue[];
  return (
    <View style={settingsStyles.card}>
      <View style={settingsStyles.row}>
        <Text style={settingsStyles.rowTitle}>{channelAccountLabel(account, channelName)}</Text>
        {choosing ? (
          <Button size="sm" variant="outline" disabled={pending} onPress={add}>
            Add input here
          </Button>
        ) : null}
      </View>
      <ChannelAccountRouteList
        visible
        account={account}
        policy={policy}
        accountKey={channelAccountKey(account)}
        routes={routes}
        canManage
        pending={pending}
        editRoute={editRoute}
        moveRoute={moveRoute}
        removeRoute={removeRoute}
        automationName={automationName}
      />
    </View>
  );
}

function AutomationInputSection({
  embedded,
  children,
  trailing,
}: {
  embedded: boolean;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return embedded ? (
    <View>{children}</View>
  ) : (
    <SettingsSection title="Inputs" trailing={trailing}>
      {children}
    </SettingsSection>
  );
}
