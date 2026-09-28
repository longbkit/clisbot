import pino from "pino";
import { describe, expect, it } from "vitest";
import type { StoredBot } from "@getpaseo/protocol/bots/types";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import { BotRequestError } from "../../bots/bot-creation.js";
import type { BotService } from "../../bots/index.js";
import type { SessionOutboundMessage } from "../../messages.js";
import { createStub } from "../../test-utils/class-mocks.js";
import { findByType } from "../../test-utils/session-stubs.js";
import { BotSession, dispatchBotMessage, type BotSessionAuthority } from "./bot-session.js";

const now = "2026-09-26T00:00:00.000Z";
const bot: StoredBot = {
  id: "bot_0123456789abcdef",
  slug: "ops-bot",
  name: "Ops Bot",
  kind: "personal",
  projectId: "prj_granted",
  workspaceId: "wks_1",
  cwd: "/tmp/ops-bot",
  launch: { provider: "codex" },
  template: null,
  owner: { kind: "user", id: "owner" },
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
};
const other: StoredBot = {
  ...bot,
  id: "bot_fedcba9876543210",
  slug: "other",
  projectId: "prj_other",
};

function restrictedAuthority(grantedProjectId: string): BotSessionAuthority {
  return {
    isRestricted: () => true,
    allowsProject: (projectId) => projectId === grantedProjectId,
    mayCreateProjectAt: async (path) => !path.includes("denied"),
  };
}

const ownerAuthority: BotSessionAuthority = {
  isRestricted: () => false,
  allowsProject: () => true,
  mayCreateProjectAt: async () => true,
};

function makeSession(
  stubs: { [K in keyof BotService]?: unknown },
  options: { authority?: BotSessionAuthority; actor?: SessionActor } = {},
) {
  const emitted: SessionOutboundMessage[] = [];
  const listeners: Array<(event: { kind: "upsert"; bot: StoredBot }) => void> = [];
  const service = createStub<BotService>({
    subscribe: (listener: (event: { kind: "upsert"; bot: StoredBot }) => void) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
    ...stubs,
  });
  const session = new BotSession({
    host: {
      emit: (message) => emitted.push(message),
      actor: () => options.actor,
      authority: options.authority ?? ownerAuthority,
    },
    service,
    logger: pino({ level: "silent" }),
  });
  return { session, emitted, listeners };
}

