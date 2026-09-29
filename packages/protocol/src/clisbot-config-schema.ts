import { z } from "zod";

const TCP_PORT_RANGE_PATTERN = /^(\d{1,5})-(\d{1,5})$/;

export const ClisbotServicePortAllocationSchema = z
  .object({
    range: z.string().trim().regex(TCP_PORT_RANGE_PATTERN).optional(),
    portScript: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => value.range !== undefined || value.portScript !== undefined,
    "Expected range or portScript",
  )
  .refine((value) => {
    if (!value.range) return true;
    const match = TCP_PORT_RANGE_PATTERN.exec(value.range);
    if (!match) return false;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return start >= 1 && end <= 65_535 && start <= end;
  }, "Expected an inclusive TCP port range from 1-65535");

export function normalizeLifecycleCommands(commands: unknown): string[] {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command): command is string => {
    return typeof command === "string" && command.trim().length > 0;
  });
}

export const ClisbotLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const ClisbotScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
  })
  .passthrough();

export const ClisbotWorktreeConfigRawSchema = z
  .object({
    setup: ClisbotLifecycleCommandRawSchema.optional(),
    teardown: ClisbotLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
    servicePorts: ClisbotServicePortAllocationSchema.optional(),
  })
  .passthrough();

export const ClisbotMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const ClisbotMetadataGenerationSchema = z
  .object({
    title: ClisbotMetadataGenerationEntrySchema.optional(),
    branchName: ClisbotMetadataGenerationEntrySchema.optional(),
    commitMessage: ClisbotMetadataGenerationEntrySchema.optional(),
    pullRequest: ClisbotMetadataGenerationEntrySchema.optional(),
  })
  // COMPAT(projectMetadataAgentTitle): `agentTitle` project metadata prompts were removed
  // in v0.1.96; keep legacy clisbot.json parseable until 2026-12-16.
  .passthrough()
  .catch({});

export const ClisbotConfigRawSchema = z
  .object({
    worktree: ClisbotWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), ClisbotScriptEntryRawSchema).optional(),
    metadataGeneration: ClisbotMetadataGenerationSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = ClisbotWorktreeConfigRawSchema.extend({
  setup: z.unknown().optional().transform(normalizeLifecycleCommands),
  teardown: z.unknown().optional().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = ClisbotScriptEntryRawSchema.catch({});

export const ClisbotConfigSchema = ClisbotConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: ClisbotMetadataGenerationSchema.optional(),
})
  .passthrough()
  .catch({});

export const ClisbotConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: ClisbotConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("write_failed") }),
]);

export type ClisbotScriptEntryRaw = z.infer<typeof ClisbotScriptEntryRawSchema>;
export type ClisbotMetadataGenerationEntry = z.infer<typeof ClisbotMetadataGenerationEntrySchema>;
export type ClisbotMetadataGeneration = z.infer<typeof ClisbotMetadataGenerationSchema>;
export type ClisbotServicePortAllocation = z.infer<typeof ClisbotServicePortAllocationSchema>;
export type ClisbotConfigRaw = z.infer<typeof ClisbotConfigRawSchema>;
export type ClisbotConfig = z.infer<typeof ClisbotConfigSchema>;
export type ClisbotConfigRevision = z.infer<typeof ClisbotConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;
