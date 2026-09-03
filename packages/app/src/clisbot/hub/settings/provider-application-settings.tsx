import { useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { ExternalLink } from "@/components/ui/external-link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useFetchQuery } from "@/data/query";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useHubAccount } from "../account-provider";
import {
  HubConnectionContinuationSchema,
  HubConnectionSchema,
  HubProviderApplicationDeliveryRetrySchema,
  HubProviderApplicationSaveResultSchema,
  HubProviderApplicationSetupGuideSchema,
  HubProviderApplicationSchema,
  HubProviderApplicationsSchema,
} from "../contracts";
import {
  HUB_PROVIDER_APPLICATION_PROVIDERS,
  isHubProviderApplicationField,
  openHubProviderApplicationForm,
  type HubProviderApplicationFormState,
  type HubProviderApplicationFormSnapshot,
  type HubProviderApplicationProvider,
  type HubProviderApplicationSubmission,
} from "../provider-application-form";

type ProviderApplication = z.infer<typeof HubProviderApplicationSchema>;
type ProviderApplicationSetupGuide = z.infer<typeof HubProviderApplicationSetupGuideSchema>;

interface ApplicationDraft extends HubProviderApplicationFormSnapshot {
  key: string;
}

const PROVIDER_OPTIONS: SelectFieldOption<HubProviderApplicationProvider>[] =
  HUB_PROVIDER_APPLICATION_PROVIDERS.map((provider) => ({
    id: provider,
    value: provider,
    label: providerLabel(provider),
  }));
const SLACK_DELIVERY_OPTIONS: SelectFieldOption<"socket" | "webhook">[] = [
  {
    id: "socket",
    value: "socket",
    label: "Socket Mode",
    description: "Connect from Hub to Slack. No public HTTPS address needed.",
  },
  {
    id: "webhook",
    value: "webhook",
    label: "Webhooks",
    description: "Let Slack send events to a public Hub HTTPS address.",
  },
];
const NOOP = () => undefined;

export function ProviderApplicationSettings() {
  const hub = useHubAccount();
  const queryClient = useQueryClient();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const operator =
    hub.state?.status === "appSetupRequired" ||
    (hub.state?.status === "active" && hub.state.isInstanceOperator);
  const applications = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "provider-applications"],
    queryFn: () => hub.api().get("provider-applications", HubProviderApplicationsSchema),
    enabled: operator && organizationId.length > 0,
    retry: false,
    dataShape: "list",
    staleTimeMs: 15_000,
  });
  const [draft, setDraft] = useState<ApplicationDraft | null>(null);
  const [pendingApplicationId, setPendingApplicationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = useMemo(
    () => (applications.data === undefined ? [] : applicationViews(applications.data)),
    [applications.data],
  );

  const connect = useCallback(
    async (application: ProviderApplication) => {
      const providerApplicationId = application.identity?.id;
      if (providerApplicationId === undefined) return;
      setError(null);
      setPendingApplicationId(providerApplicationId);
      try {
        const continuation = await hub
          .api()
          .post(
            "connections",
            { provider: application.provider, providerApplicationId },
            HubConnectionContinuationSchema,
          );
        await Linking.openURL(continuation.url);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to connect provider account.");
      } finally {
        setPendingApplicationId(null);
      }
    },
    [hub],
  );
  const retryDelivery = useCallback(
    async (application: ProviderApplication) => {
      const providerApplicationId = application.identity?.id;
      if (providerApplicationId === undefined) return;
      setError(null);
      setPendingApplicationId(providerApplicationId);
      try {
        await hub
          .api()
          .post(
            `provider-applications/slack/${encodeURIComponent(providerApplicationId)}/delivery/retry`,
            {},
            HubProviderApplicationDeliveryRetrySchema,
          );
        await applications.refetch();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to retry provider delivery.");
      } finally {
        setPendingApplicationId(null);
      }
    },
    [applications, hub],
  );
  const replaceCredentials = useCallback(
    (application: ProviderApplication, applicationId: string) => {
      setDraft(replacementDraft(application, applicationId));
    },
    [],
  );
  const addApplication = useCallback(() => {
    setDraft({ key: `create:${Date.now()}` });
  }, []);
  const refresh = useCallback(() => {
    void applications.refetch();
  }, [applications]);
  const save = useCallback(
    async (input: HubProviderApplicationSubmission) => {
      if (input.provider === "slack" && input.transport === "socket") {
        await hub.api().post(
          "connections",
          {
            provider: input.provider,
            transport: input.transport,
            credentials: {
              appToken: input.appToken,
              botToken: input.botToken,
            },
            ...(input.expectedVersion === undefined
              ? {}
              : { expectedVersion: input.expectedVersion }),
          },
          HubConnectionSchema,
        );
        return null;
      }
      const result = await hub
        .api()
        .post("provider-applications", input, HubProviderApplicationSaveResultSchema);
      return result.status === "continuing" ? result.url : null;
    },
    [hub],
  );
  const saved = useCallback(
    async (continuationUrl: string | null) => {
      setDraft(null);
      await applications.refetch();
      await queryClient.invalidateQueries({
        queryKey: ["clisbot", "hub", hub.origin, organizationId, "connections"],
      });
      if (continuationUrl !== null) await Linking.openURL(continuationUrl);
    },
    [applications, hub.origin, organizationId, queryClient],
  );
  const closeDraft = useCallback(() => {
    setDraft(null);
  }, []);

  if (!operator) return null;

  return (
    <SettingsSection title="Provider applications">
      <Alert
        variant="info"
        title="Provider credentials are instance-wide"
        description="Applications hold provider app registration. Each organization connects its own account or installation from a verified Application."
      />
      <ProviderApplicationLoadState pending={applications.isPending} error={applications.error} />
      {error ? <Alert variant="error" title={error} /> : null}
      <View style={settingsStyles.card}>
        {visible.length === 0 ? (
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>No Provider Applications configured</Text>
          </View>
        ) : (
          visible.map((application, index) => (
            <ProviderApplicationRow
              key={`${application.provider}:${application.identity?.id ?? "environment"}`}
              application={application}
              bordered={index > 0}
              pendingApplicationId={pendingApplicationId}
              connect={connect}
              retryDelivery={retryDelivery}
              replaceCredentials={replaceCredentials}
            />
          ))
        )}
      </View>
      <View style={styles.sectionActions}>
        <Button variant="outline" disabled={pendingApplicationId !== null} onPress={addApplication}>
          Add provider application
        </Button>
        <Button variant="ghost" disabled={applications.isFetching} onPress={refresh}>
          Refresh
        </Button>
      </View>
      {draft === null ? null : (
        <ProviderApplicationSheet
          key={draft.key}
          snapshot={draft}
          guides={applications.data?.setupGuides ?? []}
          save={save}
          onSaved={saved}
          onClose={closeDraft}
        />
      )}
    </SettingsSection>
  );
}