describe("BotSession", () => {
  it("bot.create records the ticket actor as owner and answers with the bot", async () => {
    const actor: SessionActor = { kind: "user", id: "member-1", memberId: "m1" };
    let received: unknown;
    const { session, emitted } = makeSession(
      {
        create: async (input: unknown, context: unknown) => {
          received = { input, context };
          return { bot, reused: false, template: { created: ["AGENTS.md"], skipped: [] } };
        },
      },
      { actor },
    );
    await session.handleCreate({
      type: "bot.create.request",
      requestId: "c1",
      name: "Ops Bot",
      launch: { provider: "codex" },
    });
    expect(received).toMatchObject({ input: { name: "Ops Bot" }, context: { owner: actor } });
    expect(
      (received as { context: { mayCreateAt?: unknown } }).context.mayCreateAt,
    ).toBeUndefined();
    expect(findByType(emitted, "bot.create.response")?.payload).toEqual({
      requestId: "c1",
      bot: { ...bot, canConfigure: true, isOwner: false },
      reused: false,
      template: { created: ["AGENTS.md"], skipped: [] },
      error: null,
    });
  });

  it("bot.create falls back to the local owner and passes a restricted session's home rule", async () => {
    let context:
      | { owner: SessionActor; mayCreateAt?: (cwd: string) => Promise<boolean> }
      | undefined;
    const { session } = makeSession(
      {
        create: async (_input: unknown, receivedContext: typeof context) => {
          context = receivedContext;
          return { bot, reused: true, template: { created: [], skipped: ["AGENTS.md"] } };
        },
      },
      { authority: restrictedAuthority("prj_granted") },
    );
    await session.handleCreate({
      type: "bot.create.request",
      requestId: "c2",
      name: "Ops Bot",
      launch: { provider: "codex" },
    });
    expect(context?.owner).toEqual({ kind: "user", id: "owner" });
    expect(await context?.mayCreateAt?.("/home/me/denied/x")).toBe(false);
    expect(await context?.mayCreateAt?.("/home/me/ok")).toBe(true);
  });

  it("bot.create reports a typed failure in the response", async () => {
    const { session, emitted } = makeSession({
      create: async () => {
        throw new BotRequestError("inside_project", "nested");
      },
    });
    await session.handleCreate({
      type: "bot.create.request",
      requestId: "c3",
      name: "Ops Bot",
      launch: { provider: "codex" },
    });
    expect(findByType(emitted, "bot.create.response")?.payload).toEqual({
      requestId: "c3",
      bot: null,
      error: "nested",
      errorCode: "inside_project",
    });
  });

  it("bot.list returns only bots whose Project the session may use", async () => {
    const { session, emitted } = makeSession(
      { list: async () => [bot, other] },
      { authority: restrictedAuthority("prj_granted") },
    );
    await session.handleList({ type: "bot.list.request", requestId: "l1" });
    expect(findByType(emitted, "bot.list.response")?.payload.bots.map((b) => b.id)).toEqual([
      bot.id,
    ]);
  });

  it("bot.update and bot.archive need workspace.manage on the bot's Project", async () => {
    const { session, emitted } = makeSession(
      {
        get: async (id: string) => [bot, other].find((candidate) => candidate.id === id) ?? null,
        update: async () => ({ ...bot, name: "Ops" }),
        archive: async () => ({ ...bot, archivedAt: now }),
      },
      {
        authority: {
          isRestricted: () => true,
          allowsProject: (projectId, privilege) =>
            projectId === "prj_granted" && privilege === "project.use",
          mayCreateProjectAt: async () => true,
        },
      },
    );
    await session.handleUpdate({ type: "bot.update.request", requestId: "u1", botId: bot.id });
    await session.handleUpdate({ type: "bot.update.request", requestId: "u2", botId: other.id });
    await session.handleArchive({ type: "bot.archive.request", requestId: "a1", botId: bot.id });
    await session.handleArchive({ type: "bot.archive.request", requestId: "a2", botId: "bot_x" });
    const updates = emitted.filter((m) => m.type === "bot.update.response");
    expect(updates.map((m) => m.payload.errorCode)).toEqual(["access_denied", "bot_not_found"]);
    const archives = emitted.filter((m) => m.type === "bot.archive.response");
    expect(archives.map((m) => m.payload.errorCode)).toEqual(["access_denied", "bot_not_found"]);
  });

  it("an owner session edits, archives and re-seeds freely", async () => {
    const { session, emitted } = makeSession({
      get: async () => bot,
      update: async () => ({ ...bot, name: "Ops" }),
      archive: async () => ({ ...bot, archivedAt: now }),
      seedTemplate: async () => ({
        bot,
        template: { created: [], skipped: ["AGENTS.md"], overwritten: ["USER.md"] },
      }),
    });
    await session.handleUpdate({
      type: "bot.update.request",
      requestId: "u1",
      botId: bot.id,
      name: "Ops",
    });
    await session.handleArchive({ type: "bot.archive.request", requestId: "a1", botId: bot.id });
    await session.handleTemplateSeed({
      type: "bot.template.seed.request",
      requestId: "s1",
      botId: bot.id,
      overwrite: true,
    });
    expect(findByType(emitted, "bot.update.response")?.payload).toMatchObject({
      bot: { name: "Ops" },
      error: null,
    });
    expect(findByType(emitted, "bot.archive.response")?.payload).toEqual({
      requestId: "a1",
      botId: bot.id,
      archivedAt: now,
      error: null,
    });
    expect(findByType(emitted, "bot.template.seed.response")?.payload.template).toEqual({
      created: [],
      skipped: ["AGENTS.md"],
      overwritten: ["USER.md"],
    });
  });

  it("forwards store changes as bot.updated until disposed", () => {
    const { session, emitted, listeners } = makeSession({});
    listeners[0]?.({ kind: "upsert", bot });
    session.dispose();
    expect(listeners).toHaveLength(0);
    expect(findByType(emitted, "bot.updated")?.payload).toEqual({
      kind: "upsert",
      bot: { ...bot, canConfigure: true, isOwner: true },
    });
  });
});

