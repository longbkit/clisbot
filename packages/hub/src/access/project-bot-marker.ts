/**
 * The Project marker a daemon publishes for a Project that is a Bot's home
 * (docs/features/bots-and-chats/README.md, D4 and D13). The Hub keeps it in
 * the Project row's `metadata` beside the catalogs and hands it back on the
 * `project` resource; the resource kind stays `project` and a grant on it
 * stays a Project grant. Older daemons never send it and older apps strip it.
 */
import { z } from "zod";

// COMPAT(clisbot-bot-project-marker): optional field on the daemon's Project
// publish body; the daemon-side emitter carries the same tag.
export const ProjectBotMarkerSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["personal", "team"]),
  })
  .strict();
export type ProjectBotMarker = z.infer<typeof ProjectBotMarkerSchema>;

/** The Bot marker a Host published with its Project snapshot, if any. */
export function parseProjectBotMarker(
  metadata: unknown,
): { bot: ProjectBotMarker } | Record<never, never> {
  if (typeof metadata !== "object" || metadata === null) return {};
  const parsed = ProjectBotMarkerSchema.safeParse(Reflect.get(metadata, "bot"));
  return parsed.success ? { bot: parsed.data } : {};
}