function ProviderApplicationLoadState({
  pending,
  error,
}: {
  pending: boolean;
  error: Error | null;
}) {
  if (pending) return <Text style={settingsStyles.rowHint}>Loading…</Text>;
  if (error !== null) return <Alert variant="error" title={error.message} />;
  return null;
}

function ProviderApplicationRow({
  application,
  bordered,
  pendingApplicationId,
  connect,
  retryDelivery,
  replaceCredentials,
}: {
  application: ProviderApplication;
  bordered: boolean;
  pendingApplicationId: string | null;
  connect(application: ProviderApplication): Promise<void>;
  retryDelivery(application: ProviderApplication): Promise<void>;
  replaceCredentials(application: ProviderApplication, applicationId: string): void;
}) {
  const identity = application.identity;
  const applicationId = identity?.id ?? `${application.provider}:environment`;
  const connectAccount = useCallback(() => {
    void connect(application);
  }, [application, connect]);
  const retry = useCallback(() => {
    void retryDelivery(application);
  }, [application, retryDelivery]);
  const replace = useCallback(() => {
    replaceCredentials(application, applicationId);
  }, [application, applicationId, replaceCredentials]);
  const canRetry =
    application.provider === "slack" &&
    application.identifiers.transport === "socket" &&
    application.deliveryStatus?.state === "actionNeeded";
  const connectionCount = application.connections.length;

  return (
    <View
      style={[
        settingsStyles.row,
        styles.applicationRow,
        bordered ? settingsStyles.rowBorder : null,
      ]}
    >
      <View style={styles.applicationContent}>
        <View style={styles.titleRow}>
          <Text style={settingsStyles.rowTitle}>
            {`${providerLabel(application.provider)} · ${identity?.name ?? "Application"}`}
          </Text>
          <StatusBadge
            label={statusLabel(application.status)}
            variant={statusVariant(application.status)}
          />
        </View>
        <Text style={settingsStyles.rowHint}>
          {connectionCount === 0
            ? "No Connections"
            : `${String(connectionCount)} Connection${connectionCount === 1 ? "" : "s"}`}
        </Text>
      </View>
      <View style={styles.actions}>
        {identity === null ? null : (
          <Button
            size="xs"
            variant="outline"
            disabled={pendingApplicationId !== null}
            loading={pendingApplicationId === identity.id}
            onPress={connectAccount}
          >
            Connect account
          </Button>
        )}
        {canRetry ? (
          <Button
            size="xs"
            variant="outline"
            disabled={pendingApplicationId !== null}
            loading={pendingApplicationId === identity?.id}
            onPress={retry}
          >
            Retry delivery
          </Button>
        ) : null}
        {application.managedByEnvironment ? null : (
          <Button
            size="xs"
            variant="ghost"
            disabled={pendingApplicationId !== null}
            onPress={replace}
          >
            Replace credentials
          </Button>
        )}
      </View>
    </View>
  );
}

