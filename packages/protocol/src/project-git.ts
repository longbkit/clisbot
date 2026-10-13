import { z } from "zod";
export const GitCommitSummarySchema = z.object({
  hash: z.string(),
  committedAt: z.string(),
  author: z.string(),
  subject: z.string(),
});
export const GitBranchSummarySchema = z.object({
  name: z.string(),
  source: z.enum(["local", "remote"]),
  remote: z.string().optional(),
  commit: GitCommitSummarySchema,
});
export const GitWorktreeSummarySchema = z.object({
  path: z.string(),
  branch: z.string().optional(),
  head: z.string().optional(),
  bare: z.boolean(),
  detached: z.boolean(),
  locked: z.boolean(),
  prunable: z.boolean(),
  commit: GitCommitSummarySchema.nullable(),
});
export const GitWorktreeInspectionSchema = z.object({
  path: z.string(),
  commit: GitCommitSummarySchema.nullable(),
  status: z
    .object({
      tracked: z.number(),
      untracked: z.number(),
      staged: z.number(),
      unstaged: z.number(),
      conflicts: z.number(),
    })
    .nullable(),
});
export const ProjectGitInspectRequestSchema = z.object({
  type: z.literal("project.git.inspect.request"),
  projectId: z.string().min(1),
  kind: z.enum(["branches", "worktrees", "worktree"]),
  path: z.string().optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  requestId: z.string(),
});
export const ProjectGitInspectResponseSchema = z.object({
  type: z.literal("project.git.inspect.response"),
  payload: z.object({
    projectId: z.string(),
    requestId: z.string(),
    error: z.string().nullable(),
    branches: z.array(GitBranchSummarySchema).optional(),
    worktrees: z.array(GitWorktreeSummarySchema).optional(),
    inspection: GitWorktreeInspectionSchema.optional(),
  }),
});
export const ProjectGitFetchRequestSchema = z.object({
  type: z.literal("project.git.fetch.request"),
  projectId: z.string().min(1),
  remote: z.string().min(1).max(255),
  requestId: z.string(),
});
export const ProjectGitFetchResponseSchema = z.object({
  type: z.literal("project.git.fetch.response"),
  payload: z.object({
    projectId: z.string(),
    remote: z.string(),
    requestId: z.string(),
    error: z.string().nullable(),
    fetchedAt: z.string().optional(),
  }),
});
export type GitCommitSummary = z.infer<typeof GitCommitSummarySchema>;
export type GitBranchSummary = z.infer<typeof GitBranchSummarySchema>;
export type GitWorktreeSummary = z.infer<typeof GitWorktreeSummarySchema>;
export type GitWorktreeInspection = z.infer<typeof GitWorktreeInspectionSchema>;
