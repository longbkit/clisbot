import { i18n } from "@/i18n/i18next";

/** Safe display errors shared by password and Google owner setup entry. */
export class HubAccountRequestError extends Error {
  constructor(
    readonly code: string,
    status: number,
  ) {
    let message = i18n.t("hub.connection.errors.accountRequestFailed", { status });
    if (code === "owner_setup_approval_required")
      message = i18n.t("hub.connection.errors.ownerApprovalUnavailable");
    if (code === "setup_unavailable" || code === "owner_setup_unavailable")
      message = i18n.t("hub.connection.errors.ownerSetupUnavailable");
    super(message);
  }
}
export function needsOwnerSetupRecovery(error: unknown): error is HubAccountRequestError {
  return (
    error instanceof HubAccountRequestError &&
    ["setup_unavailable", "owner_setup_unavailable", "owner_setup_approval_required"].includes(
      error.code,
    )
  );
}
