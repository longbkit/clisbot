import { useEffect, useRef } from "react";
import type { AgentOpenTarget, OpenPreloads } from "./targets";

function targetKey(target: AgentOpenTarget): string {
  return `${target.serverId}\u0000${target.agentId}`;
}

/**
 * Preloads the sessions at the top of a list, the ones a reader is most likely to open next.
 * A row that scrolls or sorts out of the top loses its waiting preload.
 */
export function usePreloadTopAgents(
  targets: readonly AgentOpenTarget[],
  preloads: OpenPreloads,
): void {
  const current = useRef(new Map<string, AgentOpenTarget>());
  const signature = targets.map(targetKey).join("\u0001");
  const latestTargets = useRef(targets);
  latestTargets.current = targets;

  useEffect(() => {
    const next = new Map(latestTargets.current.map((target) => [targetKey(target), target]));
    for (const [key, target] of current.current) if (!next.has(key)) preloads.cancelAgent(target);
    for (const [key, target] of next) if (!current.current.has(key)) preloads.preloadAgent(target);
    current.current = next;
  }, [signature, preloads]);

  useEffect(() => {
    const shown = current;
    return () => {
      for (const target of shown.current.values()) preloads.cancelAgent(target);
      shown.current = new Map();
    };
  }, [preloads]);
}
