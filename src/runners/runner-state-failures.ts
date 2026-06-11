// Classification of runner-local state-store failures seen in startup panes.
//
// Codex keeps shared sqlite state (state_5.sqlite / logs_2.sqlite) in
// CODEX_HOME. Concurrent codex processes against one CODEX_HOME can hit
// SQLITE_BUSY with no retry upstream (openai/codex#20213), which makes a
// resume launch exit nonzero even though the saved rollout still exists.
// Contention is transient: the right recovery is a preserved-session-id retry
// with backoff, never a fresh conversation. Corruption and migration
// mismatches are permanent until an operator repairs the state store, so
// retrying is dishonest and the error must say what to do instead.
const STATE_CONTENTION_PATTERNS: RegExp[] = [
  /database (?:table )?is locked/i,
  /SQLITE_BUSY/i,
  /timed out waiting for state db backfill/i,
  /unable to open database file/i,
];

const STATE_CORRUPTION_PATTERNS: RegExp[] = [
  /file is not a database/i,
  /database disk image is malformed/i,
  /migration \d+ was previously applied but has been modified/i,
  /cannot access its local database/i,
];

export function paneShowsRunnerStateContention(snapshot: string) {
  if (!snapshot) {
    return false;
  }
  return STATE_CONTENTION_PATTERNS.some((pattern) => pattern.test(snapshot));
}

export function paneShowsRunnerStateCorruption(snapshot: string) {
  if (!snapshot) {
    return false;
  }
  return STATE_CORRUPTION_PATTERNS.some((pattern) => pattern.test(snapshot));
}

export class RunnerStateContentionError extends Error {
  constructor(
    readonly sessionName: string,
    readonly lastPane = "",
  ) {
    super(
      [
        `Runner session "${sessionName}" could not start because the runner's local state database is locked by another running runner process (shared CODEX_HOME contention).`,
        "Nothing was lost: the stored session id and saved conversation were preserved.",
        "Resend your prompt to retry once the other run settles.",
        "If this keeps happening, avoid starting many runner sessions at the same time or give this agent its own CODEX_HOME.",
      ].join(" "),
    );
    this.name = "RunnerStateContentionError";
  }
}

export class RunnerStateCorruptionError extends Error {
  constructor(
    readonly sessionName: string,
    readonly lastPane = "",
  ) {
    super(
      [
        `Runner session "${sessionName}" cannot start: the runner reported that its local state database is corrupted or version-mismatched.`,
        "Retrying will not help. An operator must repair the runner state in CODEX_HOME (for codex this is usually state_5.sqlite / logs_2.sqlite; see the runner's own error output).",
        "The stored session id was preserved for after the repair.",
      ].join(" "),
    );
    this.name = "RunnerStateCorruptionError";
  }
}
