import type { AgentModelDefinition, AgentProvider } from "@clisbot/protocol/agent-types";

/** What a new draft has so far, and what the person or the caller already decided. */
interface DraftDefaultInput {
  provider: AgentProvider | null;
  model: string;
  /** The person picked a provider or model, or cleared them. */
  userPicked: boolean;
  /** The caller opened the draft on a provider or a model. */
  hasInitialChoice: boolean;
  /** Provider ids in the rail's order, ready or not. */
  providerOrder: readonly AgentProvider[];
  /** Enabled providers that are ready or still loading. */
  isResolvable: (provider: AgentProvider) => boolean;
  /** Null while the provider loads; empty when it offers no model. */
  modelsOf: (provider: AgentProvider) => AgentModelDefinition[] | null | undefined;
}

/**
 * The provider a new chat draft should settle on, or null to leave the draft as it is. With no
 * pick, no explicit value and no usable preference it is the first ready provider on the rail,
 * so a fresh install shows a model and Mode and its first send works. A remembered provider
 * still loading is waited for; one that cannot run falls back the same way. Nothing is ready:
 * null, and the chip keeps Select model (docs/features/composer-picker/README.md, "The panel").
 */
export function pickDraftDefaultProvider(input: DraftDefaultInput): AgentProvider | null {
  if (input.userPicked || input.hasInitialChoice) return null;
  const { provider, modelsOf, isResolvable } = input;
  if (provider && isResolvable(provider)) {
    // Loading, or ready with a model already chosen: the remembered choice stands.
    const models = modelsOf(provider);
    if (!models || input.model) return null;
    return models.length > 0 ? provider : null;
  }
  const ready = input.providerOrder.find(
    (id) => isResolvable(id) && (modelsOf(id)?.length ?? 0) > 0,
  );
  return ready ?? null;
}
