import { useHubStartStatus } from "./hub-start-status";
import { suggestedDeviceLabel } from "./device-label";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useHosts, useHostRuntimeConnectedServerIds } from "@/runtime/host-runtime";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { parseHubConfiguration } from "@/clisbot/hub/config";
import { useHubSwitchLocked, useHubEditLock } from "./hub-edit-lock";
import { HostPicker as SharedHostPicker } from "@/components/hosts/host-picker";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import type { HostProfile } from "@/types/host-connection";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ChevronDown, ChevronRight, Link } from "lucide-react-native";
import { settingsStyles } from "@/styles/settings";
import { parsePublicHubConnection } from "./google-sign-in";
import { HubText as Text } from "./hub-text";
import { Alert } from "@/components/ui/alert";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { HubContextNote, HubStatusBadge } from "./hub-ui";
import { WhatIsHub } from "./hub-help";
import { HubReadyNotice, HubOverviewSummary } from "./hub-access-summary";
import { HubOverviewDestinations } from "@/clisbot/hub/settings/hub-overview-destinations";
import { HubAddForm } from "./hub-add-form";
import { useHubDeviceCapabilities } from "./use-hub-device-capabilities";
import { requestHubDevices, type HubDeviceAction } from "./hub-device-operations";
import {
  HubDeviceOfferSchema,
  parseHubPairingOfferFromUrl,
  parseDevicePairingOfferFromUrl,
} from "@clisbot/protocol/device-pairing-offer";
import {
  useHubProfiles,
  selectHubProfile,
  saveDiscoveredHub,
  parseHubRelayUrl,
  type HubProfile,
} from "./hub-profiles";
import { pairHub } from "./hub-transport";
import { useHubHostDiscovery, type DetectedHub } from "./hub-host-discovery";
import { SavedHubList, DetectedHubList, HubStartHosts, matchesSavedHub } from "./hub-list";
import { buildSettingsAddHostRoute } from "@/utils/host-routes";
import { isTailscaleOrigin, saveVerifiedHubRoutes, startHubOnHost } from "./hub-routes";
import { HubRoutesCard } from "./hub-routes-card";
import { HubPairDevicePanel } from "./hub-pair-device";
import { fetchPublicHubIdentity } from "./hub-identity-check";
import { HubIdentityRecovery } from "./hub-identity-recovery";
import { readDeviceCredential } from "./credentials";
import { PairedDeviceList } from "./device-list";
import { HubDeviceCapabilityError } from "./hub-capabilities";

function usePublicHubTarget(
  router: ReturnType<typeof useRouter>,
  setBusy: (busy: boolean) => void,
  setError: (error: string | null) => void,
) {
  const { t } = useTranslation();
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const connectPublicTarget = () => {
      const encoded = new URLSearchParams(window.location.hash.slice(1)).get("hub");
      if (!encoded) return;
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
      if (encoded.length > 16_384) {
        setError(t("hub.connection.errors.linkTooLarge"));
        return;
      }
      setBusy(true);
      setError(null);
      void Promise.resolve()
        .then(() => parsePublicHubConnection(encoded))
        .then((target) => pairHub(target))
        .then(() => router.replace("/settings/hub/account"))
        .catch((caught) =>
          setError(
            caught instanceof Error ? caught.message : t("hub.connection.errors.notVerified"),
          ),
        )
        .finally(() => setBusy(false));
    };
    connectPublicTarget();
    window.addEventListener("hashchange", connectPublicTarget);
    return () => window.removeEventListener("hashchange", connectPublicTarget);
  }, [router, setBusy, setError, t]);
}

