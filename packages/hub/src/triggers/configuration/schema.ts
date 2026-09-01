import { z } from "zod";
import { AuthoredGitHubAuthoritySchema } from "../../config/github-authority.js";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const WorktreeTargetSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("branch-off"),
    newBranch: z.string().min(1),
    base: z.string().min(1).optional(),
  }),
  z.object({ mode: z.literal("checkout-branch"), branch: z.string().min(1) }),
  z.object({ mode: z.literal("checkout-pr"), prNumber: z.number().int().positive() }),
]);

const IDENTIFIER = /^[a-z][a-z0-9_-]*$/u;
const EVENT_NAME = /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/u;
const CONNECTION_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const InputValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

export const TriggerInputSchema = z
  .object({
    type: z.enum(["string", "number", "boolean"]),
    required: z.boolean().optional(),
    default: InputValueSchema.optional(),
    choices: z.array(InputValueSchema).min(1).optional(),
  })
  .strict();

export const TriggerFilterSchema = z
  .object({
    pattern: z.string().optional(),
    contains: z.string().optional(),
    label: z.string().min(1).optional(),
    labels: z.array(z.string().min(1)).min(1).optional(),
    repo: z.string().min(1).optional(),
    guild: z.string().min(1).optional(),
    workspace: z.string().min(1).optional(),
    project: z.string().min(1).optional(),
    states: z.array(z.string().min(1)).min(1).optional(),
    exclude_labels: z.array(z.string().min(1)).min(1).optional(),
    assignees: z.array(z.string().min(1)).min(1).optional(),
    channels: z.array(z.string().min(1)).optional(),
    from_users: z.array(z.string().min(1)).optional(),
    inputs: z.record(z.string(), InputValueSchema).optional(),
  })
  .strict();

export const TriggerEventSchema = z
  .object({
    connection: z.string().regex(CONNECTION_SLUG).optional(),
    filters: TriggerFilterSchema.optional(),
  })
  .strict();

export const TriggerAgentSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1).optional(),
    mode: z.string().min(1).optional(),
    thinkingOptionId: z.string().min(1).optional(),
    options: z.record(z.string(), z.custom<JsonValue>()).optional(),
  })
  .strict();

export const TriggerAgentSelectionSchema = z.union([
  TriggerAgentSchema,
  z
    .object({
      select: z.string().min(1),
      choices: z.record(z.string().regex(IDENTIFIER), TriggerAgentSchema),
    })
    .strict(),
]);

export const TriggerTargetSchema = z
  .object({
    daemon: z.string().min(1),
    cwd: z.string().min(1),
    worktree: WorktreeTargetSchema.optional(),
  })
  .strict();

export const TriggerOutputSchema = z
  .object({
    max: z.number().int().positive().optional(),
    required: z.boolean().optional(),
  })
  .strict();

export const TriggerRunSchema = z
  .object({
    target: TriggerTargetSchema,
    agent: TriggerAgentSelectionSchema,
    prompt: z.string().min(1),
    max_runtime: z.string().min(1).default("2h"),
    idle_timeout: z.string().min(1).default("10m"),
    env: z.record(z.string().min(1), z.string()).optional(),
    github: AuthoredGitHubAuthoritySchema.optional(),
    output: z
      .object({ schema: z.record(z.string(), z.unknown()) })
      .strict()
      .optional(),
    outputs: z.record(z.string().regex(EVENT_NAME), TriggerOutputSchema).optional(),
    auto_archive: z.boolean().default(true),
  })
  .strict();

export const TriggerDocumentSchema = z
  .object({
    name: z.string().regex(IDENTIFIER),
    enabled: z.boolean().default(true),
    on: z.record(z.string().regex(EVENT_NAME), TriggerEventSchema),
    inputs: z.record(z.string().regex(IDENTIFIER), TriggerInputSchema).optional(),
    /** A distinct whole-trigger deadline; new one-run triggers normally omit it. */
    max_runtime: z.string().min(1).optional(),
    run: TriggerRunSchema,
  })
  .strict()
  .superRefine((trigger, context) => {
    if (Object.keys(trigger.on).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["on"],
        message: "at least one event is required",
      });
    }
    if ("choices" in trigger.run.agent && Object.keys(trigger.run.agent.choices).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["run", "agent", "choices"],
        message: "at least one agent choice is required",
      });
    }
  });

export type TriggerDocument = z.infer<typeof TriggerDocumentSchema>;
