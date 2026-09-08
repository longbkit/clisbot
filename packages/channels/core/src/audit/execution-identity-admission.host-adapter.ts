// Fusion-owned host adapter for `src/audit/execution-identity-admission.ts` (D-CORE-027).
//
// Only the opaque admission-token type crosses into the message-action input.
// Upstream's module also mints and verifies the token against OpenClaw's audit
// chain, which the Hub replaces with its own execution records.

/** Opaque proof that a run was admitted; Fusion carries it without minting it. */
export type ExecutionIdentityAdmissionToken = {
  readonly runId?: string;
  readonly [key: string]: unknown;
};
