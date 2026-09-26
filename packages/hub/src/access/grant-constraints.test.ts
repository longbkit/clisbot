import { describe, expect, it } from "vitest";
import { AccessConstraintsSchema, RESOURCE_ACCESS_LEVELS } from "./contract.js";
import {
  parseTerminalProfileCatalog,
  projectCreationRules,
  terminalAndFolderConstraintError,
  unionTerminalProfiles,
} from "./grant-constraints.js";

const developer = [...RESOURCE_ACCESS_LEVELS.project.developer];
const fullAccess = [...RESOURCE_ACCESS_LEVELS.daemon.full_access];

describe("terminalAndFolderConstraintError", () => {
  it("requires a profile selection with terminal.profile.use, and the leaf with a selection", () => {
    expect(
      terminalAndFolderConstraintError({
        resourceKind: "project",
        privileges: developer,
        constraints: {},
      }),
    ).toBe("terminal.profile.use requires Terminal profiles");
    expect(
      terminalAndFolderConstraintError({
        resourceKind: "project",
        privileges: ["project.use"],
        constraints: { terminalProfiles: "*" },
      }),
    ).toBe("Terminal profile constraints require terminal.profile.use");
    expect(
      terminalAndFolderConstraintError({
        resourceKind: "project",
        privileges: developer,
        constraints: { terminalProfiles: ["claude"] },
      }),
    ).toBeNull();
  });

  it("keeps folder rules to Host grants that manage", () => {
    const projectFolders = { allow: ["/workspace/**"], deny: [] };
    expect(
      terminalAndFolderConstraintError({
        resourceKind: "project",
        privileges: [...RESOURCE_ACCESS_LEVELS.project.full_access],
        constraints: { terminalProfiles: "*", projectFolders },
      }),
    ).toBe("Project folder rules apply only to Hosts");
    expect(
      terminalAndFolderConstraintError({
        resourceKind: "daemon",
        privileges: [...RESOURCE_ACCESS_LEVELS.daemon.developer],
        constraints: { terminalProfiles: "*", projectFolders },
      }),
    ).toBe("Project folder rules require workspace.manage");
    expect(
      terminalAndFolderConstraintError({
        resourceKind: "daemon",
        privileges: fullAccess,
        constraints: { terminalProfiles: "*", projectFolders },
      }),
    ).toBeNull();
  });
});

describe("unionTerminalProfiles", () => {
  it("unions the named profiles, lets * cover all, and is absent without any selection", () => {
    expect(
      unionTerminalProfiles([{ terminalProfiles: ["claude"] }, { terminalProfiles: ["codex"] }]),
    ).toEqual(["claude", "codex"]);
    expect(
      unionTerminalProfiles([{ terminalProfiles: ["claude"] }, { terminalProfiles: "*" }]),
    ).toBe("*");
    expect(unionTerminalProfiles([{}, {}])).toBeUndefined();
  });
});

describe("projectCreationRules", () => {
  it("gives one rule set per creating Host grant, un-narrowed ones allowing everywhere", () => {
    expect(
      projectCreationRules([
        { privileges: fullAccess, constraints: {} },
        {
          privileges: fullAccess,
          constraints: { projectFolders: { allow: ["/workspace/**"], deny: ["/workspace/x"] } },
        },
        { privileges: [...RESOURCE_ACCESS_LEVELS.daemon.developer], constraints: {} },
      ]),
    ).toEqual([
      { allow: ["**"], deny: [] },
      { allow: ["/workspace/**"], deny: ["/workspace/x"] },
    ]);
  });
});

describe("parseTerminalProfileCatalog", () => {
  it("reads a published catalog and ignores anything malformed", () => {
    expect(
      parseTerminalProfileCatalog({ terminalProfileCatalog: [{ id: "claude", name: "Claude" }] }),
    ).toEqual({ terminalProfileCatalog: [{ id: "claude", name: "Claude" }] });
    expect(parseTerminalProfileCatalog({ terminalProfileCatalog: [{ id: "x" }] })).toEqual({});
    expect(parseTerminalProfileCatalog(null)).toEqual({});
  });
});

describe("folder patterns on a grant", () => {
  it("refuses relative and . or .. segments, which would resolve outside the grantor's folders", () => {
    const parse = (allow: string[]) =>
      AccessConstraintsSchema.safeParse({ projectFolders: { allow, deny: [] } }).success;
    expect(parse(["~/code/**", "/workspace/*", "**"])).toBe(true);
    expect(parse(["~/code/../secret/**"])).toBe(false);
    expect(parse(["code/**"])).toBe(false);
  });
});
