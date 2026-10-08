import { suggestedDeviceLabel } from "@/device-access/device-label";
import { hubOnlyPairingTarget } from "@/device-access/pairing-target";
import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Link } from "lucide-react-native";
import type { HostProfile } from "@/types/host-connection";
import { useHosts, useHostMutations, type PasswordRequiredPairing } from "@/runtime/host-runtime";
import { parseRelayConnectionUri } from "@/utils/daemon-endpoints";
import {
  DEFAULT_APP_BASE_URL,
  parseConnectionOfferFromUrl,
} from "@clisbot/protocol/connection-offer";
import { AdaptiveModalSheet, AdaptiveTextInput, type SheetHeader } from "./adaptive-modal-sheet";
import { getConnectionAuthFailureReason } from "@/utils/test-daemon-connection";
import { PairingTargetTracker } from "./pair-link-credentials";
import { Button } from "@/components/ui/button";
import { parseDevicePairingOfferFromUrl } from "@clisbot/protocol/device-pairing-offer";
import { pairHub } from "@/device-access/hub-transport";
import { useRouter } from "expo-router";
import { buildHubSettingsRoute } from "@/clisbot/hub/navigation";
import type { EditingTextInputHandle } from "@/components/ui/text-input";

const FLEX_ONE_STYLE = { flex: 1 } as const;

function parsedHostLabel(input: string): string {
  try {
    if (input.startsWith("relay://") || input.includes("#connect=")) {
      return parseRelayConnectionUri(input).offer.serverId;
    }
    return parseConnectionOfferFromUrl(input)?.serverId ?? "host";
  } catch {
    return "host";
  }
}

const styles = StyleSheet.create((theme) => ({
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    backgroundColor: theme.colors.input,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
}));

export interface PairLinkModalProps {
  visible: boolean;
  /** Continues a confirmed pairing whose host asked for a password. */
  passwordRequired?: PasswordRequiredPairing;
  /** Clisbot: a link to prefill, such as one read from the clipboard. */
  initialUrl?: string;
  onClose: () => void;
  onCancel?: () => void;
  onSaved?: (result: {
    profile: HostProfile;
    serverId: string;
    hostname: string | null;
    isNewHost: boolean;
  }) => void;
}

export function PairLinkModal({
  visible,
  passwordRequired,
  initialUrl,
  onClose,
  onCancel,
  onSaved,
}: PairLinkModalProps) {
  return (
    <PairLinkModalContent
      key={`${visible}:${passwordRequired?.link ?? initialUrl ?? ""}`}
      visible={visible}
      passwordRequired={passwordRequired}
      initialUrl={initialUrl}
      onClose={onClose}
      onCancel={onCancel}
      onSaved={onSaved}
    />
  );
}

