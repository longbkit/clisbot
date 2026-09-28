import {
  getPanelInstanceAttributes,
  type PanelInstanceIdentity,
} from "./panel-instance-attributes";
import { confirmDialog, type ConfirmDialogInput } from "@/utils/confirm-dialog";
/** Preserve the file panel's pending autosave when the user cancels closing it. */
export async function confirmPanelClose(
  identity: PanelInstanceIdentity,
  dialog: ConfirmDialogInput,
): Promise<boolean> {
  const attributes = getPanelInstanceAttributes(identity);
  if (!attributes.modified) return true;
  const resume = attributes.suspendPendingSave?.();
  const confirmed = await confirmDialog(dialog);
  if (!confirmed) resume?.();
  return confirmed;
}
