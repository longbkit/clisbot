import { useEffect, useState, useCallback, type Dispatch, type SetStateAction } from "react";
import type { QuickStartInput, QuickStartTarget } from "@clisbot/protocol/quick-starts/types";
import type { BotPayload } from "@clisbot/protocol/bots/types";
import type { useAgentInputDraft } from "@/composer/draft/input-draft";
import type { FormPreferences } from "@/create-agent-preferences/preferences";
import type { reducePickerSelection } from "@/screens/new-workspace-picker-state";
import { getHostProjectId, type HostProjectListItem } from "@/projects/host-projects";
import {
  applyLaunch,
  defaultStartLaunch,
  templateConfigProblem,
  type StartComposer,
} from "./start-template";
import type { StartKind } from "./use-start-destination";
type Set<T> = Dispatch<SetStateAction<T>>;
export interface PendingStartTemplate {
  serverId: string;
  template: QuickStartInput;
}
interface Input {
  focused: boolean;
  pending: PendingStartTemplate | null;
  setPending: Set<PendingStartTemplate | null>;
  draft: ReturnType<typeof useAgentInputDraft>;
  composer: StartComposer | null;
  directory: string | null;
  kind: StartKind;
  bot: BotPayload | undefined;
  project: HostProjectListItem | null;
  serverId: string;
  preferences: FormPreferences;
  worktreeSupport: "supported" | "unsupported" | "unknown";
  setIsolation: (isolation: "local" | "worktree", persist?: boolean) => void;
  setBaseRequired: Set<boolean>;
  setPickerOpen: Set<boolean>;
  setError: Set<string | null>;
  dispatchPicker: Dispatch<Parameters<typeof reducePickerSelection>[1]>;
}
function matchesTarget(input: Input, target: QuickStartTarget) {
  if (target.kind !== input.kind) return false;
  if (target.kind === "bot") return target.botId === input.bot?.id;
  if (target.kind === "project")
    return !!input.project && getHostProjectId(input.project, input.serverId) === target.projectId;
  return true;
}
function applyWorkspace(input: Input, target: QuickStartTarget) {
  if (target.kind !== "project") return;
  input.setIsolation(target.workspace.kind, false);
  if (target.workspace.kind !== "worktree") return;
  const base = target.workspace.base;
  const unsupported = input.worktreeSupport === "unsupported";
  input.setBaseRequired(base.kind === "ask" || unsupported);
  if (unsupported)
    input.setError(
      "This project does not support worktrees. Choose another project or explicitly select Local.",
    );
  if (base.kind === "ask" && !unsupported) input.setPickerOpen(true);
  if (base.kind === "ref")
    input.dispatchPicker({
      type: "picker-selected",
      item: {
        kind: "branch",
        name: base.refName,
        refName: base.refName,
        accessibilityLabel: base.refName,
      },
    });
}
export function useStartTemplate(input: Input) {
  const { serverId, setBaseRequired } = input;
  useEffect(() => setBaseRequired(false), [serverId, setBaseRequired]);
  let destination: string | null | undefined = input.bot?.id;
  if (input.kind !== "bot")
    destination = input.project ? getHostProjectId(input.project, input.serverId) : undefined;
  const scope = `${input.serverId}:${input.kind}:${destination}`;
  const [problem, setProblem] = useState<{
    scope: string;
    message: string;
  } | null>(null);
  const configurationProblem = problem?.scope === scope ? problem.message : null;
  const acceptCurrent = useCallback(() => setProblem(null), []);
  useEffect(() => {
    const { pending: request, draft, composer } = input;
    if (request && request.serverId !== input.serverId) {
      input.setPending(null);
      return;
    }
    const pending = request?.template;
    if (
      !pending ||
      !input.focused ||
      !draft.isHydrated ||
      !composer ||
      !input.directory ||
      !matchesTarget(input, pending.target)
    )
      return;
    if (composer.isAllModelsLoading) return;
    if (
      pending.target.kind === "project" &&
      pending.target.workspace.kind === "worktree" &&
      input.worktreeSupport === "unknown"
    )
      return;
    draft.replaceText(pending.startingPrompt);
    let config = defaultStartLaunch(input.preferences, composer);
    if (input.bot) config = input.bot.launch;
    if (pending.agent.kind === "configured") config = pending.agent.config;
    setProblem(null);
    if (config) {
      const message = templateConfigProblem(config, composer.allProviderEntries ?? []);
      setProblem(message ? { scope, message } : null);
      if (!message) applyLaunch(composer, config);
    }
    applyWorkspace(input, pending.target);
    input.setPending(null);
  }, [input, scope]);
  return { configurationProblem, acceptCurrent };
}