function PairLinkModalContent({
  visible,
  passwordRequired,
  initialUrl: prefilledUrl,
  onClose,
  onCancel,
  onSaved,
}: PairLinkModalProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const router = useRouter();
  const daemons = useHosts();
  const { beginLinkPairing } = useHostMutations();
  const [pairing] = useState(() => passwordRequired?.pairing ?? beginLinkPairing());
  const initialUrl = passwordRequired?.link ?? prefilledUrl;
  const isMobile = useIsCompactFormFactor();

  const offerUrlRef = useRef(initialUrl ?? "");
  const targetTracker = useRef(new PairingTargetTracker(initialUrl));
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [password, setPassword] = useState("");
  const [deviceLabel, setDeviceLabel] = useState(suggestedDeviceLabel);
  const [needsPassword, setNeedsPassword] = useState(passwordRequired !== undefined);
  const [passwordResetKey, resetPasswordInput] = useReducer((key: number) => key + 1, 0);

  const clearInput = useCallback(() => {
    offerUrlRef.current = "";
    targetTracker.current = new PairingTargetTracker();
    inputRef.current?.replaceText("");
    setPassword("");
    setNeedsPassword(false);
    resetPasswordInput();
  }, []);

  const pairIcon = useMemo(
    () => <Link size={16} color={theme.colors.accentForeground} />,
    [theme.colors.accentForeground],
  );

  const handleClose = useCallback(() => {
    if (isSaving) return;
    clearInput();
    setErrorMessage("");
    onClose();
  }, [isSaving, clearInput, onClose]);

  const handleCancel = useCallback(() => {
    if (isSaving) return;
    clearInput();
    setErrorMessage("");
    (onCancel ?? onClose)();
  }, [isSaving, clearInput, onCancel, onClose]);

  const handleSave = useCallback(
    async (input?: string) => {
      if (isSaving) return;
      const raw = (input ?? offerUrlRef.current).trim();
      if (!raw) {
        setErrorMessage(t("pairing.link.errors.required"));
        return;
      }
      if (!raw.includes("#offer=") && !raw.startsWith("relay://") && !raw.includes("#connect=")) {
        setErrorMessage(t("pairing.link.errors.missingOffer"));
        return;
      }

      try {
        setIsSaving(true);
        setErrorMessage("");
        const hubOffer = hubOnlyPairingTarget(raw);
        const deviceOffer = parseDevicePairingOfferFromUrl(raw);
        if (hubOffer) {
          await pairHub(hubOffer, deviceLabel);
          clearInput();
          onClose();
          router.push(buildHubSettingsRoute(hubOffer.ownerSetupToken ? "account" : "overview"));
          return;
        }
        const result = await pairing.submit(raw, password || undefined, deviceLabel);
        if (result.status === "cancelled") return;
        const { profile, serverId, hostname } = result;
        const isNewHost = !daemons.some((daemon) => daemon.serverId === serverId);
        onSaved?.({ profile, serverId, hostname, isNewHost });
        clearInput();
        onClose();
        if (deviceOffer?.hub)
          router.push(
            buildHubSettingsRoute(deviceOffer.hub.ownerSetupToken ? "account" : "overview"),
          );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t("pairing.link.errors.unableToPair");
        setErrorMessage(message);
        if (getConnectionAuthFailureReason(error)) {
          setNeedsPassword(true);
          return;
        }
        if (!isMobile) {
          Alert.alert(t("pairing.link.alert.failedTitle"), message);
        }
      } finally {
        setIsSaving(false);
      }
    },
    [
      daemons,
      isMobile,
      isSaving,
      onSaved,
      password,
      deviceLabel,
      t,
      pairing,
      clearInput,
      onClose,
      router,
    ],
  );

  const handleChangeOfferUrl = useCallback((next: string) => {
    if (targetTracker.current.changeUrl(next)) {
      setPassword("");
      setNeedsPassword(false);
      resetPasswordInput();
      setErrorMessage("");
    }
    offerUrlRef.current = next;
  }, []);

  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.link.title") }), [t]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      testID="pair-link-modal"
    >
      <Text style={styles.helper}>{t("pairing.link.helper")}</Text>
      <Text style={styles.helper}>
        For a direct connection and best speed, use Tailscale on the Host and this device. Encrypted
        relay works without Tailscale.
      </Text>

      <View style={styles.field}>
        <Text style={styles.label}>{t("pairing.link.label")}</Text>
        <AdaptiveTextInput
          ref={inputRef}
          initialValue={initialUrl}
          testID="pair-link-input"
          nativeID="pair-link-input"
          accessibilityLabel={t("pairing.link.label")}
          onChangeText={handleChangeOfferUrl}
          placeholder={`${DEFAULT_APP_BASE_URL}/#offer=...`}
          placeholderTextColor={theme.colors.placeholder}
          style={styles.input}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Device label</Text>
        <AdaptiveTextInput
          initialValue={deviceLabel}
          onChangeText={setDeviceLabel}
          accessibilityLabel="Device label"
          maxLength={80}
          style={styles.input}
        />
        <Text style={styles.helper}>Shown in paired devices. This name does not grant access.</Text>
      </View>
      {needsPassword ? (
        <View style={styles.field}>
          <Text style={styles.label}>
            {t("pairing.hostPassword.title", { host: parsedHostLabel(offerUrlRef.current) })}
          </Text>
          <AdaptiveTextInput
            testID="pair-link-password-input"
            resetKey={`pair-link-password-${passwordResetKey}`}
            accessibilityLabel={t("pairing.hostPassword.label")}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
          />
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}
          variant="secondary"
          onPress={handleCancel}
          disabled={isSaving}
          testID="pair-link-cancel"
          accessibilityRole="button"
          accessibilityLabel={t("pairing.link.actions.cancel")}
        >
          {t("pairing.link.actions.cancel")}
        </Button>
        <Button
          style={FLEX_ONE_STYLE}
          variant="default"
          onPress={handleSavePress}
          disabled={isSaving}
          testID="pair-link-submit"
          accessibilityRole="button"
          accessibilityLabel={t("pairing.link.actions.pair")}
          leftIcon={pairIcon}
        >
          {isSaving ? t("pairing.link.actions.pairing") : t("pairing.link.actions.pair")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}
