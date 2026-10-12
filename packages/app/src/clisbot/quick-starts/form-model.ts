import equal from "fast-deep-equal";
import { QuickStartInputSchema, type QuickStartInput } from "@clisbot/protocol/quick-starts/types";
import type { ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
import { templateConfigProblem } from "@/clisbot/home/start-template";
import type { QuickStartEdit } from "./model";
export interface DestinationDisplay {
  label: string;
  description?: string;
}
export interface QuickStartFormState extends QuickStartEdit {
  destinationDisplay: DestinationDisplay | null;
  dirty: boolean;
  problem: string | null;
  conflict: boolean;
  canSave: boolean;
}
/** One edit instance. Catalog updates validate, never replace the user's input or display. */
export function openQuickStartForm(seed: QuickStartEdit, display: DestinationDisplay | null) {
  let custom = seed.input.agent.kind === "configured" ? seed.input.agent.config : null;
  const listeners = new Set<() => void>();
  let entries: ProviderSnapshotEntry[] | undefined;
  let state: QuickStartFormState = {
    ...seed,
    destinationDisplay: display,
    dirty: false,
    problem: null,
    conflict: false,
    canSave: false,
  };
  function publish(patch: Partial<QuickStartFormState>) {
    state = { ...state, ...patch };
    const parsed = QuickStartInputSchema.safeParse(state.input);
    let problem = !state.input.name.trim() ? "Enter a name" : null;
    if (!parsed.success && !problem) problem = "Complete the destination and branch settings";
    if (state.input.agent.kind === "configured") {
      if (!entries) problem ??= "Loading agent configuration...";
      else problem ??= templateConfigProblem(state.input.agent.config, entries);
    }
    state = {
      ...state,
      problem,
      canSave: !problem && !state.conflict,
      dirty: !equal(state.input, seed.input),
    };
    for (const listener of listeners) listener();
  }
  publish({});
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      listeners.clear();
    },
    change(input: QuickStartInput) {
      if (input.agent.kind === "configured") custom = input.agent.config;
      publish({ input });
    },
    setAgentKind(kind: "default" | "configured") {
      const first = entries?.find((entry) => entry.enabled !== false && entry.status === "ready");
      const agent: QuickStartInput["agent"] =
        kind === "default"
          ? { kind }
          : { kind, config: custom ?? { provider: first?.provider ?? "" } };
      publish({ input: { ...state.input, agent } });
    },
    setDestination(input: QuickStartInput, destinationDisplay: DestinationDisplay) {
      publish({ input, destinationDisplay });
    },
    applyProviders(next: ProviderSnapshotEntry[]) {
      entries = next;
      publish({});
    },
    setConflict() {
      publish({ conflict: true });
    },
  };
}
export type QuickStartForm = ReturnType<typeof openQuickStartForm>;