function ProviderApplicationSheet({
  snapshot,
  guides,
  save,
  onSaved,
  onClose,
}: {
  snapshot: HubProviderApplicationFormSnapshot;
  guides: readonly ProviderApplicationSetupGuide[];
  save(input: HubProviderApplicationSubmission): Promise<string | null>;
  onSaved(continuationUrl: string | null): Promise<void>;
  onClose(): void;
}) {
  const compact = useIsCompactFormFactor();
  const size: FieldControlSize = compact ? "md" : "sm";
  const [form] = useState(() => openHubProviderApplicationForm(snapshot));
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  const guide = useMemo(
    () => setupGuideFor(guides, state.provider, state.transport),
    [guides, state.provider, state.transport],
  );
  useEffect(() => () => form.close(), [form]);
  const header = useMemo<SheetHeader>(
    () => ({
      title: state.mode === "replace" ? "Replace provider application" : "Add provider application",
    }),
    [state.mode],
  );
  const submit = useCallback(async () => {
    if (state.submission === null) return;
    form.setSubmitting(true);
    try {
      const result = await save(state.submission);
      await onSaved(result);
    } catch (cause) {
      form.setError(
        cause instanceof Error ? cause.message : "Unable to save Provider Application.",
      );
      form.setSubmitting(false);
    }
  }, [form, onSaved, save, state.submission]);
  const submitForm = useCallback(() => {
    void submit();
  }, [submit]);
  const providerDisplay = useMemo(
    () => ({ label: providerLabel(state.provider) }),
    [state.provider],
  );
  const deliveryDisplay = useMemo(
    () => ({ label: state.transport === "webhook" ? "Webhooks" : "Socket Mode" }),
    [state.transport],
  );
  const close = state.submitting ? NOOP : onClose;
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="secondary" size="md" disabled={state.submitting} onPress={onClose}>
          Cancel
        </Button>
        <Button
          variant="default"
          size="md"
          disabled={!state.canSubmit || guide?.unavailable !== undefined}
          loading={state.submitting}
          onPress={submitForm}
        >
          Verify and save
        </Button>
      </View>
    ),
    [guide?.unavailable, onClose, state.canSubmit, state.submitting, submitForm],
  );

  return (
    <AdaptiveModalSheet
      visible
      header={header}
      footer={footer}
      onClose={close}
      desktopMaxWidth={520}
      sizeContentToCurrentSnapPoint
    >
      <View style={styles.form}>
        {state.mode === "create" ? (
          <SelectField
            label="Provider"
            value={state.provider}
            selectedDisplay={providerDisplay}
            options={PROVIDER_OPTIONS}
            onChange={form.setProvider}
            title="Provider"
            placeholder="Choose a Provider"
            emptyText="No Providers available"
            disabled={state.submitting}
            size={size}
          />
        ) : null}
        {state.provider === "slack" && state.mode === "create" ? (
          <SelectField
            label="Delivery"
            value={state.transport ?? "socket"}
            selectedDisplay={deliveryDisplay}
            options={SLACK_DELIVERY_OPTIONS}
            onChange={form.setSlackTransport}
            title="Slack delivery"
            placeholder="Choose delivery"
            emptyText="No Slack delivery methods available"
            disabled={state.submitting}
            size={size}
          />
        ) : null}
        {guide === undefined ? (
          <Alert variant="error" title="Provider setup is unavailable." />
        ) : (
          <>
            <ProviderSetupGuide guide={guide} />
            <ProviderFields
              state={state}
              fields={guide.groups.flatMap((group) => group.fields)}
              size={size}
              setField={form.setField}
            />
          </>
        )}
        {state.error ? <Alert variant="error" title={state.error} /> : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function ProviderFields({
  state,
  fields,
  size,
  setField,
}: {
  state: HubProviderApplicationFormState;
  fields: ProviderApplicationSetupGuide["groups"][number]["fields"];
  size: FieldControlSize;
  setField: ReturnType<typeof openHubProviderApplicationForm>["setField"];
}) {
  return (
    <>
      {fields.map((field) => (
        <ProviderField
          key={field.name}
          field={field}
          state={state}
          size={size}
          setField={setField}
        />
      ))}
    </>
  );
}

function ProviderField({
  field,
  state,
  size,
  setField,
}: {
  field: ProviderApplicationSetupGuide["groups"][number]["fields"][number];
  state: HubProviderApplicationFormState;
  size: FieldControlSize;
  setField: ReturnType<typeof openHubProviderApplicationForm>["setField"];
}) {
  const name = isHubProviderApplicationField(field.name) ? field.name : null;
  const changeText = useCallback(
    (value: string) => {
      if (name !== null) setField(name, value);
    },
    [name, setField],
  );
  if (name === null) return null;
  return (
    <Field
      label={`${field.label}${field.optional === true ? " (optional)" : ""}`}
      hint={field.description}
    >
      <FormTextInput
        size={size}
        initialValue={state.fields[name]}
        onChangeText={changeText}
        editable={!state.submitting}
        secureTextEntry={field.kind === "secret"}
        multiline={field.kind === "multiline"}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </Field>
  );
}

function ProviderSetupGuide({ guide }: { guide: ProviderApplicationSetupGuide }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((key: string, value: string) => {
    void copyToClipboard(value).then(() => setCopied(key));
  }, []);
  return (
    <View style={styles.guide}>
      <View style={styles.guideHeader}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{guide.name}</Text>
          <Text style={settingsStyles.rowHint}>{guide.summary}</Text>
        </View>
        <ExternalLink href={guide.portal.href} label={guide.portal.label} />
      </View>
      {guide.unavailable === undefined ? null : (
        <Alert variant="warning" title="HTTPS required" description={guide.unavailable} />
      )}
      {guide.groups.map((group) => (
        <View key={group.id} style={styles.guideGroup}>
          {group.title === undefined ? null : (
            <Text style={settingsStyles.rowTitle}>{group.title}</Text>
          )}
          {group.description === undefined ? null : (
            <Text style={settingsStyles.rowHint}>{group.description}</Text>
          )}
          {group.unavailable === undefined ? null : (
            <Alert
              variant="warning"
              title="Unavailable from this Hub URL"
              description={group.unavailable}
            />
          )}
          {group.steps.map((step, index) => {
            const stepKey = `${group.id}:${String(index)}`;
            const manifest = step.manifest;
            return (
              <View key={stepKey} style={styles.guideStep}>
                <Text style={styles.stepNumber}>{String(index + 1)}</Text>
                <View style={styles.stepContent}>
                  <Text style={styles.stepText}>
                    {step.segments.map((segment, segmentIndex) => (
                      <ProviderGuideSegment
                        key={`${stepKey}:${String(segmentIndex)}`}
                        segment={segment}
                      />
                    ))}
                  </Text>
                  {step.urls.map((url) => (
                    <ProviderGuideCopyRow
                      key={url.key}
                      copyKey={`${stepKey}:${url.key}`}
                      label={url.label}
                      value={url.value}
                      copied={copied}
                      copy={copy}
                    />
                  ))}
                  {manifest === undefined ? null : (
                    <ProviderGuideManifest
                      copyKey={`${stepKey}:manifest`}
                      manifest={manifest}
                      copied={copied}
                      copy={copy}
                    />
                  )}
                  {step.permissions === undefined ? null : (
                    <View style={styles.facts}>
                      {step.permissions.map((permission) => (
                        <Text key={permission.name} style={settingsStyles.rowHint}>
                          {`${permission.name}: ${permission.access}`}
                        </Text>
                      ))}
                    </View>
                  )}
                  {step.events === undefined ? null : (
                    <Text
                      style={settingsStyles.rowHint}
                    >{`Events: ${step.events.join(", ")}`}</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      ))}
      {guide.saveHint === undefined ? null : <Alert variant="info" description={guide.saveHint} />}
    </View>
  );
}

type ProviderGuideStep = ProviderApplicationSetupGuide["groups"][number]["steps"][number];
type ProviderGuideSegmentValue = ProviderGuideStep["segments"][number];

function ProviderGuideSegment({ segment }: { segment: ProviderGuideSegmentValue }) {
  const openLink = useCallback(() => {
    if (segment.kind === "link") void Linking.openURL(segment.href);
  }, [segment]);
  let style;
  if (segment.kind === "term") style = styles.term;
  if (segment.kind === "link") style = styles.link;
  return (
    <Text style={style} onPress={segment.kind === "link" ? openLink : undefined}>
      {segment.value}
    </Text>
  );
}

function ProviderGuideCopyRow({
  copyKey,
  label,
  value,
  copied,
  copy,
}: {
  copyKey: string;
  label: string;
  value: string;
  copied: string | null;
  copy(key: string, value: string): void;
}) {
  const copyValue = useCallback(() => {
    copy(copyKey, value);
  }, [copy, copyKey, value]);
  return (
    <View style={styles.copyRow}>
      <View style={settingsStyles.rowContent}>
        <Text style={styles.copyLabel}>{label}</Text>
        <Text selectable style={styles.copyValue} numberOfLines={2}>
          {value}
        </Text>
      </View>
      <Button size="xs" variant="outline" onPress={copyValue}>
        {copied === copyKey ? "Copied" : "Copy"}
      </Button>
    </View>
  );
}

function ProviderGuideManifest({
  copyKey,
  manifest,
  copied,
  copy,
}: {
  copyKey: string;
  manifest: string;
  copied: string | null;
  copy(key: string, value: string): void;
}) {
  const copyManifest = useCallback(() => {
    copy(copyKey, manifest);
  }, [copy, copyKey, manifest]);
  return (
    <View style={styles.manifest}>
      <View style={styles.copyRow}>
        <Text style={styles.copyLabel}>Manifest</Text>
        <Button size="xs" variant="outline" onPress={copyManifest}>
          {copied === copyKey ? "Copied" : "Copy"}
        </Button>
      </View>
      <Text selectable style={styles.manifestText}>
        {manifest}
      </Text>
    </View>
  );
}

function replacementDraft(
  application: ProviderApplication,
  applicationId: string,
): ApplicationDraft {
  const common = {
    key: `${application.provider}:${applicationId}:${String(application.configurationVersion)}`,
    application: {
      identifiers: application.identifiers,
      configurationVersion: application.configurationVersion,
    },
  };
  if (application.provider === "slack") {
    return {
      ...common,
      provider: application.provider,
      transport: application.identifiers.transport === "webhook" ? "webhook" : "socket",
    };
  }
  return { ...common, provider: application.provider };
}

function setupGuideFor(
  guides: readonly ProviderApplicationSetupGuide[],
  provider: HubProviderApplicationProvider,
  transport: "socket" | "webhook" | undefined,
): ProviderApplicationSetupGuide | undefined {
  return guides.find(
    (guide) =>
      guide.provider === provider &&
      (provider !== "slack" || guide.transport === (transport ?? "socket")),
  );
}

function applicationViews(
  overview: z.infer<typeof HubProviderApplicationsSchema>,
): ProviderApplication[] {
  return HUB_PROVIDER_APPLICATION_PROVIDERS.flatMap((provider) => {
    const stored = overview.applications[provider];
    if (stored.length > 0) return stored;
    const resolved = overview.providers[provider];
    return resolved.status === "notConfigured" ? [] : [resolved];
  });
}

function providerLabel(provider: HubProviderApplicationProvider): string {
  if (provider === "github") return "GitHub";
  if (provider === "slack") return "Slack";
  if (provider === "discord") return "Discord";
  return "Linear";
}

function statusLabel(status: ProviderApplication["status"]): string {
  if (status === "notConfigured") return "Not configured";
  if (status === "actionNeeded") return "Action needed";
  if (status === "managedByEnvironment") return "Managed by environment";
  return status === "connected" ? "Connected" : "Verified";
}

function statusVariant(status: ProviderApplication["status"]): StatusBadgeVariant {
  if (status === "connected" || status === "verified") return "success";
  if (status === "actionNeeded") return "warning";
  return "muted";
}

const styles = StyleSheet.create((theme) => ({
  applicationRow: {
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  applicationContent: {
    flex: 1,
    gap: theme.spacing[1],
  },
  titleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  sectionActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  form: {
    gap: theme.spacing[4],
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  guide: {
    gap: theme.spacing[4],
  },
  guideHeader: {
    gap: theme.spacing[2],
  },
  guideGroup: {
    gap: theme.spacing[3],
  },
  guideStep: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  stepNumber: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    minWidth: 18,
  },
  stepContent: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[2],
  },
  stepText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.5,
  },
  term: {
    fontWeight: theme.fontWeight.medium,
  },
  link: {
    color: theme.colors.accent,
    textDecorationLine: "underline",
  },
  copyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  copyLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  copyValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  manifest: {
    gap: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
  },
  manifestText: {
    color: theme.colors.foregroundMuted,
    fontFamily: "monospace",
    fontSize: theme.fontSize.sm,
  },
  facts: {
    gap: theme.spacing[1],
  },
}));
