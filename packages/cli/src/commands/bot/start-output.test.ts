import { afterEach, expect, it, vi } from "vitest";
import { createOutputOptions } from "../../output/with-output.js";
import { botRestartCommand, renderBotStart } from "./start-output.js";
import type { BotStartReport } from "./run.js";

const bot: BotStartReport = {
  name: "personal-assistant",
  reused: false,
  agentId: "agent-1",
  agentTitle: "Personal assistant",
  provider: "codex",
  channel: "slack",
  account: "personal-assistant",
  workspacePath: "/test/workspace",
  workspaceId: "wks-1",
  credential: "persisted",
  hub: "started",
  hubUrl: "http://127.0.0.1:6868",
  hubPid: "123",
  daemon: "started",
  daemonHost: "127.0.0.1:6867",
  channelTransport: "started",
  ownerReady: false,
  ownerLinkCommand: "/link TEST-CODE",
  ownerLinkExpiresAt: "2026-09-06T12:10:00.000Z",
  ownerLinkRenewCommand: botRestartCommand("/test/home", "personal-assistant"),
  nextStep: "Send a request",
  routeNote: "Routes configured",
};
function render(data: BotStartReport): string {
  return renderBotStart(
    { type: "single", data, schema: { idField: "name", columns: [] } },
    createOutputOptions({ noColor: true }),
  );
}
afterEach(() => vi.useRealTimers());

it("puts required identity linking before infrastructure details and explains expiry and renewal", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T12:00:00.000Z"));
  const text = render(bot);
  expect(text).toContain("SETUP INCOMPLETE");
  expect(text.indexOf("ACTION REQUIRED")).toBeLessThan(text.indexOf("Workspace"));
  expect(text).toContain("10 min remaining");
  expect(text).toContain("2026-09-06 12:10:00 UTC");
  expect(text).toContain("/link TEST-CODE");
  expect(text).toContain(bot.ownerLinkRenewCommand);
  expect(text).toContain("invalidates the previous code");
  expect(text).not.toContain("\u001b[");
});

it("does not report READY until both owner and transport are ready", () => {
  const linked = { ...bot, ownerReady: true, ownerLinkCommand: undefined };
  expect(render(linked)).toContain("— READY");
  expect(render(linked)).not.toContain("ACTION REQUIRED");
  expect(render({ ...linked, channelTransport: "deferred" })).toContain("SETUP INCOMPLETE");
});

it("marks an expired code and retains a safely quoted recovery command", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T12:11:00.000Z"));
  expect(render(bot)).toContain("Expired:");
  expect(botRestartCommand("/home/O'Brien", "assistant")).toContain("'/home/O'\\''Brien'");
});
