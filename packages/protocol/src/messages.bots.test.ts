import { describe, expect, test } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

const bot = {
  id: "bot_0123456789abcdef",
  slug: "ops-bot",
  name: "Ops Bot",
  kind: "personal",
  projectId: "prj_0123456789abcdef",
  workspaceId: "wks_0123456789abcdef",
  cwd: "/home/me/.clisbot/workspaces/ops-bot",
  launch: { provider: "codex" },
  template: null,
  owner: { kind: "user", id: "owner" },
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
  archivedAt: null,
};

describe("bot wire schemas", () => {
  test("keeps the capability optional for old daemons", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "old-host",
        features: {},
      }).features.bots,
    ).toBeUndefined();
  });

  test("parses each request with only its required fields", () => {
    const requests = [
      {
        type: "bot.create.request",
        requestId: "r1",
        name: "Ops Bot",
        launch: { provider: "codex" },
      },
      { type: "bot.list.request", requestId: "r2" },
      { type: "bot.update.request", requestId: "r3", botId: bot.id, name: "Ops" },
      { type: "bot.archive.request", requestId: "r4", botId: bot.id },
      { type: "bot.template.seed.request", requestId: "r5", botId: bot.id, overwrite: true },
    ];
    for (const request of requests) {
      expect(SessionInboundMessageSchema.parse(request)).toMatchObject({ type: request.type });
    }
    expect(() =>
      SessionInboundMessageSchema.parse({ type: "bot.create.request", requestId: "r1", name: "x" }),
    ).toThrow();
  });

  test("parses each response and the push", () => {
    const responses = [
      {
        type: "bot.create.response",
        payload: { requestId: "r1", bot, reused: true, error: null },
      },
      { type: "bot.list.response", payload: { requestId: "r2", bots: [bot], error: null } },
      { type: "bot.update.response", payload: { requestId: "r3", bot, error: null } },
      {
        type: "bot.archive.response",
        payload: { requestId: "r4", botId: bot.id, archivedAt: null, error: "gone" },
      },
      {
        type: "bot.template.seed.response",
        payload: {
          requestId: "r5",
          bot,
          template: { created: ["AGENTS.md"], skipped: [] },
          error: null,
        },
      },
      { type: "bot.updated", payload: { kind: "upsert", bot } },
      { type: "bot.updated", payload: { kind: "remove", botId: bot.id } },
    ];
    for (const response of responses) {
      expect(SessionOutboundMessageSchema.parse(response)).toMatchObject({ type: response.type });
    }
  });

  test("the push union rejects an unknown kind", () => {
    expect(() =>
      SessionOutboundMessageSchema.parse({
        type: "bot.updated",
        payload: { kind: "rename", botId: bot.id },
      }),
    ).toThrow();
  });
});
