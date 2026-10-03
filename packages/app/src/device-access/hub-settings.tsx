import { suggestedDeviceLabel } from "./device-label";
import { z } from "zod";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getDesktopHost } from "@/desktop/host";
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
import { Plus, Server, Link } from "lucide-react-native";
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
  updateHubProfile,
  validateHubRoutes,
  parseHubRelayUrl,
  type HubProfile,
} from "./hub-profiles";
import { PairedHubTransport, pairHub } from "./hub-transport";
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
        setError("Hub connection link is too large");
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
            caught instanceof Error ? caught.message : "Hub connection could not be verified",
          ),
        )
        .finally(() => setBusy(false));
    };
    connectPublicTarget();
    window.addEventListener("hashchange", connectPublicTarget);
    return () => window.removeEventListener("hashchange", connectPublicTarget);
  }, [router, setBusy, setError]);
}

export function HubConnectionSettings() {
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
        if (!configuration) throw new Error("Paste a Hub HTTPS URL or its pairing link");
        const result = IdentitySchema.safeParse(await fetchPublicHubIdentity(configuration.origin));
        if (!result.success)
          throw new Error(
            "This address did not return a valid Hub response. Check the URL and try again.",
          );
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
        setError(caught instanceof Error ? caught.message : "Hub connection failed");
      } finally {
        setBusy(false);
      }
    },
    [label, router],
  );
  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const selected = hosts.find((host) => host.serverId === (hostId || hosts[0]?.serverId));
      if (!selected) throw new Error("Connect a Host before starting a Hub");
      if (!canStartHub) throw new Error("This Host cannot start a Hub from this connection");
      const desktop = getDesktopHost();
      const client = getHostRuntimeStore().getSnapshot(selected.serverId)?.client;
      const result =
        desktop?.invoke && selected.serverId === localServerId
          ? await desktop.invoke("desktop_start_hub", {
              serverId: selected.serverId,
              label,
            })
          : await client?.startLocalHub({ label });
      const value = result as { url?: string; transport?: string };
      if (!value?.url)
        throw new Error(
          "This Host does not support starting a Hub yet. Update its CLI and restart it when convenient.",
        );
      await connectInput(value.url, { relay: value.transport === "relay" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Hub could not start");
    } finally {
      setBusy(false);
    }
  }, [hosts, hostId, label, connectInput, localServerId, canStartHub]);
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
        setError(caught instanceof Error ? caught.message : "Hub could not be selected");
      }
    },
    [router],
  );
  const connectDetected = useCallback(
    async (hub: DetectedHub) => {
      setBusy(true);
      setError(null);
      try {
        if (!hub.connection)
          throw new Error(
            "Ask this Host’s operator for the Hub connection link. Its internal address is not a client access route.",
          );
        await pairHub(hub.connection, label);
        router.push("/settings/hub/account");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Hub could not connect");
        setIntent("connect");
      } finally {
        setBusy(false);
      }
    },
    [router, label],
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
            <Text style={hubStyles.sectionLabel}>Saved Hubs</Text>
            <Button
              size={compact ? "md" : "sm"}
              variant="outline"
              leftIcon={Plus}
              disabled={locked}
              onPress={addHub}
            >
              Add Hub
            </Button>
          </View>
          <View style={hubStyles.collection}>
            {registry.profiles.map((profile) => (
              <SavedHubRow
                key={profile.hubId}
                profile={profile}
                selected={registry.activeId === profile.hubId}
                status={hubListingStatus(profile.hubId === registry.activeId, account)}
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
        <SettingsSection title="Available Hubs">
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
            <Text style={hubStyles.intro}>
              No Hubs are connected. Add one when you need these features.
            </Text>
          ) : null}
          <SettingsSection title="Add a Hub">
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
        <Alert variant="error" title="Hub connection could not finish" description={error} />
      ) : null}
      {!registry.profiles.length && intent === null && discovery === "ready" ? (
        <HubContextNote>Just controlling agents? You only need a Host.</HubContextNote>
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
  if (!visible) return null;
  if (state === "loading")
    return (
      <SettingsSection title="Checking your Hosts">
        <Text style={hubStyles.hint}>Looking for Hubs linked to your connected Hosts…</Text>
      </SettingsSection>
    );
  if (state === "error")
    return (
      <Alert
        variant="warning"
        title="Some Hosts could not be checked"
        description="Saved Hubs are still available. Retry discovery, or add a Hub using its URL or approved connection link."
      >
        <View style={hubStyles.actions}>
          <Button variant="outline" onPress={retry} disabled={busy}>
            Retry discovery
          </Button>
          <Button variant="outline" onPress={connect} disabled={busy}>
            Connect a Hub manually
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
  const runtime = useHostRuntimeSnapshot(selectedId);
  return Boolean(
    selectedId &&
    ((getDesktopHost()?.invoke && selectedId === localServerId) ||
      runtime?.client?.getLastServerInfoMessage()?.features?.localHubStart === true),
  );
}

type HubEntryNotice = "owner-required" | "blocked" | "pairing";
function hubEntryNotice(identity: z.infer<typeof IdentitySchema>): HubEntryNotice | null {
  if (identity.setupStatus === "blocked") return "blocked";
  if (identity.entry === "owner-setup") return "owner-required";
  if (identity.entry !== "account") return "pairing";
  return null;
}
function HubUrlEntryNotice({ notice, scan }: { notice: HubEntryNotice; scan(): void }) {
  if (notice === "blocked")
    return (
      <Alert
        variant="warning"
        title="Hub setup needs operator recovery"
        description="This Hub cannot safely offer first-owner creation. Ask the person operating it to repair setup from its local computer. A URL or ordinary pairing cannot reopen owner setup."
      />
    );
  if (notice === "owner-required")
    return (
      <Alert
        variant="warning"
        title="Owner setup is not complete"
        description="Ask the Hub operator for an approved owner setup QR or link. Pairing connects this device and approves creation of the first owner account; a Hub URL alone cannot do that."
      >
        <Button variant="outline" onPress={scan}>
          Scan approved setup QR
        </Button>
      </Alert>
    );
  return (
    <Alert
      variant="info"
      title="Pairing is required for this Hub"
      description="This Hub does not require account sign-in. Use a pairing QR or connection link from its operator to connect securely."
    >
      <Button variant="outline" onPress={scan}>
        Scan pairing QR
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
  if (saved + detected === 0) return null;
  return (
    <>
      <HubContextNote>
        Open a Hub to manage its settings. Switching leaves other connections and Host sessions
        unchanged.
      </HubContextNote>
      {saved === 0 && detected > 0 ? (
        <Button
          variant="ghost"
          leftIcon={Plus}
          disabled={locked}
          onPress={addHub}
          style={hubStyles.startAligned}
        >
          Add another Hub
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
  return (
    <View style={compact ? MOBILE_OPTION_STYLE : OPTION_STYLE}>
      <View
        style={[
          settingsStyles.card,
          compact ? MOBILE_OPTION_CARD : OPTION_CARD,
          hubStyles.optionCard,
        ]}
      >
        <Text style={hubStyles.rowTitle}>Run your own Hub</Text>
        <Text style={hubStyles.hint}>
          For your channels and automations. It runs on a connected Host you choose; no account is
          required by default.
        </Text>
        <Button variant="outline" leftIcon={Server} onPress={chooseStart}>
          Start a Hub
        </Button>
      </View>
      <View style={compact ? MOBILE_OR_STYLE : OR_STYLE}>
        <View style={compact ? MOBILE_OR_LINE : OR_LINE} />
        <Text>OR</Text>
        <View style={compact ? MOBILE_OR_LINE : OR_LINE} />
      </View>
      <View
        style={[
          settingsStyles.card,
          compact ? MOBILE_OPTION_CARD : OPTION_CARD,
          hubStyles.optionCard,
        ]}
      >
        <Text style={hubStyles.rowTitle}>Use an existing Hub</Text>
        <Text style={hubStyles.hint}>
          For a Hub you already run or one provided by your team. Have its URL or connection link
          ready.
        </Text>
        <Button variant="outline" leftIcon={Link} onPress={chooseConnect}>
          Connect existing Hub
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
      title="Run Hub on Host"
    >
      <ComboboxTrigger
        ref={anchor}
        onPress={show}
        disabled={disabled}
        accessibilityLabel="Run Hub on Host"
        style={hubStyles.startHostTrigger}
      >
        <Text>
          {hosts.find((host) => host.serverId === value)?.label ?? "Choose a connected Host"}
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
  const registry = useHubProfiles();
  const router = useRouter();
  const profile = registry.profiles.find((value) => value.hubId === registry.activeId);
  const [editing, setEditing] = useState(false);
  const closeEditor = useCallback(() => setEditing(false), []);
  const openEditor = useCallback(() => setEditing(true), []);
  const openDevices = useCallback(() => router.setParams({ hubPanel: "devices" }), [router]);
  const closeDevices = useCallback(() => router.setParams({ hubPanel: undefined }), [router]);
  if (!profile) return <HubConnectionSettings />;
  return (
    <>
      {params.hubPanel === "devices" ? (
        <Button variant="ghost" onPress={closeDevices} style={hubStyles.startAligned}>
          Back to Overview
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
      {params.transport === "relay" ? (
        <HubContextNote>
          Hub is available through encrypted relay. For a direct connection and best speed, install
          and sign in to Tailscale on this Host and your phone.
        </HubContextNote>
      ) : null}
      {editing ? (
        <SettingsSection title="Edit connection">
          <HubConnectionEditor profile={profile} close={closeEditor} />
        </SettingsSection>
      ) : null}
    </>
  );
}

function HubConnectionEditor({ profile, close }: { profile: HubProfile; close(): void }) {
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
    let transport: PairedHubTransport | undefined;
    try {
      const routes = {
        origin: origin.trim() || undefined,
        relay: parseHubRelayUrl(relay) ?? undefined,
      };
      const candidate = { ...profile, ...routes };
      validateHubRoutes(candidate);
      transport = new PairedHubTransport(candidate);
      // The encrypted handshake pins the saved key before a credential is sent.
      const response = await transport.identity();
      if (!response.ok || (await response.json()).hubId !== profile.hubId)
        throw new Error("The new endpoint does not match this Hub");
      await updateHubProfile(profile.hubId, {
        label: label.trim(),
        origin: routes.origin ?? null,
        relay: routes.relay ?? null,
      });
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Hub connection could not be saved");
    } finally {
      transport?.close();
      setBusy(false);
    }
  }, [profile, label, origin, relay, close]);
  const savePress = useCallback(() => {
    void save();
  }, [save]);
  return (
    <>
      <HubContextNote>
        Save or cancel to switch Hubs. These changes apply only on this device.
      </HubContextNote>
      <View style={[settingsStyles.card, hubStyles.form]}>
        <Field
          label="Name on this device"
          hint="This changes the saved name here, not the Hub's identity."
        >
          <FormTextInput
            initialValue={label}
            onChangeText={setLabel}
            accessibilityLabel="Hub name"
            editable={!busy}
          />
        </Field>
        <View style={hubStyles.verified}>
          <Text style={hubStyles.hint}>Hub ID: {profile.hubId}</Text>
          <HubStatusBadge label="Verified" tone="success" />
        </View>
        <Field label="HTTPS address">
          <FormTextInput
            initialValue={origin}
            onChangeText={setOrigin}
            accessibilityLabel="Hub HTTPS URL"
            editable={!busy}
          />
        </Field>
        <Field
          label="Relay address"
          hint="Keep the saved relay route to connect when direct access is unavailable."
        >
          <FormTextInput
            initialValue={relay}
            onChangeText={setRelay}
            accessibilityLabel="Hub relay URL"
            editable={!busy}
          />
        </Field>
        <View style={hubStyles.actions}>
          <Button variant="outline" disabled={busy} onPress={close}>
            Cancel
          </Button>
          <Button
            variant="default"
            disabled={busy || !label.trim()}
            loading={busy}
            onPress={savePress}
          >
            {busy ? "Saving..." : "Save connection"}
          </Button>
        </View>
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      </View>
      <HubContextNote>
        The new endpoint must prove it is the same Hub before a saved credential is used.
      </HubContextNote>
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
  const request = useCallback(
    (action: HubDeviceAction) => {
      if (!transport) throw new Error("Hub is not connected");
      return requestHubDevices(transport, action);
    },
    [transport],
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
    return <PairedDeviceList request={request} lockHubSwitch currentDeviceId={currentDeviceId} />;
  if (!capabilities) return <HubContextNote>Checking Hub connection…</HubContextNote>;
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
  const networkFallback = useMemo(
    () => (
      <Alert
        variant="warning"
        title="Hub is unavailable"
        description="Check the connection on your Host and this device. Your saved Hub connection is kept."
      >
        <Button variant="outline" onPress={retry}>
          Retry connection
        </Button>
      </Alert>
    ),
    [retry],
  );
  if (reason === "pairing")
    return (
      <Alert
        variant="warning"
        title="This device needs to pair again"
        description="Its Hub pairing is missing or has been revoked. Ask the Hub operator for a new pairing QR or link. Host credentials and running agents are separate."
      >
        <Button variant="outline" onPress={pairAgain}>
          Pair again
        </Button>
      </Alert>
    );
  if (reason === "signin")
    return (
      <Alert
        variant="info"
        title="Sign in to this Hub"
        description="This Hub requires an authorized account. Use your account to restore access."
      >
        <Button variant="outline" size="sm" onPress={signIn}>
          Sign in to this Hub
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
  const compact = useIsCompactFormFactor();
  const select = useCallback(() => {
    void open(profile.hubId);
  }, [open, profile.hubId]);
  let access = "Open to check access";
  let badge = "Saved";
  let tone: "success" | "warning" | "muted" = "muted";
  if (account?.signedIn) {
    badge = "Connected";
    tone = "success";
    access =
      account.connection?.accountAuthentication === "personal"
        ? "No account sign-in required"
        : `Signed in as ${account.signedIn.account.email}`;
  } else if (selected) {
    badge = status;
    tone = account?.error ? "warning" : "muted";
    if (profile.entry === "account") access = "Account sign-in required";
    else if (profile.entry === "owner-setup") access = "Owner setup required";
    else access = "Pairing required";
  }
  let host = hostLabel;
  if (!host && profile.origin) host = new URL(profile.origin).hostname;
  if (!host) host = "Available through encrypted relay";
  return (
    <View style={[settingsStyles.card, hubStyles.rowCard]}>
      <View style={hubStyles.rowHeading}>
        <HubNetworkIcon size={18} uniProps={hubMutedIconProps} />
        <Text style={hubStyles.rowTitle}>{profile.label}</Text>
        {selected ? (
          <View style={hubStyles.selected}>
            <Text style={hubStyles.selectedText}>Selected</Text>
          </View>
        ) : null}
      </View>
      <View style={hubStyles.metadata}>
        <HubMetadataRow label="Host">{host}</HubMetadataRow>
        <HubMetadataRow label="Access">{access}</HubMetadataRow>
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
          Open Hub
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
  const compact = useIsCompactFormFactor();
  const open = useCallback(() => {
    void connect(hub);
  }, [connect, hub]);
  return (
    <View style={[settingsStyles.card, hubStyles.rowCard]}>
      <View style={hubStyles.rowHeading}>
        <HubNetworkIcon size={18} uniProps={hubMutedIconProps} />
        <Text style={hubStyles.rowTitle}>Hub on {hub.hostLabel}</Text>
      </View>
      <View style={hubStyles.metadata}>
        <HubMetadataRow label="Host">{hub.hostLabel}</HubMetadataRow>
        <HubMetadataRow label="Access">Checked when you connect</HubMetadataRow>
      </View>
      <View style={hubStyles.rowFooter}>
        <HubStatusBadge label="Detected" />
        <Button
          size={compact ? "md" : "sm"}
          variant="outline"
          leftIcon={Link}
          disabled={disabled}
          onPress={open}
          style={hubStyles.openAction}
        >
          Connect
        </Button>
      </View>
    </View>
  );
}
function hubListingStatus(selected: boolean, account: ReturnType<typeof useHubAccount>): string {
  if (!selected) return "Saved";
  if (account.signedIn) return "Connected";
  if (account.loading) return "Connecting…";
  if (account.error) return "Unavailable";
  return "Sign in required";
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
