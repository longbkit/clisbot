import { describe, expect, it } from "vitest";
import {
  assignmentResourceOptions,
  isBotProject,
  resourceKindLabel,
  type AccessResource,
} from "./access-catalog";

const host: AccessResource = {
  kind: "daemon",
  id: "a",
  name: "Sandbox",
  parent: null,
  available: true,
};
const repo: AccessResource = {
  kind: "project",
  id: "p1",
  name: "Website",
  parent: { kind: "daemon", id: "a" },
  available: true,
};
const botHome: AccessResource = {
  kind: "project",
  id: "p2",
  name: "Ada",
  parent: { kind: "daemon", id: "a" },
  available: true,
  bot: { id: "bot_1", kind: "personal" },
};

describe("assignmentResourceOptions with a Bot's Project", () => {
  it("groups it under Bots as Bot · Host and leaves other Projects unchanged", () => {
    const options = assignmentResourceOptions([host, repo, botHome], false);
    expect(options.map(({ value, group, description }) => ({ value, group, description }))).toEqual(
      [
        { value: "daemon\0a", group: "Hosts", description: "Host" },
        { value: "project\0p1", group: "Projects", description: "Sandbox" },
        { value: "project\0p2", group: "Bots", description: "Bot · Sandbox" },
      ],
    );
  });

  it("keeps Unavailable after the Bot and Host words", () => {
    const options = assignmentResourceOptions([host, { ...botHome, available: false }], false);
    expect(options.find(({ value }) => value === "project\0p2")).toEqual(
      expect.objectContaining({ group: "Bots", description: "Bot · Sandbox · Unavailable" }),
    );
  });

  it("stays a Project for the kind label and for the grant", () => {
    expect(isBotProject(botHome)).toBe(true);
    expect(isBotProject(repo)).toBe(false);
    expect(isBotProject({ kind: "daemon", bot: { id: "bot_1", kind: "personal" } })).toBe(false);
    expect(resourceKindLabel(botHome.kind)).toBe("Project");
  });
});
