import { describe, expect, it } from "vitest";
import {
  canonicalHostPolicy,
  hostProjectFolderPolicy,
  mayBrowseForProjectAt,
  mayCreateProjectAt,
  type ProjectCreationScope,
} from "./project-folder-policy.js";

const scope: ProjectCreationScope = {
  hostPolicy: { allow: ["/workspace/**", "~/code/**"], deny: ["/workspace/prod/**"] },
  grantRules: undefined,
  projectRoots: ["/workspace/app"],
  home: "/home/ai",
};

describe("hostProjectFolderPolicy", () => {
  it("replaces each default list only when its variable is set", () => {
    expect(hostProjectFolderPolicy({})).toEqual({
      allow: ["**"],
      deny: ["/", "~", "~/.ssh/**", "/etc/**"],
    });
    expect(
      hostProjectFolderPolicy({ CLISBOT_PROJECT_FOLDERS_ALLOW: "/workspace/**, ~/code/**" }),
    ).toEqual({ allow: ["/workspace/**", "~/code/**"], deny: ["/", "~", "~/.ssh/**", "/etc/**"] });
    expect(hostProjectFolderPolicy({ CLISBOT_PROJECT_FOLDERS_DENY: "" }).deny).toEqual([]);
  });
});

describe("mayCreateProjectAt", () => {
  it("needs the Host policy, one grant's rules, and no enclosing Project", () => {
    expect(mayCreateProjectAt("/workspace/new", scope)).toBe(true);
    expect(mayCreateProjectAt("/home/ai/code/tool", scope)).toBe(true);
    expect(mayCreateProjectAt("/workspace/prod/api", scope)).toBe(false);
    expect(mayCreateProjectAt("/srv/app", scope)).toBe(false);
    expect(mayCreateProjectAt("/workspace/app/nested", scope)).toBe(false);
    const narrowed = { ...scope, grantRules: [{ allow: ["/workspace/qc/**"], deny: [] }] };
    expect(mayCreateProjectAt("/workspace/qc/new", narrowed)).toBe(true);
    expect(mayCreateProjectAt("/workspace/new", narrowed)).toBe(false);
    // A Host grant with no creating grant at all creates nothing.
    expect(mayCreateProjectAt("/workspace/new", { ...scope, grantRules: [] })).toBe(false);
  });
});

describe("mayBrowseForProjectAt", () => {
  it("shows folders on the way to an allowed area, and hides denied ones", () => {
    expect(mayBrowseForProjectAt("/", scope)).toBe(true);
    expect(mayBrowseForProjectAt("/home/ai", scope)).toBe(true);
    expect(mayBrowseForProjectAt("/workspace", scope)).toBe(true);
    expect(mayBrowseForProjectAt("/workspace/prod", scope)).toBe(false);
    expect(mayBrowseForProjectAt("/srv", scope)).toBe(false);
  });
});

describe("canonicalHostPolicy", () => {
  it("resolves each pattern's literal prefix, keeping the wildcard part and bare **", async () => {
    const canonicalize = async (value: string) =>
      value.startsWith("/var/") ? `/private${value}` : value;
    expect(
      await canonicalHostPolicy(
        { allow: ["/var/tmp/team/**", "**", "~/code/*"], deny: ["/var/tmp/team/secret"] },
        canonicalize,
        "/home/ai",
      ),
    ).toEqual({
      allow: ["/private/var/tmp/team/**", "**", "/home/ai/code/*"],
      deny: ["/private/var/tmp/team/secret"],
    });
  });
});

describe("grant rules are not resolved through symlinks", () => {
  it("does not match a folder a grant names only through a symlink", () => {
    // `~/code/link` points at /srv/prod; the daemon checks the canonical /srv/prod/app.
    const linked = {
      hostPolicy: { allow: ["**"], deny: [] },
      grantRules: [{ allow: ["/home/ai/code/link/**"], deny: [] }],
      projectRoots: [],
      home: "/home/ai",
    };
    expect(mayCreateProjectAt("/srv/prod/app", linked)).toBe(false);
  });
});
