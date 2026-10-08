import { useHubEditLock } from "@/device-access/hub-edit-lock";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { i18n } from "@/i18n/i18next";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { routeBotKey, type RouteBotRequest } from "../channel-route-bot";
import { AddChannelConnection } from "./channel-connection-add";
import {
  ConnectionLoginStep,
  editorStep,
  useConnectionLogin,
  type EditorStep,
} from "./channel-connection-login-step";
import { BackLink } from "./back-link";
import { DetailHeader } from "./detail-header";
import { QueryFeedback } from "./access-settings-feedback";
import {
  type ChannelEditor,
  EMPTY_RECORD,
  type HubAutomations,
  type HubChannelConfiguration,
  type HubConnection,
  type HubConnections,
  type HubDaemons,
  type HubTeams,
  type RecordValue,
} from "./channel-settings-types";
import { ChannelAccountForm } from "./channel-route-form";

function ChannelRouteEditorHeader({
  title,
  backTo,
  pending,
  error,
  back,
}: {
  title: string;
  pending: boolean;
  error: string | null;
  back(): void;
  backTo?: string;
}) {
  const { t } = useTranslation();
  // The way back, then the page's own title, as every Hub detail page reads.
  return (
    <>
      <BackLink
        to={backTo ?? t("hub.routes.editor.connections")}
        onPress={back}
        disabled={pending}
      />
      <DetailHeader title={title} />
      {error ? <Alert variant="error" title={error} /> : null}
    </>
  );
}

interface ChannelManagementSectionProps {
  editor: ChannelEditor;
  automationName?: string;
  error: string | null;
  queries: Array<{ isPending: boolean; error: Error | null }>;
  retry(): void;
  channels: HubChannelConfiguration | undefined;
  connections: HubConnections | undefined;
  automations: HubAutomations | undefined;
  daemons: HubDaemons | undefined;
  teams: HubTeams | undefined;
  channelConnections: HubConnection[];
  pending: boolean;
  isInstanceOperator: boolean;
  adminScoped: boolean;
  cancelRouteEdit(): void;
  createRouteAutomation(yaml: string): Promise<string>;
  saveChannelBehavior(
    accounts: RecordValue[],
    resource: RecordValue,
    createdAccountKey?: string,
  ): void;
  saveConnection(body: unknown): Promise<HubConnection>;
}

export function ChannelManagementSection(props: ChannelManagementSectionProps) {
  const { editor, automationName, error, queries, pending, adminScoped, cancelRouteEdit } = props;
  const { channels, connections, automations, daemons, teams } = props;
  useHubEditLock();
  const adding = useAddConnectionStep(editor, props.saveConnection);
  const { login, step } = adding;
  const editing = editor.kind === "edit" ? editor.route : null;
  const accountKey = editor.kind === "add" ? editor.accountKey : null;
  const fixedAccount = editor.kind === "edit" || editor.fixed;
  const title = channelEditorTitle(editor, step);
  const backTo = automationName ? i18n.t("hub.routes.editor.automationInputs") : undefined;
  if (
    channels === undefined ||
    connections === undefined ||
    automations === undefined ||
    daemons === undefined ||
    teams === undefined
  )
    return (
      <ChannelEditorUnavailable
        title={title}
        backTo={backTo}
        pending={pending}
        error={error}
        queries={queries}
        retry={props.retry}
        back={cancelRouteEdit}
      />
    );
  return (
    <>
      <ChannelRouteEditorHeader
        title={title}
        backTo={backTo}
        pending={pending || adding.connectionPending}
        error={error}
        back={cancelRouteEdit}
      />
      <QueryFeedback queries={queries} />
      {login.loginFor === null ? null : (
        <ConnectionLoginStep target={login.loginFor} done={login.finish} />
      )}
      <View style={step === "route" ? undefined : styles.hidden}>
        <ChannelAccountForm
          automationName={automationName}
          connections={props.channelConnections}
          {...(fixedAccount || adminScoped ? {} : { connectChannelAccount: adding.openConnection })}
          automationConnections={connections.connections}
          automations={automations.automations}
          daemons={daemons.daemons}
          teams={teams.teams}
          resource={channels.resource ?? EMPTY_RECORD}
          policy={channels.policy}
          existingAccounts={channels.accounts}
          editing={editing}
          initialAccountKey={accountKey}
          initialBot={requestedBot(editor)}
          fixedAccount={fixedAccount}
          createdConnectionId={adding.createdConnectionId}
          pending={pending}
          adminScoped={adminScoped}
          saveError={error}
          cancelEdit={cancelRouteEdit}
          createRouteAutomation={props.createRouteAutomation}
          save={props.saveChannelBehavior}
        />
      </View>
      {adding.addingConnection ? (
        <AddConnectionPanel
          allowProviderApplications={props.isInstanceOperator}
          pending={adding.connectionPending}
          connectFirst={adding.connectFirst}
          create={adding.submitConnection}
          close={adding.closeConnection}
        />
      ) : null}
    </>
  );
}

