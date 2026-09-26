/**
 * Where a Project-restricted session may create a Project on this Host
 * (docs/features/access/terminal-and-project-creation.md#project-creation).
 * Three limits, all required: the Host policy, one of the session's creating
 * Host grants, and never inside an existing Project. Paths are canonical.
 */
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_PROJECT_FOLDER_POLICY,
  expandHomePath,
  folderPatternLiteralPrefix,
  folderRulesAllow,
  parseFolderPatterns,
  type ProjectFolderRules,
} from "@getpaseo/protocol/project-folders";
import { isSameOrDescendantPath } from "../path-utils.js";

export const PROJECT_FOLDERS_ALLOW_ENV = "PASEO_PROJECT_FOLDERS_ALLOW";
export const PROJECT_FOLDERS_DENY_ENV = "PASEO_PROJECT_FOLDERS_DENY";

/** The Host policy: each environment variable replaces its default list when set. */
export function hostProjectFolderPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProjectFolderRules {
  const allow = env[PROJECT_FOLDERS_ALLOW_ENV];
  const deny = env[PROJECT_FOLDERS_DENY_ENV];
  return {
    allow: allow === undefined ? DEFAULT_PROJECT_FOLDER_POLICY.allow : parseFolderPatterns(allow),
    deny: deny === undefined ? DEFAULT_PROJECT_FOLDER_POLICY.deny : parseFolderPatterns(deny),
  };
}

export interface ProjectCreationScope {
  hostPolicy: ProjectFolderRules;
  /** Undefined when the Hub predates folder rules: the Host policy alone applies. */
  grantRules: readonly ProjectFolderRules[] | undefined;
  /** Canonical roots of the Projects this daemon already has. */
  projectRoots: readonly string[];
  home?: string;
}

export function mayCreateProjectAt(canonicalPath: string, scope: ProjectCreationScope): boolean {
  const home = scope.home ?? os.homedir();
  if (!folderRulesAllow(scope.hostPolicy, canonicalPath, home)) return false;
  if (
    scope.grantRules !== undefined &&
    !scope.grantRules.some((rules) => folderRulesAllow(rules, canonicalPath, home))
  ) {
    return false;
  }
  return !scope.projectRoots.some(
    (root) => root !== canonicalPath && isSameOrDescendantPath(root, canonicalPath),
  );
}

/**
 * Folder search shows a folder you may create a Project in, or one on the way to
 * one: a parent a new folder can be made under, or an ancestor of an allowed area.
 */
export function mayBrowseForProjectAt(canonicalPath: string, scope: ProjectCreationScope): boolean {
  if (mayCreateProjectAt(canonicalPath, scope)) return true;
  if (mayCreateProjectAt(path.join(canonicalPath, "new-project"), scope)) return true;
  const home = scope.home ?? os.homedir();
  const allowPatterns = [
    ...scope.hostPolicy.allow,
    ...(scope.grantRules ?? []).flatMap(({ allow }) => allow),
  ];
  return allowPatterns.some((pattern) => {
    const prefix = folderPatternLiteralPrefix(pattern, home);
    return prefix !== null && isSameOrDescendantPath(canonicalPath, prefix);
  });
}

/**
 * Resolves each Host policy pattern's literal prefix the way the daemon resolves
 * the path it checks, so `/etc/**` still denies on macOS where `/etc` is
 * `/private/etc`. Only the Host policy is resolved: it comes from whoever runs
 * the daemon. A grant's rules come from a delegating Member, and resolving a
 * symlink they placed could point a rule outside their own folders; there a
 * symlink only makes the rule match less.
 */
export async function canonicalHostPolicy(
  rules: ProjectFolderRules,
  canonicalize: (value: string) => Promise<string | null>,
  home: string = os.homedir(),
): Promise<ProjectFolderRules> {
  const canonicalPattern = async (pattern: string) => {
    const prefix = folderPatternLiteralPrefix(pattern, home);
    if (prefix === null) return pattern;
    const expanded = expandHomePath(pattern, home);
    const canonical = await canonicalize(prefix);
    return canonical === null ? expanded : `${canonical}${expanded.slice(prefix.length)}`;
  };
  return {
    allow: await Promise.all(rules.allow.map(canonicalPattern)),
    deny: await Promise.all(rules.deny.map(canonicalPattern)),
  };
}
