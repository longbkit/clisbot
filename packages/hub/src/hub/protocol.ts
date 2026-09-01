import { z } from "zod";
import { WorktreeTargetSchema } from "../config/index.js";

const AgentStatusSchema = z.enum(["error", "initializing", "idle", "running", "closed"]);

const McpHttpServerConfigSchema = z.object({
  type: z.literal("http"),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});

const JsonValueSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const McpToolRefSchema = z
  .object({
    kind: z.literal("mcp"),
    server: z.literal("hub"),
    tool: z.string(),
  })
  .strict();

export const HubExecutionAgentSnapshotSchema = z
  .object({
    id: z.string(),
    status: AgentStatusSchema,
  })
  .passthrough();

const HubTimelineItemSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    messageId: z.string().optional(),
    callId: z.string().optional(),
    name: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();

export function isHubFinishExecutionToolName(name: string): boolean {
  return name === "hub.finish_execution" || name === "mcp__hub__finish_execution";
}

export const HubDaemonHelloSchema = z.object({
  type: z.literal("hello"),
  clientId: z.string(),
  clientType: z.literal("hub"),
  protocolVersion: z.literal(1),
});

export const HubDaemonServerInfoEnvelopeSchema = z.object({
  type: z.literal("session"),
  message: z.object({
    type: z.literal("status"),
    payload: z
      .object({
        status: z.literal("server_info"),
        permissions: z.array(z.string()),
      })
      .passthrough(),
  }),
});

export const HubExecutionAgentStreamEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("thread_started"),
      sessionId: z.string(),
      provider: z.string(),
    })
    .passthrough(),
  z.object({ type: z.literal("turn_started"), provider: z.string() }).passthrough(),
  z.object({ type: z.literal("turn_completed"), provider: z.string() }).passthrough(),
  z
    .object({
      type: z.literal("turn_failed"),
      provider: z.string(),
      error: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("turn_canceled"),
      provider: z.string(),
      reason: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("timeline"),
      provider: z.string(),
      item: HubTimelineItemSchema,
    })
    .passthrough(),
  z
    .object({
      type: z.literal("permission_requested"),
      provider: z.string(),
      request: z.record(z.string(), z.unknown()),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("permission_resolved"),
      provider: z.string(),
      requestId: z.string(),
      resolution: z.record(z.string(), z.unknown()),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("attention_required"),
      provider: z.string(),
      reason: z.enum(["finished", "error", "permission"]),
      timestamp: z.string(),
      shouldNotify: z.boolean(),
    })
    .passthrough(),
]);

export const HubExecutionAgentCreateRequestSchema = z.object({
  type: z.literal("hub.execution.agent.create.request"),
  requestId: z.string(),
  executionId: z.string(),
  provider: z.string(),
  cwd: z.string(),
  prompt: z.string(),
  workspaceId: z.string().optional(),
  model: z.string().optional(),
  modeId: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  providerOptions: z.record(z.string(), JsonValueSchema).optional(),
  toolPolicy: z.object({ preapproved: z.array(McpToolRefSchema) }).strict(),
  featureValues: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  mcpServers: z.record(z.string(), McpHttpServerConfigSchema).optional(),
  worktree: WorktreeTargetSchema.optional(),
});

export const HubExecutionAgentValidateRequestSchema = z.object({
  type: z.literal("hub.execution.agent.validate.request"),
  requestId: z.string(),
  provider: z.string(),
  model: z.string().optional(),
  modeId: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  providerOptions: z.record(z.string(), JsonValueSchema).optional(),
});

export const HubExecutionAgentValidateResponseSchema = z.object({
  type: z.literal("hub.execution.agent.validate.response"),
  payload: z.object({
    requestId: z.string(),
    valid: z.boolean(),
    issues: z.array(
      z.object({
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string(),
      }),
    ),
    error: z.string().nullable(),
  }),
});

export const HubExecutionAgentCreateResponseSchema = z.object({
  type: z.literal("hub.execution.agent.create.response"),
  payload: z.object({
    requestId: z.string(),
    executionId: z.string(),
    agentId: z.string().nullable(),
    agent: HubExecutionAgentSnapshotSchema.nullable(),
    success: z.boolean(),
    toolPolicyApplied: z.literal(true).optional(),
    error: z
      .union([
        z.string(),
        z.discriminatedUnion("code", [
          z.object({
            code: z.literal("provider_options_invalid"),
            provider: z.string(),
            issues: z.array(
              z.object({
                path: z.array(z.union([z.string(), z.number()])),
                message: z.string(),
              }),
            ),
            message: z.string(),
          }),
          z.object({
            code: z.literal("tool_policy_unsupported"),
            provider: z.string(),
            message: z.string(),
          }),
          z.object({ code: z.literal("create_failed"), message: z.string() }),
        ]),
      ])
      .nullable(),
  }),
});

export const HubExecutionAgentUpdateSchema = z.object({
  type: z.literal("hub.execution.agent.update"),
  payload: z.object({
    executionId: z.string(),
    agentId: z.string(),
    agent: HubExecutionAgentSnapshotSchema,
  }),
});

export const HubExecutionAgentStreamSchema = z.object({
  type: z.literal("hub.execution.agent.stream"),
  payload: z.object({
    executionId: z.string(),
    agentId: z.string(),
    event: HubExecutionAgentStreamEventSchema,
  }),
});

export const HubExecutionControlActionSchema = z.enum(["interrupt", "archive"]);

export const HubExecutionControlRequestSchema = z.object({
  type: z.literal("hub.execution.control.request"),
  requestId: z.string(),
  executionId: z.string(),
  action: HubExecutionControlActionSchema,
});

export const HubExecutionControlResponseSchema = z.object({
  type: z.literal("hub.execution.control.response"),
  payload: z.object({
    requestId: z.string(),
    executionId: z.string(),
    action: HubExecutionControlActionSchema,
    success: z.boolean(),
    error: z.string().nullable(),
  }),
});

const RpcErrorSchema = z.object({
  type: z.literal("rpc_error"),
  payload: z.object({
    requestId: z.string(),
    requestType: z.string().optional(),
    error: z.string(),
    code: z.string().optional(),
  }),
});

export const HubExecutionOutboundSchema = z.object({
  type: z.literal("session"),
  message: z.discriminatedUnion("type", [
    HubExecutionAgentCreateResponseSchema,
    HubExecutionAgentUpdateSchema,
    HubExecutionAgentStreamSchema,
    HubExecutionControlResponseSchema,
    HubExecutionAgentValidateResponseSchema,
    RpcErrorSchema,
  ]),
});

export type HubExecutionAgentSnapshot = z.infer<typeof HubExecutionAgentSnapshotSchema>;
export type HubExecutionAgentStreamEvent = z.infer<typeof HubExecutionAgentStreamEventSchema>;
export type HubExecutionControlAction = z.infer<typeof HubExecutionControlActionSchema>;
