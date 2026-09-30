import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { HubEnrollmentRequestSchema } from "@clisbot/protocol/messages";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import { Home, Settings } from "lucide-react-native";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import { iconButtonChromeGlyphSize } from "@/components/ui/icon-button-chrome";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useFetchQuery } from "@/data/query";
import { useIsCompactFormFactor } from "@/constants/layout";
import { buildOpenProjectRoute, buildSettingsRoute } from "@/utils/host-routes";
import { ConnectedHostActions } from "./connected-host-actions";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "./account-provider";
import { HubDaemonsSchema } from "./contracts";
import { hubResourceQueryKey } from "./query-keys";
import {
  findNewlyEnrolledHost,
  hubHostDiscoveryRefetchInterval,
  type DaemonReference,
} from "./managed-host-discovery";
import { HubSettingsContent } from "./settings";
import {
  createCliLoginCompletionCache,
  openCliLoginForm,
  type CliLoginFormState,
} from "./cli-login-form";
import { buildHubSettingsRoute } from "./navigation";
import { CliAuthorizationSummary, type CliAuthorizationSubject } from "./cli-authorization-summary";
import { roleLabel } from "./organization-identity";

const completedForms = createCliLoginCompletionCache();
const NO_SHORTCUTS: [] = [];
const ThemedHome = withUnistyles(Home);
const ThemedSettings = withUnistyles(Settings);

const CliAuthorizationSchema = z.object({
  expiresAt: z.string().datetime(),
  organization: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  }),
  canManage: z.boolean(),
  enrollment: HubEnrollmentRequestSchema.nullable().optional(),
});

const CliAuthorizationDecisionSchema = z.object({
  status: z.enum(["approved", "denied"]),
});