export function HubConnectionSettings() {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const params = useLocalSearchParams<{ hubIntent?: string }>();
  const registry = useHubProfiles();
  const allHosts = useHosts();
  const hostIds = useMemo(() => allHosts.map((host) => host.serverId), [allHosts]);
  const connectedIds = useHostRuntimeConnectedServerIds(hostIds);
  const hosts = useMemo(
    () => allHosts.filter((host) => connectedIds.includes(host.serverId)),
    [allHosts, connectedIds],
  );
  const localServerId = useLocalDaemonServerId();
  const router = useRouter();
  const locked = useHubSwitchLocked();
  const [intent, setIntent] = useState<"add" | "start" | "connect" | null>(
    initialHubIntent(params.hubIntent),
  );
  const [hostId, setHostId] = useState(hosts[0]?.serverId ?? "");
  const canStartHub = useHubStartSupport(hosts, hostId, localServerId);
  const [link, setLink] = useState("");
  const [label, setLabel] = useState(suggestedDeviceLabel);
  const [error, setError] = useState<string | null>(null);
  const [entryNotice, setEntryNotice] = useState<HubEntryNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const unavailableActions = locked || busy;
  usePublicHubTarget(router, setBusy, setError);
  const [discoveryAttempt, setDiscoveryAttempt] = useState(0);
  const retryDiscovery = useCallback(() => setDiscoveryAttempt((value) => value + 1), []);
  const { checks, detected, state: discovery } = useHubHostDiscovery(hosts, discoveryAttempt);
  const connectHost = useCallback(
    () => router.push(buildSettingsAddHostRoute(Date.now())),
    [router],
  );
  const available = detected.filter(
    (hub) => !registry.profiles.some((profile) => matchesSavedHub(hub, profile)),
  );
  const connectInput = useCallback(
    async (input: string, started?: { relay: boolean; reason?: string }) => {
      setBusy(true);
      setError(null);
      setEntryNotice(null);
      try {
        const offer =
          parseHubPairingOfferFromUrl(input)?.hub ?? parseDevicePairingOfferFromUrl(input)?.hub;
        if (offer) {
          await pairHub(offer, label);
          router.push({
            pathname: "/settings/hub/[hubSection]",
            params: {
              hubSection: "overview",
              ...(started ? { startedHub: offer.hubId } : {}),
              ...(started?.relay ? { transport: "relay" } : {}),
              // Tailscale's own words can be long; a route parameter carries only the start.
              ...(started?.relay && started.reason
                ? { relayReason: started.reason.slice(0, 300) }
                : {}),
            },
          });
          setIntent(null);
          setLink("");
          return;
        }
        const configuration = parseHubConfiguration({ origin: input.trim() });
        if (!configuration) throw new Error(t("hub.connection.errors.pasteUrl"));
        const result = IdentitySchema.safeParse(await fetchPublicHubIdentity(configuration.origin));
        if (!result.success) throw new Error(t("hub.connection.errors.invalidResponse"));
        const identity = result.data;
        const notice = hubEntryNotice(identity);
        if (notice) {
          setEntryNotice(notice);
          return;
        }
        await saveDiscoveredHub({
          hubId: identity.hubId,
          publicKey: identity.publicKey,
          origin: configuration.origin,
          label: configuration.origin ? new URL(configuration.origin).hostname.slice(0, 80) : "Hub",
          entry: identity.entry,
          setupStatus: identity.setupStatus,
          ...(identity.relay ? { relay: identity.relay } : {}),
        });
        router.push("/settings/hub/account");
        setIntent(null);
        setLink("");
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : t("hub.connection.errors.connectionFailed"),
        );
      } finally {
        setBusy(false);
      }
    },
    [label, router, t],
  );
  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const selected = hosts.find((host) => host.serverId === (hostId || hosts[0]?.serverId));
      if (!selected) throw new Error(t("hub.connection.errors.connectHostFirst"));
      if (!canStartHub) throw new Error(t("hub.connection.errors.hostCannotStart"));
      const value = await startHubOnHost({
        serverId: selected.serverId,
        localServerId,
        label,
      });
      if (!value?.url) throw new Error(t("hub.connection.errors.hostUnsupported"));
      await connectInput(value.url, {
        relay: value.transport === "relay",
        ...(value.networkGuidance ? { reason: value.networkGuidance } : {}),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("hub.connection.errors.couldNotStart"));
    } finally {
      setBusy(false);
    }
  }, [hosts, hostId, label, connectInput, localServerId, canStartHub, t]);
  const chooseStart = useCallback(() => {
    setIntent("start");
    router.setParams({ hubIntent: "start" });
  }, [router]);
  const chooseConnect = useCallback(() => {
    setIntent("connect");
    router.setParams({ hubIntent: "connect" });
  }, [router]);
  const scan = useCallback(() => router.push("/pair-scan"), [router]);
  const changeLink = useCallback((value: string) => {
    setLink(value);
    setError(null);
    setEntryNotice(null);
  }, []);
  const cancel = useCallback(() => {
    setIntent(null);
    setError(null);
    setEntryNotice(null);
    router.setParams({ hubIntent: undefined });
  }, [router]);
  const connectEntered = useCallback(() => {
    void connectInput(link);
  }, [connectInput, link]);
  const openSaved = useCallback(
    async (id: string, destination?: "account" | "connection") => {
      try {
        await selectHubProfile(id);
        if (destination === "connection")
          router.push({
            pathname: "/settings/hub/[hubSection]",
            params: { hubSection: "overview", hubPanel: "connection" },
          });
        else
          router.push(
            destination === "account" ? "/settings/hub/account" : "/settings/hub/overview",
          );
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : t("hub.connection.errors.couldNotSelect"),
        );
      }
    },
    [router, t],
  );
  const connectDetected = useCallback(
    async (hub: DetectedHub) => {
      setBusy(true);
      setError(null);
      try {
        if (!hub.connection) throw new Error(t("hub.connection.errors.askOperatorLink"));
        await pairHub(hub.connection, label);
        router.push("/settings/hub/account");
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : t("hub.connection.errors.couldNotConnect"),
        );
        setIntent("connect");
      } finally {
        setBusy(false);
      }
    },
    [router, label, t],
  );
  const startOnHost = useCallback(
    (serverId: string) => {
      setHostId(serverId);
      chooseStart();
    },
    [chooseStart],
  );
  const formHostPicker = useMemo(
    () => (
      <HubStartHostPicker
        hosts={hosts}
        value={hostId || hosts[0]?.serverId || ""}
        onSelect={setHostId}
        disabled={busy}
      />
    ),
    [hosts, hostId, busy],
  );
  const formNotice = useMemo(
    () => (entryNotice ? <HubUrlEntryNotice notice={entryNotice} scan={scan} /> : null),
    [entryNotice, scan],
  );
  return (
    <View style={PROFILE_STYLE}>
      {intent === null || intent === "add" ? (
        <>
          <View style={hubStyles.collection}>
            <View style={hubStyles.toolbar}>
              <Text style={hubStyles.sectionLabel}>{t("hub.connection.list.savedHubs")}</Text>
              <Button
                size={compact ? "md" : "sm"}
                variant="outline"
                leftIcon={Link}
                disabled={unavailableActions}
                onPress={chooseConnect}
              >
                {t("hub.connection.add.connectExisting")}
              </Button>
            </View>
            {registry.profiles.length ? (
              <SavedHubList
                profiles={registry.profiles}
                activeId={registry.activeId}
                detected={detected}
                localServerId={localServerId}
                disabled={unavailableActions}
                open={openSaved}
                startOn={startOnHost}
                retry={retryDiscovery}
              />
            ) : (
              <Text style={hubStyles.intro}>{t("hub.connection.inventory.empty")}</Text>
            )}
          </View>
          {available.length ? (
            <SettingsSection title={t("hub.connection.list.availableHubs")}>
              <DetectedHubList
                hubs={available}
                localServerId={localServerId}
                disabled={unavailableActions}
                connect={connectDetected}
                startOn={startOnHost}
                retry={retryDiscovery}
              />
            </SettingsSection>
          ) : null}
          <HubStartHosts
            hosts={allHosts}
            connectedIds={connectedIds}
            checks={checks}
            connectHost={connectHost}
            localServerId={localServerId}
            disabled={unavailableActions}
            startOn={startOnHost}
            retry={retryDiscovery}
          />
          <HubDiscoveryStatus
            visible
            state={discovery}
            busy={unavailableActions}
            retry={retryDiscovery}
            connect={chooseConnect}
          />
        </>
      ) : (
        <View>
          <HubAddForm
            intent={intent}
            noHubs={false}
            compact={compact}
            options={null}
            hostPicker={formHostPicker}
            hasHosts={hosts.length > 0}
            label={label}
            setLabel={setLabel}
            link={link}
            setLink={changeLink}
            busy={busy}
            canStartHub={canStartHub && !locked}
            start={start}
            connectEntered={connectEntered}
            scan={scan}
            cancel={cancel}
            error={error}
            entryNotice={formNotice}
          />
        </View>
      )}
      {error && intent !== "connect" && intent !== "start" ? (
        <Alert
          variant="error"
          title={t("hub.connection.list.finishFailedTitle")}
          description={error}
        />
      ) : null}
    </View>
  );
}

