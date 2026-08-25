import { z } from "zod";

export type GitHubPermissionLevel = "read" | "write" | "admin";

/**
 * GitHub REST API permission vocabulary for installation access tokens.
 *
 * Keep the API version beside this table. When GitHub adds or changes an App
 * permission, update the version and table together, then extend the contract
 * tests below so configuration never silently accepts a non-native level.
 */
export const GITHUB_APP_PERMISSION_VOCABULARY = {
  apiVersion: "2026-03-10",
  permissions: {
    actions: ["read", "write"],
    administration: ["read", "write"],
    artifact_metadata: ["read", "write"],
    attestations: ["read", "write"],
    checks: ["read", "write"],
    code_quality: ["read", "write"],
    codespaces: ["read", "write"],
    contents: ["read", "write"],
    dependabot_secrets: ["read", "write"],
    deployments: ["read", "write"],
    discussions: ["read", "write"],
    environments: ["read", "write"],
    issues: ["read", "write"],
    merge_queues: ["read", "write"],
    metadata: ["read", "write"],
    packages: ["read", "write"],
    pages: ["read", "write"],
    pull_requests: ["read", "write"],
    repository_custom_properties: ["read", "write"],
    repository_hooks: ["read", "write"],
    repository_projects: ["read", "write", "admin"],
    secret_scanning_alerts: ["read", "write"],
    secrets: ["read", "write"],
    security_events: ["read", "write"],
    single_file: ["read", "write"],
    statuses: ["read", "write"],
    vulnerability_alerts: ["read", "write"],
    workflows: ["write"],
    custom_properties_for_organizations: ["read", "write"],
    members: ["read", "write"],
    organization_administration: ["read", "write"],
    organization_custom_roles: ["read", "write"],
    organization_custom_org_roles: ["read", "write"],
    organization_custom_properties: ["read", "write", "admin"],
    organization_copilot_seat_management: ["read", "write"],
    organization_copilot_agent_settings: ["read", "write"],
    organization_announcement_banners: ["read", "write"],
    organization_events: ["read"],
    organization_hooks: ["read", "write"],
    organization_personal_access_tokens: ["read", "write"],
    organization_personal_access_token_requests: ["read", "write"],
    organization_plan: ["read"],
    organization_projects: ["read", "write", "admin"],
    organization_packages: ["read", "write"],
    organization_secrets: ["read", "write"],
    organization_self_hosted_runners: ["read", "write"],
    organization_user_blocking: ["read", "write"],
    email_addresses: ["read", "write"],
    followers: ["read", "write"],
    git_ssh_keys: ["read", "write"],
    gpg_keys: ["read", "write"],
    interaction_limits: ["read", "write"],
    profile: ["write"],
    starring: ["read", "write"],
    enterprise_custom_properties_for_organizations: ["read", "write", "admin"],
  } as const satisfies Readonly<Record<string, readonly GitHubPermissionLevel[]>>,
} as const;

export const GITHUB_PERMISSION_LEVELS = GITHUB_APP_PERMISSION_VOCABULARY.permissions;

export const DEFAULT_GITHUB_PERMISSIONS = { contents: "read" } as const;

const CONNECTION_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const REPOSITORY_FULL_NAME = /^[^/\s]+\/[^/\s]+$/u;
const GITHUB_MAX_DURATION_MS = 60 * 60 * 1000;
const RESERVED_ENVIRONMENT_KEYS = new Set([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_TERMINAL_PROMPT",
]);
const INDEXED_GIT_CONFIG_KEY = /^GIT_CONFIG_(?:KEY|VALUE)_[0-9]+$/u;

export interface AuthoredGitHubAuthority {
  connection: string;
  repositories?: readonly string[] | undefined;
  permissions?: Readonly<Record<string, GitHubPermissionLevel>> | undefined;
  duration?: string | undefined;
}

export interface CompiledGitHubAuthority {
  connection: string;
  repositories?: readonly string[] | undefined;
  permissions: Readonly<Record<string, GitHubPermissionLevel>>;
  durationMs: number;
}

const GitHubPermissionSchema = z.enum(["read", "write", "admin"]);

