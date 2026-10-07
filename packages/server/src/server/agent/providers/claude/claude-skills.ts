import type { Query } from "@anthropic-ai/claude-agent-sdk";

/**
 * Clisbot's per-session skill switches for Claude (docs/features/connectors/README.md, "Per
 * session"): which listed commands are skills, and the `skillOverrides` flag setting that hides
 * the skills a session turned off. "off" hides a skill from the model and from /name.
 */

export function skillOverridesFor(skills: readonly string[]): Record<string, "off"> | null {
  if (skills.length === 0) return null;
  return Object.fromEntries(skills.map((skill) => [skill, "off" as const]));
}

/**
 * The session's skill names: the ones the init message named, else the SDK's own skill list.
 * Null when neither is available (an older CLI); callers then fall back to guessing.
 */
export async function claudeSkillNames(
  query: Query,
  fromInit: ReadonlySet<string> | null,
): Promise<ReadonlySet<string> | null> {
  if (fromInit) return fromInit;
  try {
    const { skills } = await query.reloadSkills();
    return new Set(skills.map((skill) => skill.name));
  } catch {
    return null;
  }
}