function HubDiscoveryStatus({
  visible,
  state,
  busy,
  retry,
  connect,
}: {
  visible: boolean;
  state: "loading" | "ready" | "error";
  busy: boolean;
  retry(): void;
  connect(): void;
}) {
  const { t } = useTranslation();
  if (!visible) return null;
  if (state === "loading")
    return (
      <SettingsSection title={t("hub.connection.list.checkingTitle")}>
        <Text style={hubStyles.hint}>{t("hub.connection.list.checkingBody")}</Text>
      </SettingsSection>
    );
  if (state === "error")
    return (
      <Alert
        variant="warning"
        title={t("hub.connection.list.discoveryFailedTitle")}
        description={t("hub.connection.list.discoveryFailedBody")}
      >
        <View style={hubStyles.actions}>
          <Button variant="outline" onPress={retry} disabled={busy}>
            {t("hub.connection.list.retryDiscovery")}
          </Button>
          <Button variant="outline" onPress={connect} disabled={busy}>
            {t("hub.connection.list.connectManually")}
          </Button>
        </View>
      </Alert>
    );
  return null;
}

function useHubStartSupport(hosts: HostProfile[], hostId: string, localServerId: string | null) {
  const selectedId = hosts.some((host) => host.serverId === hostId)
    ? hostId
    : (hosts[0]?.serverId ?? "");
  const availability = useHubStartStatus(selectedId, localServerId);
  return Boolean(selectedId) && availability.status === "ready";
}

