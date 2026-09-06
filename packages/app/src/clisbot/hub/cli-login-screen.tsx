import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useFetchQuery } from "@/data/query";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { SettingsSection } from "@/screens/settings/settings-section";
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
import { openCliLoginForm, type CliLoginFormState } from "./cli-login-form";
import { buildHubSettingsRoute } from "./navigation";

const CliAuthorizationSchema = z.object({
  expiresAt: z.string().datetime(),
  organization: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  }),
  canManage: z.boolean(),
});

const CliAuthorizationDecisionSchema = z.object({
  status: z.enum(["approved", "denied"]),
});

export function HubCliLoginScreen() {
  const hub = useHubAccount();
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const routeCode = (Array.isArray(params.code) ? params.code[0] : params.code)?.trim() ?? "";
  const account = hub.signedIn;
  if (!hub.enabled) return null;
  return (
    <View style={styles.scroll}>
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
  const openAddProject = useOpenAddProject();
  const hosts = useHosts();
  const organizationId = hub.signedIn?.organization.id ?? null;
  const accountId = hub.signedIn?.account.id ?? null;
  const [model] = useState(() =>
    openCliLoginForm({
      code,
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
    if (decision !== "approved" || state.discoveryExpired) return;
    const timer = setTimeout(
      model.expireDiscovery,
      Math.max(0, state.discoveryDeadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [decision, model, state.discoveryDeadline, state.discoveryExpired]);
  const findDiscoveredHost = useCallback(
    (daemons: readonly DaemonReference[]) => {
      if (state.baseline === null) return undefined;
      return findNewlyEnrolledHost({ hosts, daemons, baseline: state.baseline });
    },
    [hosts, state.baseline],
  );
  const daemonCatalog = useFetchQuery({
    queryKey: hubResourceQueryKey({ origin: hub.origin, organizationId, accountId }, "daemons"),
    queryFn: () => hub.api().get("daemons", HubDaemonsSchema),
    dataShape: "value",
    enabled: organizationId !== null && decision === "approved" && !state.discoveryExpired,
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
    if (authorization.data?.canManage && authorization.data.organization.id === organizationId) {
      void model.decide("approve", authorization.data.organization.id);
    }
  }, [authorization.data, model, organizationId]);
  const deny = useCallback(() => {
    if (authorization.data?.canManage && authorization.data.organization.id === organizationId) {
      void model.decide("deny", authorization.data.organization.id);
    }
  }, [authorization.data, model, organizationId]);
  const retryInspection = useCallback(() => void authorization.refetch(), [authorization]);
  const retryDiscovery = useCallback(() => {
    model.retryDiscovery();
    void daemonCatalog.refetch();
  }, [daemonCatalog, model]);
  const openHosts = useCallback(() => router.push(buildHubSettingsRoute("account")), [router]);
  const addProject = useCallback(() => {
    if (discoveredHost) openAddProject(discoveredHost.serverId);
  }, [discoveredHost, openAddProject]);

  if (decision === "denied") {
    return (
      <SettingsSection title="CLI login">
        <Alert
          variant="warning"
          title="CLI login denied"
          description="You can close this window and return to the terminal."
        />
      </SettingsSection>
    );
  }
  if (decision === "approved") {
    return (
      <CliHostDiscovery
        host={discoveredHost}
        connected={discoveredHostIsConnected}
        failed={state.discoveryExpired || daemonCatalog.isError}
        retry={retryDiscovery}
        openHosts={openHosts}
        addProject={addProject}
      />
    );
  }
  if (submittedCode.length === 0) return <CliCodeEntry model={model} state={state} />;
  return (
    <SettingsSection title="Approve CLI login">
      <CliAuthorizationReview
        authorization={authorization}
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
    <SettingsSection title="Log in the Paseo CLI">
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
  addProject,
}: {
  host: { label: string } | undefined;
  connected: boolean;
  failed: boolean;
  retry(): void;
  openHosts(): void;
  addProject(): void;
}) {
  if (host !== undefined) {
    return (
      <SettingsSection title="Connect host">
        <Alert
          variant="success"
          title={`${host.label} was added to Paseo`}
          description={
            connected
              ? "The Host is online and ready for Projects and Agents."
              : "The Host was added and Paseo is connecting to it."
          }
        />
        {connected ? (
          <Button onPress={addProject}>Add a project</Button>
        ) : (
          <Button variant="outline" onPress={openHosts}>
            Open Hosts
          </Button>
        )}
      </SettingsSection>
    );
  }
  return (
    <SettingsSection title="Connect host">
      <Alert
        variant={failed ? "warning" : "success"}
        title={failed ? "CLI approved; host not detected" : "CLI login approved"}
        description={
          failed
            ? "Confirm enrollment in the terminal, then retry. If this host is already enrolled, open Hosts to continue."
            : "Return to the terminal and confirm Connect this daemon to Paseo Hub. Paseo will add the host automatically."
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
  model: CliLoginFormModel;
  state: CliLoginFormState;
  approve(): void;
  deny(): void;
  retry(): void;
  openAccount(): void;
}) {
  if (authorization.isPending)
    return <Text style={settingsStyles.rowHint}>Checking the login request...</Text>;
  if (authorization.error) {
    return (
      <Alert
        variant="error"
        title="CLI login unavailable"
        description="Check the code and Hub connection, or start Hub login again from the terminal if the request expired."
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
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text selectable style={settingsStyles.rowTitle}>
              {state.submittedCode}
            </Text>
            <Text style={settingsStyles.rowTitle}>{authorization.data.organization.name}</Text>
            <Text style={settingsStyles.rowHint}>
              The CLI can list Projects, install configuration, enroll Hosts, and start Automation
              runs for this organization until its credential is revoked.
            </Text>
          </View>
        </View>
      </View>
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
              Approve CLI login
            </Button>
          </View>
        </>
      ) : (
        <Alert
          variant="info"
          title="Owner or admin approval required"
          description="An organization owner or admin must approve this CLI login. Sign in with an account that can manage this organization."
        >
          <Button size="sm" variant="outline" onPress={openAccount}>
            Open account
          </Button>
        </Alert>
      )}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
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
