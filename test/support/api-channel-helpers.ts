import { afterEach } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionTarget } from "../../src/agents/runtime/agent-service.ts";
import type { RunUpdate } from "../../src/agents/session/run-observation.ts";
import { clisbotConfigSchema } from "../../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";
import type { LoadedConfig } from "../../src/config/core/load-config.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

export function tempPath(fileName: string) {
  const dir = mkdtempSync(join(tmpdir(), "clisbot-api-test-"));
  tempDirs.push(dir);
  return join(dir, fileName);
}

export function createLoadedConfig(auth: any = { mode: "none" }): LoadedConfig {
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.app.session.storePath = tempPath("sessions.json");
  config.agents.defaults.workspace = "/tmp/{agentId}";
  config.agents.defaults.runner.defaults.tmux.socketPath = "/tmp/clisbot.sock";
  config.agents.list = [{ id: "default" }];
  config.bots.api.defaults.enabled = true;
  config.bots.api.defaults.defaultBotId = "chatwoot";
  config.bots.api.chatwoot = {
    ...config.bots.api.default,
    enabled: true,
    name: "chatwoot",
    responseMode: "capture-pane",
    directMessages: {
      "3:970": {
        enabled: true,
        policy: "open",
        requireMention: false,
        allowUsers: [],
        blockUsers: [],
        allowBots: false,
      },
    },
    ingress: {
      successStatusCode: 202,
      auth,
      filter: {
        all: [
          { path: "$.event", equals: "message_created" },
          { path: "$.message_type", equals: "incoming" },
        ],
      },
      map: {
        eventId: "message-created-{{$.id}}",
        surfaceKind: "dm",
        surfaceId: "{{$.account.id}}:{{$.conversation.id}}",
        senderId: "$.sender.id",
        senderDisplayName: "$.sender.name",
        text: "$.content",
        replyTargetId: "$.conversation.id",
        replyParams: { accountId: "$.account.id" },
      },
    },
    actions: {},
  };
  delete config.bots.api.default;
  return {
    configPath: "/tmp/clisbot.json",
    processedEventsPath: "/tmp/processed-events.json",
    stateDir: "/tmp",
    raw: {
      ...config,
      session: {
        ...config.app.session,
        dmScope: config.bots.defaults.dmScope,
      },
      control: config.app.control,
      tmux: config.agents.defaults.runner.defaults.tmux,
    },
  };
}

export function createAgentService(overrides: Record<string, unknown> = {}) {
  return {
    isAwaitingFollowUpRouting: async () => false,
    canSteerActiveRun: () => false,
    submitSessionInput: async () => undefined,
    interruptSession: async () => ({
      interrupted: false,
      agentId: "default",
      sessionName: "api-test",
    }),
    getSessionDiagnostics: async () => ({}),
    getMaxMessageChars: () => 12000,
    recordConversationReply: async () => undefined,
    getSessionRuntime: async () => ({ state: "idle" }),
    enqueuePrompt: (target: AgentSessionTarget, _prompt: string | (() => string), callbacks: any) => {
      const update: RunUpdate = {
        status: "completed",
        agentId: target.agentId,
        sessionKey: target.sessionKey,
        sessionName: "api-test",
        workspacePath: "/tmp/default",
        snapshot: "Agent final answer",
        fullSnapshot: "Agent final answer",
        initialSnapshot: "",
      };
      void callbacks.onPromptRunStarted?.({ startedAt: Date.now() });
      return {
        positionAhead: 0,
        persisted: Promise.resolve(),
        result: Promise.resolve(update),
      };
    },
    resolveEffectiveTimezone: () => ({ timezone: "UTC" }),
    ...overrides,
  } as any;
}

export function chatwootPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 123,
    event: "message_created",
    message_type: "incoming",
    account: { id: 3 },
    conversation: { id: 970 },
    sender: { id: "u123", name: "A User" },
    content: "Please help",
    ...overrides,
  };
}

export function hmacHeaders(params: {
  body: string;
  secret: string;
  timestamp?: string;
  signatureSecret?: string;
}) {
  const timestamp = params.timestamp ?? String(Math.floor(Date.now() / 1000));
  const digest = createHmac("sha256", params.signatureSecret ?? params.secret)
    .update(`${timestamp}.${params.body}`)
    .digest("hex");
  return {
    "x-ts": timestamp,
    "x-sig": `sha256=${digest}`,
  };
}
