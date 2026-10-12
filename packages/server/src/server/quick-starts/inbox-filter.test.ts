import { expect, test } from "vitest";
import { BOT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import { matchesInboxFilter } from "./inbox-filter.js";
test("filters history type and date before pagination, with inclusive cutoff", () => {
  const agent = { labels: { [BOT_ID_LABEL]: "bot1" }, updatedAt: "2026-10-10T00:00:00.000Z" };
  expect(matchesInboxFilter(agent, { kind: "bot", updatedAfter: agent.updatedAt })).toBe(true);
  expect(matchesInboxFilter(agent, { kind: "project" })).toBe(false);
  expect(matchesInboxFilter(agent, { updatedAfter: "2026-10-11T00:00:00.000Z" })).toBe(false);
});
