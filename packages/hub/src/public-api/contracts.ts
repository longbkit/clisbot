import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  MAX_PROMPT_PARTIAL_CONTENT_BYTES,
  MAX_PROMPT_PARTIAL_COUNT,
  MAX_PROMPT_PARTIAL_PATH_LENGTH,
} from "../config/prompt-partials.js";

extendZodWithOpenApi(z);

export const FieldIssueSchema = z
  .object({
    path: z.array(z.union([z.string(), z.number().int()])),
    message: z.string(),
  })
  .strict()
  .openapi("FieldIssue", {
    example: { path: ["projectSlug"], message: "Required" },
  });

export const TriggerYamlRequestSchema = z
  .object({ yaml: z.string().min(1).max(1_000_000) })
  .strict()
  .openapi("TriggerYamlRequest", {
    description: "One self-contained Paseo trigger YAML document.",
  });

export const ValidatedTriggerSchema = z
  .object({ name: z.string(), valid: z.literal(true) })
  .strict()
  .openapi("ValidatedTrigger");

export const InstalledTriggerSchema = z
  .object({
    triggerId: z.string().uuid(),
    name: z.string(),
    revisionId: z.string().uuid(),
    version: z.number().int().positive(),
    active: z.literal(true),
  })
  .strict()
  .openapi("InstalledTrigger");

export const StartCliAuthorizationRequestSchema = z
  .object({})
  .strict()
  .openapi("StartCliAuthorizationRequest");

export const CliAuthorizationSchema = z
  .object({
    deviceCode: z.string(),
    userCode: z.string(),
    verificationUri: z.string().url(),
    verificationUriComplete: z.string().url(),
    expiresAt: z.string().datetime({ offset: true }),
    interval: z.number().int().positive(),
  })
  .strict()
  .openapi("CliAuthorization");

export const PollCliAuthorizationRequestSchema = z
  .object({ deviceCode: z.string().min(32).max(200) })
  .strict()
  .openapi("PollCliAuthorizationRequest");

export const CliAuthorizationPollSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        status: z.literal("authorized"),
        interval: z.number().int().positive(),
        credential: z.string().min(1),
        organizationId: z.string().min(1),
      })
      .strict(),
    z
      .object({
        status: z.enum(["pending", "slow_down", "denied", "expired", "disclosed"]),
        interval: z.number().int().positive(),
      })
      .strict(),
  ])
  .openapi("CliAuthorizationPoll");

export const ProblemSchema = z
  .object({
    type: z.string().url(),
    title: z.string(),
    status: z.number().int().min(400).max(599),
    detail: z.string(),
    code: z.string(),
    requestId: z.string(),
    issues: z.array(FieldIssueSchema).optional(),
  })
  .strict()
  .openapi("Problem", {
    example: {
      type: "https://paseo.sh/problems/invalid-request",
      title: "Invalid request",
      status: 400,
      detail: "The request body contains invalid fields.",
      code: "invalid_request",
      requestId: "5e967c44-fc22-4f6d-8fc5-1bbff33121af",
      issues: [{ path: ["projectSlug"], message: "Required" }],
    },
  });

export const ConfigurationFileSchema = z
  .object({
    path: z.string().min(1).max(MAX_PROMPT_PARTIAL_PATH_LENGTH),
    content: z.string().max(MAX_PROMPT_PARTIAL_CONTENT_BYTES),
  })
  .strict()
  .openapi("ConfigurationFile", {
    description: "One UTF-8 file in the canonical .paseo Hub bundle.",
    example: { path: ".paseo/hub.yml", content: "environments: {}\nagents: {}\n" },
  });

export const InstallConfigurationRequestSchema = z
  .object({
    projectSlug: z.string().trim().min(1).max(100).optional(),
    files: z.array(ConfigurationFileSchema).min(1).max(MAX_PROMPT_PARTIAL_COUNT),
  })
  .strict()
  .openapi("InstallConfigurationRequest", {
    description:
      "Install the complete canonical bundle: .paseo/hub.yml, direct-child .paseo/workflows/*.yml files, and referenced .paseo/workflows/partials/*.md files.",
    example: {
      projectSlug: "payments",
      files: [
        {
          path: ".paseo/hub.yml",
          content: [
            "name: payments",
            "environments:",
            "  runner:",
            "    kind: daemon",
            "    daemon: build-server",
            "    cwd: /workspace",
            "agents:",
            "  default:",
            "    provider: test",
          ].join("\n"),
        },
        {
          path: ".paseo/workflows/deploy.yml",
          content: [
            "name: deploy",
            "on: manual.run",
            "max_runtime: 1h",
            "steps:",
            "  - id: deploy",
            "    environment: runner",
            "    max_runtime: 30m",
            "    idle_timeout: 5m",
            "    agent: default",
            "    prompt:",
            "      - include: partials/safety.md",
          ].join("\n"),
        },
        {
          path: ".paseo/workflows/partials/safety.md",
          content: "Follow the safety checklist.",
        },
      ],
    },
  });