export function HubCliLoginScreen() {
  const hub = useHubAccount();
  const router = useRouter();
  const home = useCallback(() => router.push(buildOpenProjectRoute()), [router]);
  const settings = useCallback(() => router.push(buildSettingsRoute()), [router]);
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const routeCode = (Array.isArray(params.code) ? params.code[0] : params.code)?.trim() ?? "";
  const account = hub.signedIn;
  if (!hub.enabled) return null;
  return (
    <View style={styles.scroll}>
      <View style={styles.navigation}>
        <HeaderToggleButton
          onPress={home}
          tooltipLabel="Home"
          tooltipKeys={NO_SHORTCUTS}
          tooltipSide="bottom"
          accessibilityRole="button"
          accessibilityLabel="Home"
        >
          <ThemedHome size={iconButtonChromeGlyphSize("large")} uniProps={mutedIconColorMapping} />
        </HeaderToggleButton>
        <HeaderToggleButton
          onPress={settings}
          tooltipLabel="Settings"
          tooltipKeys={NO_SHORTCUTS}
          tooltipSide="bottom"
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <ThemedSettings
            size={iconButtonChromeGlyphSize("large")}
            uniProps={mutedIconColorMapping}
          />
        </HeaderToggleButton>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.panel}>
          {hub.loading || account === null ? (
            <HubSettingsContent section="account" />
          ) : (
            <CliLoginForm
              key={JSON.stringify([
                hub.origin,
                account.account.id,
                account.organization.id,
                routeCode,
              ])}
              code={routeCode}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function CliLoginForm({ code }: { code: string }) {
  const hub = useHubAccount();
  const router = useRouter();
  const hosts = useHosts();
  const organizationId = hub.signedIn?.organization.id ?? null;
  const accountId = hub.signedIn?.account.id ?? null;
  const approver = useApprover(hub);
  const receiptScope = JSON.stringify([hub.origin, accountId, organizationId, code]);
  const [model] = useState(() =>
    openCliLoginForm({
      code,
      completed: code ? completedForms.read(receiptScope) : undefined,
      onCompleted: (completed) => {
        if (code && completed.submittedCode === code.trim())
          completedForms.save(receiptScope, completed);
      },
      readDaemons: () =>
        hub
          .api()
          .get("daemons", HubDaemonsSchema)
          .then((result) => result.daemons),
      decide: (input) =>
        hub.api().postAuth("cli-authorizations/decision", input, CliAuthorizationDecisionSchema),
    }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const { submittedCode, decision } = state;
  useEffect(() => {
    model.mount();
    return model.close;
  }, [model]);
  useEffect(() => {
    if (decision !== "approved" || !state.enrollment || state.discoveryExpired) return;
    const timer = setTimeout(
      model.expireDiscovery,
      Math.max(0, state.discoveryDeadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [decision, model, state.enrollment, state.discoveryDeadline, state.discoveryExpired]);
  const findDiscoveredHost = useCallback(
    (daemons: readonly DaemonReference[]) => {
      if (state.baseline === null) return undefined;
      return findNewlyEnrolledHost({
        hosts,
        daemons,
        baseline: state.baseline,
        expectedServerId: state.enrollment?.serverId,
      });
    },
    [hosts, state.baseline, state.enrollment],
  );
  const daemonCatalog = useFetchQuery({
    queryKey: hubResourceQueryKey({ origin: hub.origin, organizationId, accountId }, "daemons"),
    queryFn: () => hub.api().get("daemons", HubDaemonsSchema),
    dataShape: "value",
    enabled:
      organizationId !== null &&
      decision === "approved" &&
      state.enrollment !== null &&
      !state.discoveryExpired,
    retry: false,
    refetchInterval: (query) =>
      hubHostDiscoveryRefetchInterval({
        deadline: state.discoveryDeadline,
        now: Date.now(),
        hostDiscovered: findDiscoveredHost(query.state.data?.daemons ?? []) !== undefined,
      }),
    refetchIntervalInBackground: true,
    staleTimeMs: 0,
  });
  const discoveredHost =
    decision === "approved" ? findDiscoveredHost(daemonCatalog.data?.daemons ?? []) : undefined;
  const discoveredHostIsConnected = useHostRuntimeIsConnected(discoveredHost?.serverId ?? "");

  const authorization = useFetchQuery({
    queryKey: [
      "clisbot",
      "hub",
      hub.origin,
      accountId,
      organizationId,
      "cli-authorization",
      submittedCode,
    ],
    queryFn: () =>
      hub
        .api()
        .postAuth(
          "cli-authorizations/inspect",
          { userCode: submittedCode },
          CliAuthorizationSchema,
        ),
    dataShape: "value",
    enabled: hub.signedIn !== null && submittedCode.length > 0 && decision === null,
    retry: false,
    staleTimeMs: 0,
  });
  const approve = useCallback(() => {
    recordAuthorizationDecision(authorization.data, organizationId, model, "approve");
  }, [authorization.data, model, organizationId]);
  const deny = useCallback(() => {
    recordAuthorizationDecision(authorization.data, organizationId, model, "deny");
  }, [authorization.data, model, organizationId]);
  const retryInspection = useCallback(() => void authorization.refetch(), [authorization]);
  const retryDiscovery = useCallback(() => {
    model.retryDiscovery();
    void daemonCatalog.refetch();
  }, [daemonCatalog, model]);
  const openHosts = useCallback(() => router.push(buildHubSettingsRoute("hosts")), [router]);

  if (decision !== null) {
    return (
      <CliAuthorizationResult
        decision={decision}
        enrollment={state.enrollment !== null}
        host={discoveredHost}
        connected={discoveredHostIsConnected}
        failed={state.discoveryExpired || daemonCatalog.isError}
        retry={retryDiscovery}
        openHosts={openHosts}
      />
    );
  }
  if (submittedCode.length === 0) return <CliCodeEntry model={model} state={state} />;
  return (
    <SettingsSection
      title={authorization.data?.enrollment ? "Connect Host" : "Advanced CLI access"}
    >
      <CliAuthorizationReview
        authorization={authorization}
        account={approver}
        hubOrigin={hub.origin}
        model={model}
        state={state}
        approve={approve}
        deny={deny}
        retry={retryInspection}
        openAccount={openHosts}
      />
    </SettingsSection>
  );
}

type CliLoginFormModel = ReturnType<typeof openCliLoginForm>;

function CliCodeEntry({ model, state }: { model: CliLoginFormModel; state: CliLoginFormState }) {
  const compact = useIsCompactFormFactor();
  return (
    <SettingsSection title="Approve a terminal request">
      <Field label="Verification code" hint="Only approve a code you requested yourself.">
        <FormTextInput
          initialValue={state.enteredCode}
          onChangeText={model.setCode}
          size={compact ? "md" : "sm"}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!state.pending}
        />
      </Field>
      <Button disabled={state.enteredCode.trim().length === 0} onPress={model.inspect}>
        Continue
      </Button>
    </SettingsSection>
  );
}

function CliHostDiscovery({
  host,
  connected,
  failed,
  retry,
  openHosts,
}: {
  host: { serverId: string; label: string } | undefined;
  connected: boolean;
  failed: boolean;
  retry(): void;
  openHosts(): void;
}) {
  if (host !== undefined) {
    return (
      <SettingsSection title="Connect host">
        <Alert
          variant="success"
          title={`${host.label} was added to Clisbot`}
          description={
            connected
              ? "The Host is online. Choose what to do next, or continue to the app."
              : "The Host was added and Clisbot is connecting to it."
          }
        />
        <ConnectedHostActions serverId={host.serverId} connected={connected} />
        {!connected ? (
          <Button variant="outline" onPress={openHosts}>
            Open Hosts
          </Button>
        ) : null}
      </SettingsSection>
    );
  }
  return (
    <SettingsSection title="Connect host">
      <Alert
        variant={failed ? "warning" : "success"}
        title={failed ? "Connection approved; Host not detected" : "Host connection approved"}
        description={
          failed
            ? "Open Hosts to check the connection. If it is missing, check the daemon logs, then retry discovery."
            : "Clisbot is connecting the approved Host automatically. Let the terminal command finish; this page follows the connection."
        }
      >
        {failed ? (
          <Button size="sm" variant="outline" onPress={retry}>
            Retry
          </Button>
        ) : null}
      </Alert>
      {!failed ? (
        <Text style={settingsStyles.rowHint}>Waiting for the enrolled host...</Text>
      ) : null}
      <Button variant="outline" onPress={openHosts}>
        Open Hosts
      </Button>
    </SettingsSection>
  );
}

function CliAuthorizationReview({
  authorization,
  account,
  hubOrigin,
  model,
  state,
  approve,
  deny,
  retry,
  openAccount,
}: {
  authorization: {
    isPending: boolean;
    error: unknown;
    data: z.infer<typeof CliAuthorizationSchema> | undefined;
  };
  account: CliAuthorizationSubject["account"];
  hubOrigin: string | null;
  model: CliLoginFormModel;
  state: CliLoginFormState;
  approve(): void;
  deny(): void;
  retry(): void;
  openAccount(): void;
}) {
  if (authorization.isPending)
    return <Text style={settingsStyles.rowHint}>Checking the request...</Text>;
  if (authorization.error) {
    return (
      <Alert
        variant="error"
        title="Request unavailable"
        description="Check the code and Hub connection, or run the terminal command again from the terminal if the request expired."
      >
        <Button size="sm" variant="outline" onPress={retry}>
          Retry
        </Button>
        <Button size="sm" variant="outline" onPress={model.editCode}>
          Enter another code
        </Button>
      </Alert>
    );
  }
  if (authorization.data === undefined) return null;
  return (
    <>
      <CliAuthorizationSummary
        organization={authorization.data.organization}
        account={account}
        hubOrigin={hubOrigin}
        code={state.submittedCode}
        expiresAt={authorization.data.expiresAt}
        enrollment={authorization.data.enrollment}
      />
      {authorization.data.canManage ? (
        <>
          {state.error ? (
            <Alert
              variant="error"
              title="Could not record the decision"
              description={state.error}
            />
          ) : null}
          <View style={styles.actions}>
            <Button variant="outline" disabled={state.pending} onPress={model.editCode}>
              Enter another code
            </Button>
            <Button variant="outline" disabled={state.pending} onPress={deny}>
              Deny
            </Button>
            <Button loading={state.pending} disabled={state.pending} onPress={approve}>
              {`Approve for ${authorization.data.organization.name}`}
            </Button>
          </View>
        </>
      ) : (
        <Alert
          variant="info"
          title="Owner or admin approval required"
          description="An organization owner or admin must approve this request. Sign in with an account that can manage this organization."
        >
          <Button size="sm" variant="outline" onPress={openAccount}>
            Open account
          </Button>
        </Alert>
      )}
    </>
  );
}

/** The signed-in account that will approve, shown next to the organization it approves for. */
function useApprover(hub: ReturnType<typeof useHubAccount>) {
  const email = hub.signedIn?.account.email;
  const role = hub.signedIn?.membership.role;
  return useMemo(
    () => (email && role ? { email, roleLabel: roleLabel(role) } : null),
    [email, role],
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  navigation: {
    flexDirection: "row",
    justifyContent: "flex-end",
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  content: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[8],
  },
  panel: {
    width: "100%",
    maxWidth: 720,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));

function recordAuthorizationDecision(
  authorization: z.infer<typeof CliAuthorizationSchema> | undefined,
  organizationId: string | null,
  model: CliLoginFormModel,
  decision: "approve" | "deny",
) {
  if (!authorization?.canManage || authorization.organization.id !== organizationId) return;
  void model.decide(decision, organizationId, authorization.enrollment ?? null);
}

function CliAuthorizationResult({
  decision,
  enrollment,
  ...discovery
}: Parameters<typeof CliHostDiscovery>[0] & {
  decision: "approved" | "denied";
  enrollment: boolean;
}) {
  if (decision === "denied")
    return (
      <SettingsSection title="Request denied">
        <Alert
          variant="warning"
          title="Request denied"
          description="You can close this window and return to the terminal."
        />
      </SettingsSection>
    );
  if (!enrollment)
    return (
      <SettingsSection title="Advanced CLI access">
        <Alert
          variant="success"
          title="CLI login approved"
          description="Return to the terminal. This grants organization API access; it does not add a Host. Use hub connect to add a Host."
        />
      </SettingsSection>
    );
  return <CliHostDiscovery {...discovery} />;
}