type HubEntryNotice = "owner-required" | "blocked" | "pairing";
function hubEntryNotice(identity: z.infer<typeof IdentitySchema>): HubEntryNotice | null {
  if (identity.setupStatus === "blocked") return "blocked";
  if (identity.entry === "owner-setup") return "owner-required";
  if (identity.entry !== "account") return "pairing";
  return null;
}
function HubUrlEntryNotice({ notice, scan }: { notice: HubEntryNotice; scan(): void }) {
  const { t } = useTranslation();
  if (notice === "blocked")
    return (
      <Alert
        variant="warning"
        title={t("hub.connection.entry.blockedTitle")}
        description={t("hub.connection.entry.blockedBody")}
      />
    );
  if (notice === "owner-required")
    return (
      <Alert
        variant="warning"
        title={t("hub.connection.entry.ownerTitle")}
        description={t("hub.connection.entry.ownerBody")}
      >
        <Button variant="outline" onPress={scan}>
          {t("hub.connection.entry.scanSetup")}
        </Button>
      </Alert>
    );
  return (
    <Alert
      variant="info"
      title={t("hub.connection.entry.pairingTitle")}
      description={t("hub.connection.entry.pairingBody")}
    >
      <Button variant="outline" onPress={scan}>
        {t("hub.connection.entry.scanPairing")}
      </Button>
    </Alert>
  );
}

function initialHubIntent(value?: string): "add" | "start" | "connect" | null {
  if (value === "add" || value === "start" || value === "connect") return value;
  return null;
}

function HubStartHostPicker({
  hosts,
  value,
  onSelect,
  disabled,
}: {
  hosts: HostProfile[];
  value: string;
  onSelect(id: string): void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const anchor = useRef<View | null>(null);
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <SharedHostPicker
      hosts={hosts}
      value={value}
      onSelect={onSelect}
      open={open}
      onOpenChange={setOpen}
      anchorRef={anchor}
      searchable
      title={t("hub.connection.add.runOnHost")}
    >
      <ComboboxTrigger
        ref={anchor}
        onPress={show}
        disabled={disabled}
        accessibilityLabel={t("hub.connection.add.runOnHost")}
        style={hubStyles.startHostTrigger}
      >
        <Text>
          {hosts.find((host) => host.serverId === value)?.label ??
            t("hub.connection.add.chooseHost")}
        </Text>
      </ComboboxTrigger>
    </SharedHostPicker>
  );
}