describe("dispatchBotMessage", () => {
  it("answers rpc_error bots_disabled when the daemon has no bot service", async () => {
    const emitted: SessionOutboundMessage[] = [];
    await dispatchBotMessage(null, { type: "bot.list.request", requestId: "off-1" }, (message) =>
      emitted.push(message),
    );
    expect(findByType(emitted, "rpc_error")?.payload).toEqual({
      requestId: "off-1",
      requestType: "bot.list.request",
      error: "Bots are not enabled on this Host (daemon.bots.enabled).",
      code: "bots_disabled",
    });
  });

  it("ignores messages that are not bot requests", () => {
    expect(dispatchBotMessage(null, { type: "ping" } as never, () => undefined)).toBeUndefined();
  });
});

it("projects configuration capability from the current Project grant, never the Bot creator", async () => {
  let manage = false;
  const { session, emitted, listeners } = makeSession(
    { list: async () => [bot] },
    {
      authority: {
        isRestricted: () => true,
        allowsProject: (_id, privilege) => privilege === "project.use" || manage,
        mayCreateProjectAt: async () => false,
      },
    },
  );
  await session.handleList({ type: "bot.list.request", requestId: "limited" });
  expect(findByType(emitted, "bot.list.response")?.payload.bots[0]?.canConfigure).toBe(false);
  listeners[0]!({ kind: "upsert", bot });
  expect(findByType(emitted, "bot.updated")?.payload).toMatchObject({
    bot: { canConfigure: false },
  });
  manage = true;
  emitted.length = 0;
  await session.handleList({ type: "bot.list.request", requestId: "manager" });
  expect(findByType(emitted, "bot.list.response")?.payload.bots[0]?.canConfigure).toBe(true);
  expect(bot).not.toHaveProperty("canConfigure");
  session.dispose();
});

describe("Bot ownership projection", () => {
  it.each([
    {
      label: "local owner",
      owner: { kind: "user", id: "owner" },
      actor: undefined,
      expected: true,
    },
    {
      label: "different user with manage access",
      owner: { kind: "user", id: "author" },
      actor: { kind: "user", id: "admin" },
      expected: false,
    },
    {
      label: "same user",
      owner: { kind: "user", id: "author" },
      actor: { kind: "user", id: "author" },
      expected: true,
    },
    {
      label: "same id in another organization",
      owner: { kind: "user", id: "u", hubOrigin: "https://hub", organizationId: "a" },
      actor: { kind: "user", id: "u", hubOrigin: "https://hub", organizationId: "b" },
      expected: false,
    },
    {
      label: "verified member across app and channel",
      owner: {
        kind: "user",
        id: "slack-u",
        connectionId: "slack",
        memberId: "m",
        hubOrigin: "https://hub",
        organizationId: "a",
      },
      actor: {
        kind: "user",
        id: "account",
        memberId: "m",
        hubOrigin: "https://hub",
        organizationId: "a",
      },
      expected: true,
    },
  ])("$label", async ({ owner, actor, expected }) => {
    const owned = { ...bot, owner: owner as SessionActor };
    const { session, emitted, listeners } = makeSession(
      { list: async () => [owned] },
      { actor: actor as SessionActor | undefined },
    );
    await session.handleList({ type: "bot.list.request", requestId: "owner" });
    expect(findByType(emitted, "bot.list.response")?.payload.bots[0]).toMatchObject({
      isOwner: expected,
      canConfigure: true,
    });
    listeners[0]!({ kind: "upsert", bot: owned });
    expect(findByType(emitted, "bot.updated")?.payload).toMatchObject({
      bot: { isOwner: expected },
    });
    expect(owned).not.toHaveProperty("isOwner");
    session.dispose();
  });
});