export const AuthoredGitHubAuthoritySchema = z
  .object({
    connection: z.string().regex(CONNECTION_SLUG),
    repositories: z.array(z.string().regex(REPOSITORY_FULL_NAME)).min(1).optional(),
    permissions: z.record(z.string(), GitHubPermissionSchema).optional(),
    duration: z.string().min(1).optional(),
  })
  .strict();

export const CompiledGitHubAuthoritySchema: z.ZodType<CompiledGitHubAuthority> = z
  .object({
    connection: z.string().regex(CONNECTION_SLUG),
    repositories: z.array(z.string().regex(REPOSITORY_FULL_NAME)).min(1).optional(),
    permissions: z.record(z.string(), GitHubPermissionSchema),
    durationMs: z.number().int().positive().max(GITHUB_MAX_DURATION_MS),
  })
  .strict();

export function compileGitHubAuthority(
  value: AuthoredGitHubAuthority,
  path: string,
): CompiledGitHubAuthority {
  validateGitHubPermissions(value.permissions ?? DEFAULT_GITHUB_PERMISSIONS, `${path}.permissions`);
  const durationMs =
    value.duration === undefined
      ? GITHUB_MAX_DURATION_MS
      : parseGitHubDurationMs(value.duration, `${path}.duration`);
  if (durationMs > GITHUB_MAX_DURATION_MS) {
    throw new Error(
      `${path}.duration must not exceed 1h because GitHub installation tokens expire after 1h`,
    );
  }
  return {
    connection: value.connection,
    ...(value.repositories === undefined ? {} : { repositories: [...value.repositories] }),
    permissions: { ...(value.permissions ?? DEFAULT_GITHUB_PERMISSIONS) },
    durationMs,
  };
}

export function validateGitHubAuthority(value: CompiledGitHubAuthority, path: string): void {
  if (value.repositories !== undefined && value.repositories.length === 0) {
    throw new Error(`${path}.repositories must name at least one repository`);
  }
  validateGitHubPermissions(value.permissions, `${path}.permissions`);
  if (value.durationMs <= 0 || value.durationMs > GITHUB_MAX_DURATION_MS) {
    throw new Error(`${path}.duration must be a positive duration no longer than 1h`);
  }
}

export function validateGitHubPermissions(
  permissions: Readonly<Record<string, string>>,
  path: string,
): asserts permissions is Readonly<Record<string, GitHubPermissionLevel>> {
  for (const [name, level] of Object.entries(permissions)) {
    const supportedLevels = (
      GITHUB_PERMISSION_LEVELS as Readonly<
        Record<string, readonly GitHubPermissionLevel[] | undefined>
      >
    )[name];
    if (supportedLevels === undefined) {
      throw new Error(`${path}.${name}: unknown GitHub permission`);
    }
    if (!(supportedLevels as readonly string[]).includes(level)) {
      throw new Error(
        `${path}.${name}: level ${level} is not supported; GitHub allows ${supportedLevels.join(" or ")}`,
      );
    }
  }
}

export function isGitHubAuthority(value: unknown): value is CompiledGitHubAuthority {
  return CompiledGitHubAuthoritySchema.safeParse(value).success;
}

export function isGitHubAuthorityEnvironmentKey(key: string): boolean {
  return RESERVED_ENVIRONMENT_KEYS.has(key) || INDEXED_GIT_CONFIG_KEY.test(key);
}

function parseGitHubDurationMs(value: string, path: string): number {
  const match = /^([1-9][0-9]*)(ms|s|m|h)$/u.exec(value);
  if (match === null) {
    throw new Error(`${path} must be a positive duration such as 30s or 1h`);
  }
  const amount = Number(match[1]);
  let multiplier: number;
  if (match[2] === "ms") multiplier = 1;
  else if (match[2] === "s") multiplier = 1_000;
  else if (match[2] === "m") multiplier = 60_000;
  else multiplier = 3_600_000;
  const durationMs = amount * multiplier;
  if (!Number.isSafeInteger(durationMs) || durationMs > GITHUB_MAX_DURATION_MS) {
    throw new Error(
      `${path} must not exceed 1h because GitHub installation tokens expire after 1h`,
    );
  }
  return durationMs;
}
