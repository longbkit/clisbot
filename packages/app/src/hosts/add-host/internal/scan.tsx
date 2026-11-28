import { pairedHubSettingsRoute } from "@/device-access/pairing-target";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import type { BarcodeScanningResult, BarcodeSettings } from "expo-camera";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { openPairScan } from "./pair-scan-model";
import { isQrCameraAvailable } from "@/hosts/qr-scan-support";
import { PairLinkModal } from "./pair-link-modal";
import { Button } from "@/components/ui/button";

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  body: {
    flex: 1,
    paddingHorizontal: theme.spacing[6],
  },
  cameraWrap: {
    flex: 1,
    overflow: "hidden",
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
  },
  scanFrame: {
    width: 260,
    height: 260,
  },
  corner: {
    position: "absolute",
    width: 36,
    height: 36,
    borderColor: theme.colors.accent,
  },
  cornerTL: {
    left: 0,
    top: 0,
    borderLeftWidth: 4,
    borderTopWidth: 4,
    borderTopLeftRadius: 12,
  },
  cornerTR: {
    right: 0,
    top: 0,
    borderRightWidth: 4,
    borderTopWidth: 4,
    borderTopRightRadius: 12,
  },
  cornerBL: {
    left: 0,
    bottom: 0,
    borderLeftWidth: 4,
    borderBottomWidth: 4,
    borderBottomLeftRadius: 12,
  },
  cornerBR: {
    right: 0,
    bottom: 0,
    borderRightWidth: 4,
    borderBottomWidth: 4,
    borderBottomRightRadius: 12,
  },
  scanAgainButton: {
    marginTop: theme.spacing[6],
  },
  helperText: {
    marginTop: theme.spacing[6],
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    fontSize: theme.fontSize.base,
  },
  permissionCard: {
    marginTop: theme.spacing[6],
    padding: theme.spacing[6],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
    gap: theme.spacing[4],
  },
  permissionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  permissionBody: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  permissionButton: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.palette.blue[500],
  },
  permissionButtonText: {
    color: theme.colors.palette.white,
    fontWeight: theme.fontWeight.semibold,
  },
}));

export function PairScanContent({
  onConnected,
  onClose,
  onHubConnected,
}: {
  onConnected: (serverId: string) => void;
  onClose: () => void;
  /** Clisbot: a scanned device invitation or Hub link enrolled this app in a Hub. */
  onHubConnected?: (link: string) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraAvailable] = useState(isQrCameraAvailable);
  // Set when the camera stream fails to start, such as when another app holds the camera.
  const [cameraFailed, setCameraFailed] = useState(false);

  const [scan] = useState(() =>
    openPairScan({
      importConnectionLink: (link) => getHostRuntimeStore().importConnectionLink(link, "hostRoot"),
      onConnected,
      onHubConnected: (link) =>
        onHubConnected ? onHubConnected(link) : router.navigate(pairedHubSettingsRoute(link)),
    }),
  );
  const scanState = useSyncExternalStore(scan.subscribe, scan.getState, scan.getState);
  useEffect(() => () => scan.close(), [scan]);

  // Ask once per visit, after the current status loads. Every answer is a new permission object,
  // so asking again on each change would loop as fast as a refusal returns.
  const permissionAsked = useRef(false);
  useEffect(() => {
    if (!cameraAvailable || !permission || permission.granted || permissionAsked.current) return;
    permissionAsked.current = true;
    void requestPermission().catch(() => undefined);
  }, [cameraAvailable, permission, requestPermission]);

  const handleScan = useCallback(
    (result: BarcodeScanningResult) =>
      scan.scan(typeof result.data === "string" ? result.data : ""),
    [scan],
  );

  const savePasswordPairing = useCallback(
    ({ serverId }: { serverId: string }) => onConnected(serverId),
    [onConnected],
  );
  const handleCameraMountError = useCallback(() => setCameraFailed(true), []);
  const handleRequestPermission = useCallback(() => {
    void requestPermission();
  }, [requestPermission]);

  const bodyStyle = useMemo(
    () => [styles.body, { paddingBottom: insets.bottom + 24 }],
    [insets.bottom],
  );

  if (!cameraAvailable || cameraFailed) {
    return (
      <View style={styles.container}>
        <View style={bodyStyle}>
          <View style={styles.permissionCard}>
            <Text style={styles.permissionTitle}>{t("pairing.scan.cameraUnavailableTitle")}</Text>
            <Text style={styles.permissionBody}>{t("pairing.scan.cameraUnavailableBody")}</Text>
            <Button style={styles.permissionButton} onPress={onClose}>
              <Text style={styles.permissionButtonText}>{t("common.actions.back")}</Text>
            </Button>
          </View>
        </View>
      </View>
    );
  }

  const granted = Boolean(permission?.granted);

  return (
    <View style={styles.container}>
      <View style={bodyStyle}>
        {!granted ? (
          <View style={styles.permissionCard}>
            <Text style={styles.permissionTitle}>{t("pairing.scan.cameraPermissionTitle")}</Text>
            <Text style={styles.permissionBody}>{t("pairing.scan.cameraPermissionBody")}</Text>
            <Button style={styles.permissionButton} onPress={handleRequestPermission}>
              <Text style={styles.permissionButtonText}>{t("pairing.scan.grantPermission")}</Text>
            </Button>
          </View>
        ) : (
          <View style={styles.cameraWrap}>
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={BARCODE_SCANNER_SETTINGS}
              onBarcodeScanned={handleScan}
              onMountError={handleCameraMountError}
            />
            <View style={styles.overlay} pointerEvents="box-none">
              <View style={styles.scanFrame}>
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>
              {scanState.status === "pairing" ? (
                <Text style={styles.helperText}>{t("pairing.scan.pairing")}</Text>
              ) : null}
              {scanState.status === "stopped" && scanState.error ? (
                <Text style={styles.helperText}>{scanState.error}</Text>
              ) : null}
              {scanState.status === "stopped" ? (
                <Button
                  style={styles.scanAgainButton}
                  onPress={scan.scanAgain}
                  testID="pair-scan-again"
                >
                  {t("pairing.connectionMethods.scanQr.title")}
                </Button>
              ) : null}
            </View>
          </View>
        )}
      </View>
      <PairLinkModal
        visible={scanState.status === "passwordRequired"}
        passwordRequired={
          scanState.status === "passwordRequired" ? scanState.passwordRequired : undefined
        }
        onClose={scan.closePassword}
        onSaved={savePasswordPairing}
      />
    </View>
  );
}

const BARCODE_SCANNER_SETTINGS: BarcodeSettings = { barcodeTypes: ["qr"] };
