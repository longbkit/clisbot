/**
 * The name an agent's tab shows, or null while it has none yet. A blank title and the
 * placeholder "New agent" both mean the agent has not been named.
 *
 * Shared by the agent tab and the sidebar's workspace session lines so both name a session the
 * same way.
 */
export function resolveWorkspaceAgentTabLabel(title: string | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent") {
    return null;
  }
  return normalized;
}
