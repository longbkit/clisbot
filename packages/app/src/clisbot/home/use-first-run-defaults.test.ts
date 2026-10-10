import { expect, test } from "vitest";
import type { ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
import { firstReadyProvider } from "./use-first-run-defaults";

const entry = (provider: string, status = "ready") =>
  ({ provider, status, enabled: true }) as ProviderSnapshotEntry;

test("a first chat uses a familiar ready agent, else the first ready one", () => {
  expect(firstReadyProvider([entry("pi"), entry("codex"), entry("claude", "unavailable")])).toBe(
    "codex",
  );
  expect(firstReadyProvider([entry("pi"), entry("gemini")])).toBe("pi");
  expect(firstReadyProvider([entry("claude", "unavailable")])).toBeNull();
});
