/** Safe display errors shared by password and Google owner setup entry. */
export class HubAccountRequestError extends Error {
  constructor(
    readonly code: string,
    status: number,
  ) {
    let message = `Hub account request failed (${status}).`;
    if (code === "owner_setup_approval_required")
      message =
        "Owner setup approval is unavailable. It may have expired or already been used. Ask the Hub operator for a new setup QR or link.";
    if (code === "setup_unavailable" || code === "owner_setup_unavailable")
      message =
        "Owner setup is no longer available. If an owner was created, sign in with an approved account; otherwise ask the Hub operator to recover setup locally.";
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