/**
 * Add Connection inside the Route form: whether its connect step shows, the
 * login a QR Connection needs next, and the Connection the form starts on.
 */
function useAddConnectionStep(
  editor: ChannelEditor,
  saveConnection: (body: unknown) => Promise<HubConnection>,
) {
  // A Connection with no Routes starts picked, as a just-created one does.
  const [createdConnectionId, setCreatedConnectionId] = useState(() =>
    preselectedConnectionId(editor),
  );
  // Add Connection opens on the connect step. Its way out to the form is the
  // one way to give a Connection that has no Route yet its first Route.
  const connectFirst = editor.kind === "add" && editor.connect === true;
  const [addingConnection, setAddingConnection] = useState(connectFirst);
  const [connectionPending, setConnectionPending] = useState(false);
  // A QR Connection logs in right after it is named, before its first Route.
  const login = useConnectionLogin();
  const { created: connectionCreated } = login;
  const openConnection = useCallback(() => setAddingConnection(true), []);
  const closeConnection = useCallback(() => setAddingConnection(false), []);
  // The form renders the Hub's own guidance for a rejection, so this only has to
  // hold the pending flag the two navigation exits are disabled by, and rethrow.
  const submitConnection = useCallback(
    async (body: Record<string, unknown>) => {
      setConnectionPending(true);
      try {
        const created = await saveConnection(body);
        setCreatedConnectionId(created.id);
        setAddingConnection(false);
        connectionCreated(created);
      } finally {
        setConnectionPending(false);
      }
    },
    [connectionCreated, saveConnection],
  );
  return {
    createdConnectionId,
    connectFirst,
    addingConnection,
    connectionPending,
    login,
    step: editorStep(login.loginFor !== null, addingConnection),
    openConnection,
    closeConnection,
    submitConnection,
  };
}

/** The Route form's page while what it picks from has not loaded. */
function ChannelEditorUnavailable({
  title,
  backTo,
  pending,
  error,
  queries,
  retry,
  back,
}: {
  title: string;
  backTo: string | undefined;
  pending: boolean;
  error: string | null;
  queries: Array<{ isPending: boolean; error: Error | null }>;
  retry(): void;
  back(): void;
}) {
  const { t } = useTranslation();
  return (
    <View>
      <ChannelRouteEditorHeader
        title={title}
        backTo={backTo}
        pending={pending}
        error={error}
        back={back}
      />
      <SettingsSection title={t("hub.routes.editor.channelSetup")}>
        <QueryFeedback queries={queries} />
        <Button size="sm" variant="outline" onPress={retry}>
          {t("hub.routes.editor.retry")}
        </Button>
      </SettingsSection>
    </View>
  );
}

/** Add Connection's connect step, and its way back to the Route form. */
function AddConnectionPanel({
  allowProviderApplications,
  pending,
  connectFirst,
  create,
  close,
}: {
  allowProviderApplications: boolean;
  pending: boolean;
  connectFirst: boolean;
  create(body: Record<string, unknown>): Promise<void>;
  close(): void;
}) {
  const { t } = useTranslation();
  return (
    <View>
      <AddChannelConnection
        allowProviderApplications={allowProviderApplications}
        disabled={pending}
        create={create}
      />
      {connectFirst ? (
        <Button size="sm" variant="ghost" disabled={pending} onPress={close}>
          {t("hub.routes.editor.useExisting")}
        </Button>
      ) : (
        <BackLink to={t("hub.routes.editor.theRoute")} onPress={close} disabled={pending} />
      )}
    </View>
  );
}

function preselectedConnectionId(editor: ChannelEditor): string | null {
  return editor.kind === "add" ? (editor.connectionId ?? null) : null;
}

function requestedBot(editor: ChannelEditor): RouteBotRequest | null {
  return editor.kind === "add" ? (editor.bot ?? null) : null;
}

function channelEditorTitle(editor: ChannelEditor, step: EditorStep): string {
  if (editor.kind === "edit")
    return i18n.t("hub.routes.editor.editRoute", { number: editor.route.routeIndex + 1 });
  // Logging in is the last part of adding the Connection; its section says Login.
  return step === "route"
    ? i18n.t("hub.routes.editor.addRoute")
    : i18n.t("hub.routes.editor.addConnection");
}

export function channelFormKey(editor: ChannelEditor): string {
  if (editor.kind === "edit")
    return `${editor.route.accountKey}:${String(editor.route.routeIndex)}`;
  const bot = editor.bot === undefined ? "" : routeBotKey(editor.bot.serverId, editor.bot.botId);
  return `add-route:${editor.accountKey ?? ""}:${String(editor.fixed)}:${String(editor.connect === true)}:${editor.connectionId ?? ""}:${bot}`;
}

const styles = StyleSheet.create({
  hidden: { display: "none" },
});