export function HubOverviewSettings() {
  const params = useLocalSearchParams<{
    transport?: string;
    relayReason?: string;
    hubPanel?: string;
    startedHub?: string;
  }>();
  const { t } = useTranslation();
  const registry = useHubProfiles();
  const router = useRouter();
  const profile = registry.profiles.find((value) => value.hubId === registry.activeId);
  // hubPanel=connection opens the editor from elsewhere, e.g. Hosts › Add a Host.
  const [editing, setEditing] = useState(params.hubPanel === "connection");
  const closeEditor = useCallback(() => {
    setEditing(false);
    if (params.hubPanel === "connection") router.setParams({ hubPanel: undefined });
  }, [params.hubPanel, router]);
  const openEditor = useCallback(() => setEditing(true), []);
  useEffect(() => {
    if (params.hubPanel === "connection") setEditing(true);
  }, [params.hubPanel]);
  const openDevices = useCallback(() => router.setParams({ hubPanel: "devices" }), [router]);
  const closeDevices = useCallback(() => router.setParams({ hubPanel: undefined }), [router]);
  if (!profile) return <HubConnectionSettings />;
  return (
    <>
      {params.hubPanel === "devices" ? (
        <Button variant="ghost" onPress={closeDevices} style={hubStyles.startAligned}>
          {t("hub.connection.overview.backToOverview")}
        </Button>
      ) : null}
      {!editing ? (
        <HubDeviceSettings
          key={profile.hubId}
          profile={profile}
          devices={params.hubPanel === "devices"}
          started={params.startedHub === profile.hubId}
          openDevices={openDevices}
          reviewConnection={openEditor}
          onRelay={params.transport === "relay" && !isTailscaleOrigin(profile.origin)}
          relayReason={params.relayReason}
        />
      ) : null}
      {!editing && params.hubPanel !== "devices" ? <WhatIsHub /> : null}
      {editing ? (
        <SettingsSection title={t("hub.connection.overview.editConnection")}>
          <HubConnectionEditor profile={profile} close={closeEditor} />
        </SettingsSection>
      ) : null}
    </>
  );
}

function HubConnectionEditor({ profile, close }: { profile: HubProfile; close(): void }) {
  const { t } = useTranslation();
  useHubEditLock();
  const [label, setLabel] = useState(profile.label);
  const [origin, setOrigin] = useState(profile.origin ?? "");
  const [relay, setRelay] = useState(
    profile.relay
      ? `${profile.relay.useTls === false ? "ws" : "wss"}://${profile.relay.endpoint}`
      : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await saveVerifiedHubRoutes(profile, {
        label: label.trim(),
        origin: origin.trim() || undefined,
        relay: parseHubRelayUrl(relay) ?? undefined,
      });
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("hub.connection.errors.couldNotSave"));
    } finally {
      setBusy(false);
    }
  }, [profile, label, origin, relay, close, t]);
  const savePress = useCallback(() => {
    void save();
  }, [save]);
  return (
    <>
      <HubContextNote>{t("hub.connection.editor.switchNote")}</HubContextNote>
      <HubRoutesCard profile={profile} onUpdated={close} />
      <View style={[settingsStyles.card, hubStyles.form]}>
        <Field
          label={t("hub.connection.editor.nameLabel")}
          hint={t("hub.connection.editor.nameHint")}
        >
          <FormTextInput
            initialValue={label}
            onChangeText={setLabel}
            accessibilityLabel={t("hub.connection.editor.nameA11y")}
            editable={!busy}
          />
        </Field>
        <View style={hubStyles.verified}>
          <Text style={hubStyles.hint}>
            {t("hub.connection.editor.hubId", { id: profile.hubId })}
          </Text>
          <HubStatusBadge label={t("hub.connection.editor.verified")} tone="success" />
        </View>
        <CustomAddressFields
          initiallyOpen={Boolean(profile.origin) && !isTailscaleOrigin(profile.origin)}
          origin={origin}
          relay={relay}
          setOrigin={setOrigin}
          setRelay={setRelay}
          busy={busy}
        />
        <View style={hubStyles.actions}>
          <Button variant="outline" disabled={busy} onPress={close}>
            {t("hub.connection.common.cancel")}
          </Button>
          <Button
            variant="default"
            disabled={busy || !label.trim()}
            loading={busy}
            onPress={savePress}
          >
            {busy ? t("hub.connection.common.saving") : t("hub.connection.editor.save")}
          </Button>
        </View>
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      </View>
      <HubContextNote>{t("hub.connection.editor.proveNote")}</HubContextNote>
    </>
  );
}

