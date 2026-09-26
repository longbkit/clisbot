import { describe, expect, test } from "vitest";

import { AgentProfileSchema } from "../agent-profile.js";
import { BotLaunchDefaultsSchema, StoredBotSchema } from "./types.js";

const stored = {
  id: "bot_0123456789abcdef",
  slug: "ops-bot",
  name: "Ops Bot",
  kind: "personal",
  projectId: "prj_0123456789abcdef",
  workspaceId: "wks_0123456789abcdef",
  cwd: "/home/me/.paseo/workspaces/ops-bot",
  launch: { provider: "codex", model: "gpt-5.6-luna" },
  template: { id: "personal-assistant", seededAt: "2026-09-26T00:00:00.000Z" },
  owner: { kind: "user", id: "owner" },
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
  archivedAt: null,
};

describe("StoredBotSchema", () => {
  test("round-trips a record", () => {
    expect(StoredBotSchema.parse(stored)).toEqual(stored);
  });

  test("requires the home and launch facts", () => {
    expect(() => StoredBotSchema.parse({ ...stored, cwd: undefined })).toThrow();
    expect(() => StoredBotSchema.parse({ ...stored, launch: {} })).toThrow();
    expect(() => StoredBotSchema.parse({ ...stored, kind: "shared" })).toThrow();
  });

  test("launch defaults accept an Agent profile minus its identity fields", () => {
    const profile = AgentProfileSchema.parse({
      id: "profile-1",
      name: "Fast",
      icon: "bolt",
      provider: "claude",
      model: "sonnet",
      modeId: "plan",
      thinkingOptionId: "high",
      featureValues: { fast_mode: true },
      notes: "n",
    });
    const { id: _id, name: _name, icon: _icon, notes: _notes, ...launch } = profile;
    expect(BotLaunchDefaultsSchema.parse(launch)).toEqual({
      provider: "claude",
      model: "sonnet",
      modeId: "plan",
      thinkingOptionId: "high",
      featureValues: { fast_mode: true },
    });
  });
});
