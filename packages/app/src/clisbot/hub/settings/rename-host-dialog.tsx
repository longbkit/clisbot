import { useState } from "react";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { HubApiError } from "../api-client";

interface RenameHostDialogProps {
  name: string;
  onSave(name: string): Promise<void>;
  onClose(): void;
}

export function RenameHostDialog({ name, onSave, onClose }: RenameHostDialogProps) {
  const [initialName] = useState(name);
  async function save(value: string) {
    try {
      await onSave(value.trim());
    } catch (error) {
      if (!(error instanceof HubApiError)) throw error;
      if (error.code === "daemon_slug_conflict") {
        throw new Error("Another Host already uses that name. Choose a different name.");
      }
      if (error.code === "daemon_unavailable") {
        throw new Error("This Host is no longer available. Refresh Hosts.");
      }
      if (error.code === "forbidden") {
        throw new Error("You no longer have permission to rename this Host.");
      }
      throw error;
    }
  }
  return (
    <AdaptiveRenameModal
      visible
      title="Rename Host"
      initialValue={initialName}
      description="This changes the Host name shared with everyone in this Hub organization. Names are saved in lowercase, with hyphens instead of spaces."
      submitLabel="Save name"
      maxLength={100}
      validate={(value) => (value.trim() === initialName ? "Enter a different name." : null)}
      onSubmit={save}
      onClose={onClose}
      testID="rename-host-dialog"
    />
  );
}