/** A Hub address typed by hand, folded away because Tailscale and relay need none. */
function CustomAddressFields(props: {
  initiallyOpen: boolean;
  origin: string;
  relay: string;
  setOrigin(value: string): void;
  setRelay(value: string): void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(props.initiallyOpen);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={open ? ChevronDown : ChevronRight}
        onPress={toggle}
        style={hubStyles.startAligned}
      >
        {t("hub.connection.editor.customAddress")}
      </Button>
      {open ? (
        <>
          <Field label={t("hub.connection.editor.httpsLabel")}>
            <FormTextInput
              initialValue={props.origin}
              onChangeText={props.setOrigin}
              accessibilityLabel={t("hub.connection.editor.httpsA11y")}
              editable={!props.busy}
            />
          </Field>
          <Field
            label={t("hub.connection.editor.relayLabel")}
            hint={t("hub.connection.editor.relayHint")}
          >
            <FormTextInput
              initialValue={props.relay}
              onChangeText={props.setRelay}
              accessibilityLabel={t("hub.connection.editor.relayA11y")}
              editable={!props.busy}
            />
          </Field>
        </>
      ) : null}
    </>
  );
}

const IdentitySchema = z.object({
  hubId: z.string(),
  publicKey: z.string(),
  entry: z.enum(["account", "pairing", "owner-setup"]),
  setupStatus: z.enum(["ready", "owner-required", "blocked"]),
  relay: HubDeviceOfferSchema.shape.relay,
});
/** Started on relay: says so next to the start result, with Tailscale's own reason. */
function HubRelayNotice({ reason, setUpTailscale }: { reason?: string; setUpTailscale(): void }) {
  const { t } = useTranslation();
  const body = t("hub.connection.overview.relayBody");
  return (
    <Alert
      variant="info"
      title={t("hub.connection.overview.relayTitle")}
      description={reason ? `${body}\n\n${reason}` : body}
    >
      <Button variant="outline" size="sm" onPress={setUpTailscale}>
        {t("hub.connection.overview.setUpTailscale")}
      </Button>
    </Alert>
  );
}

