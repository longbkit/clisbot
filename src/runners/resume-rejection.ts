// Detection of "the native CLI rejected the stored session id" startup output.
//
// These patterns are runner-output truths, not operator-tunable config. They
// are only evaluated against startup panes of a resume launch, never against
// normal conversation output, so they can stay deliberately narrow.
const RESUME_REJECTED_PATTERNS: RegExp[] = [
  // codex: "ERROR: No saved session found with ID <uuid>. Run codex resume
  // without an ID to choose from existing sessions."
  /no saved session found with id/i,
  // claude: "No conversation found with session ID: <uuid>"
  /no conversation found with session id/i,
  /no conversation found to resume/i,
  // gemini and generic resume-by-id failures
  /no session found with id/i,
  /could not find (?:a )?session (?:with )?id/i,
];

export function paneShowsResumeRejected(snapshot: string) {
  if (!snapshot) {
    return false;
  }
  return RESUME_REJECTED_PATTERNS.some((pattern) => pattern.test(snapshot));
}

export class RunnerResumeRejectedError extends Error {
  constructor(
    readonly sessionName: string,
    readonly storedSessionId: string,
    readonly lastPane = "",
  ) {
    super(
      `Runner session "${sessionName}" could not resume stored session id ${storedSessionId}: the runner reported that this saved session no longer exists.`,
    );
    this.name = "RunnerResumeRejectedError";
  }
}
