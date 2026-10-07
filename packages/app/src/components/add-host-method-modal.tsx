import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "./adaptive-modal-sheet";
import { HostConnectionMethods, type HostConnectionMethod } from "./host-connection-methods";

export interface AddHostMethodModalProps {
  visible: boolean;
  onClose: () => void;
  onDirectConnection: () => void;
  onRemoteSsh: () => void;
  onScanQr: () => void;
  onPasteLink: () => void;
}

const TEST_IDS: Record<HostConnectionMethod, string> = {
  scanQr: "add-host-method-scan-qr",
  pasteLink: "add-host-method-pair-link",
  direct: "add-host-method-direct",
  remoteSsh: "add-host-method-remote-ssh",
};

export function AddHostMethodModal({
  visible,
  onClose,
  onDirectConnection,
  onRemoteSsh,
  onScanQr,
  onPasteLink,
}: AddHostMethodModalProps) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.connectionMethods.title") }), [t]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      testID="add-host-method-modal"
    >
      <HostConnectionMethods
        onScanQr={onScanQr}
        onPasteLink={onPasteLink}
        onDirectConnection={onDirectConnection}
        onRemoteSsh={onRemoteSsh}
        testIDs={TEST_IDS}
      />
    </AdaptiveModalSheet>
  );
}
