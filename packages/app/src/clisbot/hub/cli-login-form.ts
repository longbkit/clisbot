import { HUB_HOST_DISCOVERY_WINDOW_MS, type DaemonReference } from "./managed-host-discovery";

export interface CliLoginFormState {
  enteredCode: string;
  submittedCode: string;
  decision: "approved" | "denied" | null;
  pending: boolean;
  error: string | null;
  baseline: readonly DaemonReference[] | null;
  discoveryDeadline: number;
  discoveryExpired: boolean;
}

/** One authorization attempt; closing it prevents late responses updating another account/code. */
export function openCliLoginForm(input: {
  code: string;
  readDaemons(): Promise<readonly DaemonReference[]>;
  decide(input: {
    userCode: string;
    decision: "approve" | "deny";
    organizationId: string;
  }): Promise<{ status: "approved" | "denied" }>;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  let closed = false;
  let lifetime = 0;
  let state: CliLoginFormState = {
    enteredCode: input.code,
    submittedCode: input.code.trim(),
    decision: null,
    pending: false,
    error: null,
    baseline: null,
    discoveryDeadline: 0,
    discoveryExpired: false,
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<CliLoginFormState>) => {
    if (closed) return;
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount() {
      closed = false;
    },
    close() {
      closed = true;
      lifetime += 1;
    },
    setCode(enteredCode: string) {
      if (!state.pending) publish({ enteredCode });
    },
    inspect() {
      if (state.pending || !state.enteredCode.trim()) return;
      publish({ submittedCode: state.enteredCode.trim(), error: null });
    },
    editCode() {
      if (!state.pending) publish({ submittedCode: "", error: null });
    },
    async decide(decision: "approve" | "deny", organizationId: string) {
      if (closed || state.pending || state.decision !== null || !state.submittedCode) return;
      const userCode = state.submittedCode;
      const attemptLifetime = lifetime;
      publish({ pending: true, error: null });
      try {
        // Capture a fresh, successful catalog before granting access. Cached/failed
        // catalogs cannot distinguish an existing Host from a new enrollment.
        const baseline = decision === "approve" ? await input.readDaemons() : null;
        if (closed || lifetime !== attemptLifetime) return;
        const result = await input.decide({
          userCode,
          decision,
          organizationId,
        });
        if (closed || lifetime !== attemptLifetime) return;
        publish({
          decision: result.status,
          baseline,
          discoveryDeadline:
            result.status === "approved" ? now() + HUB_HOST_DISCOVERY_WINDOW_MS : 0,
          discoveryExpired: false,
        });
      } catch (cause) {
        if (lifetime !== attemptLifetime) return;
        publish({
          error: cause instanceof Error ? cause.message : "Unable to record CLI login decision.",
        });
      } finally {
        if (lifetime === attemptLifetime) publish({ pending: false });
      }
    },
    expireDiscovery() {
      if (state.decision === "approved" && now() >= state.discoveryDeadline) {
        publish({ discoveryExpired: true });
      }
    },
    retryDiscovery() {
      if (state.decision !== "approved") return;
      publish({
        discoveryExpired: false,
        discoveryDeadline: now() + HUB_HOST_DISCOVERY_WINDOW_MS,
      });
    },
  };
}
