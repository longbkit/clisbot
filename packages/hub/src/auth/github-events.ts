import { z } from "zod";

const OptionalStringSchema = z.string().optional().catch(undefined);
const OptionalNumberSchema = z.number().optional().catch(undefined);
const UserSchema = z
  .object({ login: OptionalStringSchema })
  .passthrough()
  .optional()
  .catch(undefined);
const LabelSchema = z.object({ name: OptionalStringSchema }).passthrough();

export const WebhookPayloadSchema = z
  .object({
    repository: z
      .object({ id: OptionalNumberSchema, full_name: OptionalStringSchema })
      .passthrough()
      .optional()
      .catch(undefined),
    installation: z.object({ id: OptionalNumberSchema }).passthrough().optional().catch(undefined),
  })
  .passthrough();

export const NormalizedGitHubEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  repo: z.string(),
  repositoryId: z.number().int().positive(),
  installationId: z.number(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const GitHubInstallationSchema = z
  .object({
    id: z.number(),
    account: z
      .object({
        login: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

export const GitHubRepositorySchema = z
  .object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    owner: z
      .object({
        login: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

export const GitHubEventSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    repo: z
      .object({
        name: z.string(),
      })
      .passthrough(),
    payload: z.record(z.string(), z.unknown()),
    created_at: z.string(),
  })
  .passthrough();

export function readGitHubTriggerUrl(payload: unknown): string | undefined {
  return (
    readNestedString(payload, "comment", "html_url") ??
    readNestedString(payload, "review", "html_url") ??
    readNestedString(payload, "issue", "html_url") ??
    readNestedString(payload, "pull_request", "html_url") ??
    readString(payload, "compare") ??
    readNestedString(payload, "repository", "html_url")
  );
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const child = value[key];
  return typeof child === "string" && child.length > 0 ? child : undefined;
}

function readNestedString(value: unknown, parentKey: string, childKey: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const parent = value[parentKey];
  if (!isRecord(parent)) {
    return undefined;
  }

  const child = parent[childKey];
  return typeof child === "string" && child.length > 0 ? child : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const IssueCommentPayloadSchema = z
  .object({
    action: OptionalStringSchema,
    issue: z
      .object({
        number: OptionalNumberSchema,
        title: OptionalStringSchema,
        body: OptionalStringSchema,
        html_url: OptionalStringSchema,
        user: UserSchema,
        labels: z.array(LabelSchema).optional().catch(undefined),
        pull_request: z.object({}).passthrough().optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
    comment: z
      .object({
        id: OptionalNumberSchema,
        body: OptionalStringSchema,
        user: UserSchema,
      })
      .optional()
      .catch(undefined),
    sender: UserSchema,
  })
  .passthrough();

export const IssuesPayloadSchema = z
  .object({
    action: OptionalStringSchema,
    issue: z
      .object({
        number: OptionalNumberSchema,
        title: OptionalStringSchema,
        body: OptionalStringSchema,
        html_url: OptionalStringSchema,
        user: UserSchema,
        labels: z.array(LabelSchema).optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
    sender: UserSchema,
    label: LabelSchema.optional().catch(undefined),
  })
  .passthrough();

export const PullRequestPayloadSchema = z
  .object({
    action: OptionalStringSchema,
    pull_request: z
      .object({
        number: OptionalNumberSchema,
        title: OptionalStringSchema,
        body: OptionalStringSchema,
        html_url: OptionalStringSchema,
        user: UserSchema,
        labels: z.array(LabelSchema).optional().catch(undefined),
        head: z
          .object({
            ref: OptionalStringSchema,
          })
          .optional()
          .catch(undefined),
      })
      .optional()
      .catch(undefined),
    sender: UserSchema,
    label: LabelSchema.optional().catch(undefined),
  })
  .passthrough();

export const PullRequestReviewPayloadSchema = PullRequestPayloadSchema.extend({
  review: z
    .object({
      body: OptionalStringSchema,
      user: UserSchema,
    })
    .optional()
    .catch(undefined),
});

export const PullRequestReviewCommentPayloadSchema = PullRequestPayloadSchema.extend({
  comment: z
    .object({
      id: OptionalNumberSchema,
      body: OptionalStringSchema,
      user: UserSchema,
    })
    .optional()
    .catch(undefined),
});

export const PullRequestResponseSchema = z
  .object({
    head: z.object({
      ref: z.string(),
    }),
  })
  .passthrough();

export const PushPayloadSchema = WebhookPayloadSchema.extend({
  after: z.string(),
  ref: z.string(),
  sender: UserSchema,
  commits: z
    .array(
      z
        .object({
          added: z.array(z.string()).default([]),
          modified: z.array(z.string()).default([]),
          removed: z.array(z.string()).default([]),
        })
        .passthrough(),
    )
    .default([]),
});

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
export type NormalizedGitHubEvent = z.infer<typeof NormalizedGitHubEventSchema>;
export type GitHubInstallation = z.infer<typeof GitHubInstallationSchema>;
export type GitHubRepository = z.infer<typeof GitHubRepositorySchema>;
export type GitHubEvent = z.infer<typeof GitHubEventSchema>;
export type PushPayload = z.infer<typeof PushPayloadSchema>;