export const InstalledConfigurationSchema = z
  .object({
    projectSlug: z.string(),
    versionId: z.string().uuid(),
    version: z.number().int().positive(),
    active: z.literal(true),
  })
  .strict()
  .openapi("InstalledConfiguration", {
    example: {
      projectSlug: "payments",
      versionId: "84af3583-23ff-4fcc-9838-ed3262499be2",
      version: 4,
      active: true,
    },
  });

export const ValidatedConfigurationSchema = z
  .object({
    projectSlug: z.string(),
    valid: z.literal(true),
    wouldCreateProject: z.literal(true).optional(),
  })
  .strict()
  .openapi("ValidatedConfiguration", {
    example: { projectSlug: "payments", valid: true, wouldCreateProject: true },
  });

export const ProjectSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
  })
  .strict()
  .openapi("Project");

export const ProjectListSchema = z
  .object({ projects: z.array(ProjectSchema) })
  .strict()
  .openapi("ProjectList", {
    example: {
      projects: [
        {
          id: "84af3583-23ff-4fcc-9838-ed3262499be2",
          name: "Payments",
          slug: "payments",
        },
      ],
    },
  });

export const TriggerExportSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    enabled: z.boolean(),
    format: z.enum(["single_run", "legacy_multistep"]),
    yaml: z.string(),
  })
  .strict()
  .openapi("TriggerExport");

export const TriggerListSchema = z
  .object({ triggers: z.array(TriggerExportSchema) })
  .strict()
  .openapi("TriggerList");

export const ConfigurationResourcesSchema = z
  .object({
    daemons: z.array(z.object({ id: z.string().uuid(), slug: z.string() }).strict()),
    github: z.array(
      z
        .object({
          slug: z.string(),
          accountLogin: z.string(),
          accountType: z.string(),
          repositories: z.array(z.string()),
        })
        .strict(),
    ),
    discord: z.array(z.object({ slug: z.string(), guildName: z.string() }).strict()),
    slack: z.array(z.object({ slug: z.string(), teamName: z.string() }).strict()),
    linear: z.array(z.object({ slug: z.string(), organizationName: z.string() }).strict()),
  })
  .strict()
  .openapi("ConfigurationResources");

export const SetupResourcesSchema = z
  .object({
    github: z.array(
      z
        .object({
          slug: z.string(),
          accountLogin: z.string(),
          accountType: z.string(),
          repositories: z.array(z.string()),
        })
        .strict(),
    ),
    discord: z.array(z.object({ guildId: z.string(), guildName: z.string() }).strict()),
    slack: z.array(z.object({ teamId: z.string(), teamName: z.string() }).strict()),
  })
  .strict()
  .openapi("SetupResources");

export const DispatchManualRunRequestSchema = z
  .object({
    projectSlug: z.string().trim().min(1).max(100),
    expectedVersionId: z.string().uuid().optional(),
    trigger: z.string().trim().min(1).max(200),
    actor: z.string().trim().min(1).max(200),
    deliveryKey: z.string().trim().min(1).max(200),
    input: z.unknown(),
  })
  .strict()
  .openapi("DispatchManualRunRequest", {
    example: {
      projectSlug: "payments",
      trigger: "deploy",
      actor: "automation",
      deliveryKey: "deploy-2026-08-06",
      input: { environment: "production" },
    },
  });

export const DispatchedManualRunSchema = z
  .object({
    deliveryKey: z.string(),
    providerEventReceiptId: z.string().uuid(),
    triggerRunId: z.string().uuid(),
    configuredTriggerName: z.string(),
    workflowStatus: z.enum(["running", "succeeded", "failed", "timed_out"]),
  })
  .strict()
  .openapi("DispatchedManualRun", {
    example: {
      deliveryKey: "deploy-2026-08-06",
      providerEventReceiptId: "845e9d26-7977-45e1-bc69-d80a7b55a9cc",
      triggerRunId: "f83dc934-02a0-4849-8de7-699110be24ed",
      configuredTriggerName: "deploy",
      workflowStatus: "running",
    },
  });

export const EnrollmentTokenSchema = z
  .object({
    token: z.string().min(32),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .openapi("EnrollmentToken", {
    example: {
      token: "one-time-secret-returned-only-once",
      expiresAt: "2026-08-06T18:10:00.000Z",
    },
  });

export type Problem = z.infer<typeof ProblemSchema>;
