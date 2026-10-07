import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as QRCode from "qrcode";
import { SvgXml } from "react-native-svg";
import { Check, Copy } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { useFetchQuery } from "@/data/query";
import type { Theme } from "@/styles/theme";
import { pairingLinkRoutes } from "./pairing-offer";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

/** A pairing link as a QR code, the routes it carries, and a copyable link.
 * Used for Host pairing (Host + Hub grants) and Hub-only pairing alike. */
export function PairingLinkPanel({ url, hint }: { url: string; hint: string }) {
  const { t } = useTranslation();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => inputRef.current?.replaceText(url), [url]);
  const qrQuery = useFetchQuery({
    queryKey: ["daemon-pairing-offer-qr", url],
    queryFn: () =>
      QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 480 }),
    enabled: Boolean(url),
    dataShape: "value",
    staleTimeMs: 5 * 60 * 1000,
  });
  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [url]);
  const handleCopy = useCallback(() => void copy(), [copy]);
  return (
    <View style={styles.offer}>
      <Text style={styles.offerHint}>{hint}</Text>
      <OfferRoutes url={url} />
      <View style={styles.qrTile}>
        <PairingQr svg={qrQuery.data ?? null} isError={qrQuery.isError} />
      </View>
      <View style={styles.linkRow}>
        <View style={styles.inputWrapper}>
          <TextInput
            ref={inputRef}
            style={styles.linkInput}
            initialValue={url}
            readOnly
            selectTextOnFocus
            accessibilityLabel={t("pairing.link.label")}
          />
        </View>
        <Button variant="outline" size="sm" leftIcon={copied ? Check : Copy} onPress={handleCopy}>
          {copied ? t("pairing.device.copied") : t("pairing.device.copy")}
        </Button>
      </View>
      <Alert size="sm" variant="warning" description={t("pairing.device.securityWarning")} />
    </View>
  );
}

function OfferRoutes({ url }: { url: string }) {
  const { t } = useTranslation();
  const routes = useMemo(() => pairingLinkRoutes(url), [url]);
  if (!routes.length) return null;
  return (
    <Text style={styles.offerRoutes}>
      {t("pairing.routes.contains", {
        routes: routes.map((route) => t(`pairing.routes.route.${route}`)).join(" · "),
      })}
    </Text>
  );
}

function PairingQr({ svg, isError }: { svg: string | null; isError: boolean }) {
  const { t } = useTranslation();
  if (svg) {
    return (
      <SvgXml
        xml={svg}
        style={styles.qrImage}
        accessibilityRole="image"
        accessibilityLabel={t("pairing.device.qrAccessibility")}
      />
    );
  }
  if (isError) {
    return <Text style={styles.hint}>{t("pairing.device.qrUnavailable")}</Text>;
  }
  return <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />;
}

const styles = StyleSheet.create((theme) => ({
  offer: {
    gap: theme.spacing[4],
  },
  offerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  offerRoutes: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  qrTile: {
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    width: 304,
    maxWidth: "100%",
    aspectRatio: 1,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.palette.white,
  },
  qrImage: {
    width: "100%",
    height: "100%",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  inputWrapper: {
    flex: 1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.input,
    overflow: "hidden",
  },
  linkInput: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    outlineStyle: "none",
  } as object,
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