function HubDeviceSettings({
  profile,
  devices,
  started,
  openDevices,
  reviewConnection,
  onRelay,
  relayReason,
}: {
  profile: HubProfile;
  devices: boolean;
  started: boolean;
  openDevices(): void;
  reviewConnection(): void;
  onRelay: boolean;
  relayReason?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { transport, capabilities, error, retry } = useHubDeviceCapabilities(profile);
  const accessError = hubAccessErrorReason(error, profile);
  const pairAgain = useCallback(
    () =>
      router.push({
        pathname: "/settings/hub/[hubSection]",
        params: { hubSection: "hubs", hubIntent: "connect" },
      }),
    [router],
  );
  const [currentDeviceId, setCurrentDeviceId] = useState<string>();
  useEffect(() => {
    let alive = true;
    void readDeviceCredential(profile.hubId).then((credential) => {
      if (alive) setCurrentDeviceId(credential?.credentialId);
      return undefined;
    });
    return () => {
      alive = false;
    };
  }, [profile.hubId]);
  const signIn = useCallback(() => router.push("/settings/hub/account"), [router]);
  const openPolicy = useCallback(() => router.push("/settings/hub/sign-in"), [router]);
  const [pairing, setPairing] = useState(false);
  const openPairing = useCallback(() => setPairing(true), []);
  const closePairing = useCallback(() => setPairing(false), []);
  const request = useCallback(
    (action: HubDeviceAction) => {
      if (!transport) throw new Error(t("hub.connection.errors.notConnected"));
      return requestHubDevices(transport, action);
    },
    [transport, t],
  );
  if (accessError)
    return (
      <HubAccessRecovery
        reason={accessError}
        retry={retry}
        pairAgain={pairAgain}
        signIn={signIn}
        profile={profile}
        reviewConnection={reviewConnection}
      />
    );
  if (devices && capabilities?.canManageDevices)
    return (
      <PairedDeviceList
        request={request}
        lockHubSwitch
        currentDeviceId={currentDeviceId}
        onPairDevice={openPairing}
      >
        {pairing ? <HubPairDevicePanel profile={profile} onClose={closePairing} /> : null}
      </PairedDeviceList>
    );
  if (!capabilities)
    return <HubContextNote>{t("hub.connection.overview.checking")}</HubContextNote>;
  return (
    <>
      <HubReadyNotice capabilities={capabilities} started={started} />
      {onRelay ? <HubRelayNotice reason={relayReason} setUpTailscale={reviewConnection} /> : null}
      <HubOverviewSummary
        profile={profile}
        capabilities={capabilities}
        openDevices={openDevices}
        reviewConnection={reviewConnection}
        signIn={signIn}
        openPolicy={openPolicy}
      />
      <HubOverviewDestinations />
    </>
  );
}

function hubAccessErrorReason(
  error: Error | null,
  profile: HubProfile,
): "pairing" | "signin" | "network" | null {
  if (!error) return null;
  const denied = error instanceof HubDeviceCapabilityError && [401, 403].includes(error.status);
  if (!denied) return "network";
  return profile.entry === "account" ? "signin" : "pairing";
}

function HubAccessRecovery({
  reason,
  retry,
  pairAgain,
  signIn,
  profile,
  reviewConnection,
}: {
  reason: "pairing" | "signin" | "network";
  retry(): void;
  pairAgain(): void;
  signIn(): void;
  profile: HubProfile;
  reviewConnection(): void;
}) {
  const { t } = useTranslation();
  const networkFallback = useMemo(
    () => (
      <Alert
        variant="warning"
        title={t("hub.connection.common.hubUnavailable")}
        description={t("hub.connection.recovery.unavailableBody")}
      >
        <Button variant="outline" onPress={retry}>
          {t("hub.connection.common.retryConnection")}
        </Button>
      </Alert>
    ),
    [retry, t],
  );
  if (reason === "pairing")
    return (
      <Alert
        variant="warning"
        title={t("hub.connection.common.pairAgainTitle")}
        description={t("hub.connection.recovery.pairAgainBody")}
      >
        <Button variant="outline" onPress={pairAgain}>
          {t("hub.connection.common.pairAgain")}
        </Button>
      </Alert>
    );
  if (reason === "signin")
    return (
      <Alert
        variant="info"
        title={t("hub.connection.common.signInToHub")}
        description={t("hub.connection.recovery.signInBody")}
      >
        <Button variant="outline" size="sm" onPress={signIn}>
          {t("hub.connection.common.signInToHub")}
        </Button>
      </Alert>
    );
  return (
    <HubIdentityRecovery profile={profile} onReview={reviewConnection} fallback={networkFallback} />
  );
}

export { HubLoginPolicySettings } from "./hub-login-policy-settings";

const PROFILE_STYLE = { gap: 24 } as const;

const hubStyles = StyleSheet.create((theme) => ({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: theme.spacing[1],
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  sectionLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  collection: { gap: theme.spacing[3] },
  rowCard: { padding: theme.spacing[4] },
  rowHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rowTitle: {
    flex: 1,
    fontWeight: theme.fontWeight.medium,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
  },
  selected: { flexDirection: "row", alignItems: "center", gap: 4 },
  selectedText: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.sm,
  },
  metadata: { gap: 6, marginTop: theme.spacing[3] },
  rowFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    marginTop: theme.spacing[4],
  },
  openAction: { marginLeft: "auto" },
  startAligned: { alignSelf: "flex-start" },
  startHostTrigger: {
    height: 44,
    paddingHorizontal: theme.spacing[2],
  },
  intro: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    marginHorizontal: theme.spacing[1],
    marginBottom: theme.spacing[2],
  },
  hint: {
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    color: theme.colors.foregroundMuted,
  },
  optionCard: { padding: theme.spacing[4] },
  form: { padding: theme.spacing[4], gap: theme.spacing[4] },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  verified: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
}));
