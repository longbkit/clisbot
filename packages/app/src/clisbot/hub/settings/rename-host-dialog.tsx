import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { HubApiError } from "../api-client";

interface RenameHostDialogProps {
  name: string;
  onSave(name: string): Promise<void>;
  onClose(): void;
}

const RENAME_ERROR_KEYS: Record<string, string | undefined> = {
  daemon_slug_conflict: "hub.settings.renameHost.conflict",
  daemon_unavailable: "hub.settings.renameHost.unavailable",
  forbidden: "hub.settings.renameHost.forbidden",
};

export function RenameHostDialog({ name, onSave, onClose }: RenameHostDialogProps) {
  const { t } = useTranslation();
  const [initialName] = useState(name);
  const save = useCallback(
    async (value: string) => {
      try {
        await onSave(value.trim());
      } catch (error) {
        if (!(error instanceof HubApiError)) throw error;
        const messageKey = RENAME_ERROR_KEYS[error.code];
        if (messageKey) throw new Error(t(messageKey), { cause: error });
        throw error;
      }
    },
    [onSave, t],
  );
  const validate = useCallback(
    (value: string) =>
      value.trim() === initialName ? t("hub.settings.renameHost.enterDifferentName") : null,
    [initialName, t],
  );
  return (
    <AdaptiveRenameModal
      visible
      title={t("hub.settings.renameHost.title")}
      initialValue={initialName}
      description={t("hub.settings.renameHost.description")}
      submitLabel={t("hub.settings.renameHost.save")}
      maxLength={100}
      validate={validate}
      onSubmit={save}
      onClose={onClose}
      testID="rename-host-dialog"
    />
  );
}
