import { suggestedDeviceLabel } from "./device-label";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  useHosts,
  getHostRuntimeStore,
  useHostRuntimeConnectedServerIds,
  useHostRuntimeSnapshot,
} from "@/runtime/host-runtime";
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
import { ChevronDown, ChevronRight, Plus, Server, Link } from "lucide-react-native";
import { settingsStyles } from "@/styles/settings";
import { parsePublicHubConnection } from "./google-sign-in";
import { HubText as Text } from "./hub-text";
import { Alert } from "@/components/ui/alert";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import {
  HubNetworkIcon,
  hubMutedIconProps,
  HubContextNote,
  HubMetadataRow,
  HubStatusBadge,
} from "./hub-ui";
import { WhatIsHub } from "./hub-help";
import { HubReadyNotice, HubOverviewSummary } from "./hub-access-summary";
import { HubOverviewDestinations } from "@/clisbot/hub/settings/hub-overview-destinations";
import { HubAddForm } from "./hub-add-form";
import { useHubDeviceCapabilities } from "./use-hub-device-capabilities";
import { requestHubDevices, type HubDeviceAction } from "./hub-device-operations";
import {
  HubDeviceOfferSchema,
  HubConnectionSchema,
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
import {
  canStartHubOnHost,
  isTailscaleOrigin,
  saveVerifiedHubRoutes,
  startHubOnHost,
} from "./hub-routes";
import { HubRoutesCard } from "./hub-routes-card";
import { HubPairDevicePanel } from "./hub-pair-device";
import { fetchPublicHubIdentity } from "./hub-identity-check";
import { HubIdentityRecovery } from "./hub-identity-recovery";
import { readDeviceCredential } from "./credentials";
import { PairedDeviceList } from "./device-list";
import { useHubAccount } from "@/clisbot/hub/account-provider";
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
  const account = useHubAccount();
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
  usePublicHubTarget(router, setBusy, setError);
  const [detected, setDetected] = useState<DetectedHub[]>([]);
  const [discovery, setDiscovery] = useState<"loading" | "ready" | "error">("loading");
  const [discoveryAttempt, setDiscoveryAttempt] = useState(0);
  const retryDiscovery = useCallback(() => setDiscoveryAttempt((value) => value + 1), []);
  const noHubs = isEmptyHubList(registry.profiles.length, detected.length, discovery);
  useEffect(() => {
    let alive = true;
    setDiscovery("loading");
    void Promise.allSettled(hosts.map(discoverHub)).then((results) => {
      if (!alive) return undefined;
      const known = results.flatMap((result) =>
        result.status === "fulfilled" && result.value ? [result.value] : [],
      );
      const failed = results.some((result) => result.status === "rejected");
      setDetected((previous) => uniqueDetectedHubs(failed ? [...previous, ...known] : known));
      setDiscovery(failed ? "error" : "ready");
      return undefined;
    });
    return () => {
      alive = false;
    };
  }, [hosts, discoveryAttempt]);
  const connectInput = useCallback(
    async (input: string, started?: { relay: boolean }) => {
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
      await connectInput(value.url, { relay: value.transport === "relay" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("hub.connection.errors.couldNotStart"));
    } finally {
      setBusy(false);
    }
  }, [hosts, hostId, label, connectInput, localServerId, canStartHub, t]);
  const addHub = useCallback(() => {
    setIntent("add");
    router.setParams({ hubIntent: "add" });
  }, [router]);
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
    async (id: string) => {
      try {
        await selectHubProfile(id);
        router.push("/settings/hub/overview");
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
  const formOptions = useMemo(
    () => (
      <HubAddOptions compact={compact} chooseStart={chooseStart} chooseConnect={chooseConnect} />
    ),
    [compact, chooseStart, chooseConnect],
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
      {intent === null && registry.profiles.length ? (
        <>
          <View style={hubStyles.toolbar}>
            <Text style={hubStyles.sectionLabel}>{t("hub.connection.list.savedHubs")}</Text>
            <Button
              size={compact ? "md" : "sm"}
              variant="outline"
              leftIcon={Plus}
              disabled={locked}
              onPress={addHub}
            >
              {t("hub.connection.list.addHub")}
            </Button>
          </View>
          <View style={hubStyles.collection}>
            {registry.profiles.map((profile) => (
              <SavedHubRow
                key={profile.hubId}
                profile={profile}
                selected={registry.activeId === profile.hubId}
                status={hubListingStatus(t, profile.hubId === registry.activeId, account)}
                hostLabel={
                  detected.find(
                    (hub) =>
                      hub.connection?.hubId === profile.hubId || hub.origin === profile.origin,
                  )?.hostLabel
                }
                account={profile.hubId === registry.activeId ? account : null}
                disabled={locked || busy}
                open={openSaved}
              />
            ))}
          </View>
        </>
      ) : null}
      {intent === null &&
      detected.filter(
        (hub) =>
          !registry.profiles.some(
            (profile) => profile.hubId === hub.connection?.hubId || profile.origin === hub.origin,
          ),
      ).length ? (
        <SettingsSection title={t("hub.connection.list.availableHubs")}>
          {detected
            .filter(
              (hub) =>
                !registry.profiles.some(
                  (profile) =>
                    profile.hubId === hub.connection?.hubId || profile.origin === hub.origin,
                ),
            )
            .map((hub) => (
              <DetectedHubRow
                key={hub.origin}
                hub={hub}
                disabled={busy || locked}
                connect={connectDetected}
              />
            ))}
        </SettingsSection>
      ) : null}
      <HubDiscoveryStatus
        visible={intent === null}
        state={discovery}
        busy={busy}
        retry={retryDiscovery}
        connect={chooseConnect}
      />
      {intent === null && !noHubs ? (
        <HubListingContext
          saved={registry.profiles.length}
          detected={detected.length}
          locked={locked}
          addHub={addHub}
        />
      ) : (
        <>
          {noHubs && intent === null ? (
            <Text style={hubStyles.intro}>{t("hub.connection.list.noHubs")}</Text>
          ) : null}
          <SettingsSection title={t("hub.connection.list.addAHub")}>
            <HubAddForm
              intent={intent}
              noHubs={noHubs}
              compact={compact}
              options={formOptions}
              hostPicker={formHostPicker}
              hasHosts={hosts.length > 0}
              label={label}
              setLabel={setLabel}
              link={link}
              setLink={changeLink}
              busy={busy}
              canStartHub={canStartHub}
              start={start}
              connectEntered={connectEntered}
              scan={scan}
              cancel={cancel}
              error={error}
              entryNotice={formNotice}
            />
          </SettingsSection>
        </>
      )}
      {error && intent !== "connect" && intent !== "start" ? (
        <Alert
          variant="error"
          title={t("hub.connection.list.finishFailedTitle")}
          description={error}
        />
      ) : null}
      {!registry.profiles.length && intent === null && discovery === "ready" ? (
        <HubContextNote>{t("hub.connection.list.onlyHostNote")}</HubContextNote>
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
  // Subscribing re-evaluates when that Host reconnects with new features.
  useHostRuntimeSnapshot(selectedId);
  return Boolean(selectedId) && canStartHubOnHost(selectedId, localServerId);
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

function HubListingContext({
  saved,
  detected,
  locked,
  addHub,
}: {
  saved: number;
  detected: number;
  locked: boolean;
  addHub(): void;
}) {
  const { t } = useTranslation();
  if (saved + detected === 0) return null;
  return (
    <>
      <HubContextNote>{t("hub.connection.list.switchNote")}</HubContextNote>
      {saved === 0 && detected > 0 ? (
        <Button
          variant="ghost"
          leftIcon={Plus}
          disabled={locked}
          onPress={addHub}
          style={hubStyles.startAligned}
        >
          {t("hub.connection.list.addAnother")}
        </Button>
      ) : null}
    </>
  );
}

function initialHubIntent(value?: string): "add" | "start" | "connect" | null {
  if (value === "add" || value === "start" || value === "connect") return value;
  return null;
}
function isEmptyHubList(saved: number, detected: number, discovery: string): boolean {
  return saved === 0 && detected === 0 && discovery === "ready";
}

function uniqueDetectedHubs(hubs: DetectedHub[]): DetectedHub[] {
  return [...new Map(hubs.map((hub) => [hub.connection?.hubId ?? hub.origin, hub])).values()];
}

async function discoverHub(host: HostProfile): Promise<DetectedHub | null> {
  const client = getHostRuntimeStore().getSnapshot(host.serverId)?.client;
  if (!client) throw new Error("Host disconnected");
  const { status } = await client.getHubStatus();
  const connection =
    client.getLastServerInfoMessage()?.features?.hubDiscovery === true
      ? status.hubConnection
      : undefined;
  if (!status.hubOrigin) return null;
  return {
    origin: status.hubOrigin,
    hostLabel: host.label,
    ...(connection ? { connection: HubConnectionSchema.parse(connection) } : {}),
  };
}

function HubAddOptions({
  compact,
  chooseStart,
  chooseConnect,
}: {
  compact: boolean;
  chooseStart(): void;
  chooseConnect(): void;
}) {
  const { t } = useTranslation();
  return (
    <View style={compact ? MOBILE_OPTION_STYLE : OPTION_STYLE}>
      <View
        style={[
          settingsStyles.card,
          compact ? MOBILE_OPTION_CARD : OPTION_CARD,
          hubStyles.optionCard,
        ]}
      >
        <Text style={hubStyles.rowTitle}>{t("hub.connection.add.runOwnTitle")}</Text>
        <Text style={hubStyles.hint}>{t("hub.connection.add.runOwnBody")}</Text>
        <Button variant="outline" leftIcon={Server} onPress={chooseStart}>
          {t("hub.connection.add.startHub")}
        </Button>
      </View>
      <View style={compact ? MOBILE_OR_STYLE : OR_STYLE}>
        <View style={compact ? MOBILE_OR_LINE : OR_LINE} />
        <Text>{t("hub.connection.add.or")}</Text>
        <View style={compact ? MOBILE_OR_LINE : OR_LINE} />
      </View>
      <View
        style={[
          settingsStyles.card,
          compact ? MOBILE_OPTION_CARD : OPTION_CARD,
          hubStyles.optionCard,
        ]}
      >
        <Text style={hubStyles.rowTitle}>{t("hub.connection.add.useExistingTitle")}</Text>
        <Text style={hubStyles.hint}>{t("hub.connection.add.useExistingBody")}</Text>
        <Button variant="outline" leftIcon={Link} onPress={chooseConnect}>
          {t("hub.connection.add.connectExisting")}
        </Button>
      </View>
    </View>
  );
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
        />
      ) : null}
      {!editing && params.hubPanel !== "devices" ? <WhatIsHub /> : null}
      {params.transport === "relay" && !editing && !isTailscaleOrigin(profile.origin) ? (
        <Alert
          variant="info"
          title={t("hub.connection.overview.relayTitle")}
          description={t("hub.connection.overview.relayBody")}
        >
          <Button variant="outline" size="sm" onPress={openEditor}>
            {t("hub.connection.overview.setUpTailscale")}
          </Button>
        </Alert>
      ) : null}
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
const OPTION_STYLE = {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 16,
} as const;
const OPTION_CARD = { flex: 1, minWidth: 220, gap: 12 } as const;
const OR_STYLE = { alignItems: "center", gap: 8 } as const;
const OR_LINE = {
  width: 1,
  flex: 1,
  minHeight: 24,
  backgroundColor: "#d6d6d6",
} as const;
const MOBILE_OPTION_STYLE = { gap: 16 } as const;
const MOBILE_OPTION_CARD = { gap: 12 } as const;
const MOBILE_OR_STYLE = {
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
} as const;
const MOBILE_OR_LINE = {
  height: 1,
  flex: 1,
  backgroundColor: "#d6d6d6",
} as const;

function HubDeviceSettings({
  profile,
  devices,
  started,
  openDevices,
  reviewConnection,
}: {
  profile: HubProfile;
  devices: boolean;
  started: boolean;
  openDevices(): void;
  reviewConnection(): void;
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

const PROFILE_STYLE = { gap: 16 } as const;

interface DetectedHub {
  origin: string;
  hostLabel: string;
  connection?: z.infer<typeof HubConnectionSchema>;
}
function SavedHubRow({
  profile,
  selected,
  status,
  hostLabel,
  account,
  disabled,
  open,
}: {
  profile: HubProfile;
  selected: boolean;
  status: string;
  hostLabel?: string;
  account: ReturnType<typeof useHubAccount> | null;
  disabled: boolean;
  open(id: string): Promise<void>;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const select = useCallback(() => {
    void open(profile.hubId);
  }, [open, profile.hubId]);
  let access = t("hub.connection.row.openToCheck");
  let badge = t("hub.connection.status.saved");
  let tone: "success" | "warning" | "muted" = "muted";
  if (account?.signedIn) {
    badge = t("hub.connection.status.connected");
    tone = "success";
    access =
      account.connection?.accountAuthentication === "personal"
        ? t("hub.connection.common.noAccountSignIn")
        : t("hub.connection.row.signedInAs", { email: account.signedIn.account.email });
  } else if (selected) {
    badge = status;
    tone = account?.error ? "warning" : "muted";
    if (profile.entry === "account") access = t("hub.connection.row.accountSignInRequired");
    else if (profile.entry === "owner-setup") access = t("hub.connection.row.ownerSetupRequired");
    else access = t("hub.connection.row.pairingRequired");
  }
  let host = hostLabel;
  if (!host && profile.origin) host = new URL(profile.origin).hostname;
  if (!host) host = t("hub.connection.row.viaRelay");
  return (
    <View style={[settingsStyles.card, hubStyles.rowCard]}>
      <View style={hubStyles.rowHeading}>
        <HubNetworkIcon size={18} uniProps={hubMutedIconProps} />
        <Text style={hubStyles.rowTitle}>{profile.label}</Text>
        {selected ? (
          <View style={hubStyles.selected}>
            <Text style={hubStyles.selectedText}>{t("hub.connection.row.selected")}</Text>
          </View>
        ) : null}
      </View>
      <View style={hubStyles.metadata}>
        <HubMetadataRow label={t("hub.connection.common.host")}>{host}</HubMetadataRow>
        <HubMetadataRow label={t("hub.connection.common.access")}>{access}</HubMetadataRow>
      </View>
      <View style={hubStyles.rowFooter}>
        <HubStatusBadge label={badge} tone={tone} />
        <Button
          size={compact ? "md" : "sm"}
          variant="outline"
          disabled={disabled}
          onPress={select}
          style={hubStyles.openAction}
        >
          {t("hub.connection.row.openHub")}
        </Button>
      </View>
    </View>
  );
}
function DetectedHubRow({
  hub,
  disabled,
  connect,
}: {
  hub: DetectedHub;
  disabled: boolean;
  connect(hub: DetectedHub): Promise<void>;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const open = useCallback(() => {
    void connect(hub);
  }, [connect, hub]);
  return (
    <View style={[settingsStyles.card, hubStyles.rowCard]}>
      <View style={hubStyles.rowHeading}>
        <HubNetworkIcon size={18} uniProps={hubMutedIconProps} />
        <Text style={hubStyles.rowTitle}>
          {t("hub.connection.row.hubOnHost", { host: hub.hostLabel })}
        </Text>
      </View>
      <View style={hubStyles.metadata}>
        <HubMetadataRow label={t("hub.connection.common.host")}>{hub.hostLabel}</HubMetadataRow>
        <HubMetadataRow label={t("hub.connection.common.access")}>
          {t("hub.connection.row.checkedOnConnect")}
        </HubMetadataRow>
      </View>
      <View style={hubStyles.rowFooter}>
        <HubStatusBadge label={t("hub.connection.row.detected")} />
        <Button
          size={compact ? "md" : "sm"}
          variant="outline"
          leftIcon={Link}
          disabled={disabled}
          onPress={open}
          style={hubStyles.openAction}
        >
          {t("hub.connection.common.connect")}
        </Button>
      </View>
    </View>
  );
}
function hubListingStatus(
  t: TFunction,
  selected: boolean,
  account: ReturnType<typeof useHubAccount>,
): string {
  if (!selected) return t("hub.connection.status.saved");
  if (account.signedIn) return t("hub.connection.status.connected");
  if (account.loading) return t("hub.connection.status.connecting");
  if (account.error) return t("hub.connection.status.unavailable");
  return t("hub.connection.status.signInRequired");
}
const hubStyles = StyleSheet.create((theme) => ({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: theme.spacing[1],
    marginBottom: theme.spacing[3],
  },
  sectionLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
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
