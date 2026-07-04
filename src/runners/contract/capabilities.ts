// Backend identity and declared capability matrix for the runner contract.
//
// Channels and control features must degrade by declared capability instead of
// by CLI-family string checks. Every backend declares what it truthfully
// supports; callers read these flags through the RunnerBackend contract.

export const RUNNER_BACKEND_IDS = ["tmux", "acp", "cli-json"] as const;

export type RunnerBackendId = (typeof RUNNER_BACKEND_IDS)[number];

export type RunnerCapabilities = {
  /** Mid-turn input injection into the active run (`/steer`). */
  steer: boolean;
  /** Stop the active turn without killing the conversation (`/stop`). */
  interrupt: boolean;
  /** Reopen a stored sessionId after a runner restart. */
  resume: boolean;
  /** A live raw view exists (tmux pane) for `/attach` and `watch`. */
  attachView: boolean;
  /** Backend surfaces structured permission requests to the client. */
  permissionRequests: boolean;
  /** Backend natively emits structured run events (not snapshot diffs). */
  structuredEvents: boolean;
  /** Tool-native slash commands can be passed through to the backend. */
  nativeSlashCommands: boolean;
  /** Backend can run shell commands inside the session workspace. */
  shellCommands: boolean;
  /** An Enter-style nudge can unstick a waiting interactive prompt (`/nudge`). */
  nudge: boolean;
};

// Declared capability matrices live with the contract so catalog and control
// surfaces can read them without importing backend implementations.

export const TMUX_RUNNER_CAPABILITIES: RunnerCapabilities = {
  steer: true,
  interrupt: true,
  resume: true,
  attachView: true,
  permissionRequests: false,
  structuredEvents: false,
  nativeSlashCommands: true,
  shellCommands: true,
  nudge: true,
};

export const ACP_RUNNER_CAPABILITIES: RunnerCapabilities = {
  steer: false,
  interrupt: true,
  resume: true,
  attachView: false,
  permissionRequests: true,
  structuredEvents: true,
  nativeSlashCommands: true,
  shellCommands: false,
  nudge: false,
};
