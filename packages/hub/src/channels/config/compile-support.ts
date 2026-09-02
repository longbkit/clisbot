// Support for the channel pass over the Hub bundle (plan S8, implementation
// doc §4.3): the compilation error type, the YAML parse gate, and the
// mechanical leaf compilers (roles, users, transport, assignment checks).
// `compile.ts` owns the orchestration and re-exports the public surface.
// Pure — no IO beyond parsing the authored files it is given.

import { load } from "js-yaml";
import type { z } from "zod";
import { CHANNEL_POLICY_PATH, type HubBundleFile } from "../../config/bundle-contract.js";
import {
  SlackTransportSchema,
  TelegramTransportSchema,
  type RoleAssignment,
  type UserRecord,
} from "./schema.js";
import { isPrivilegePattern } from "./enums.js";
import type { CompiledRole } from "./privileges.js";

// --- Errors ------------------------------------------------------------------

export interface ChannelCompilationIssue {
  path: readonly (string | number)[];
  message: string;
}

export class ChannelCompilationError extends Error {
  constructor(readonly issues: readonly ChannelCompilationIssue[]) {
    super(issues.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("\n"));
    this.name = "ChannelCompilationError";
  }
}

/** Every compiler invariant violation funnels here — one error shape. */
export function issue(path: readonly (string | number)[], message: string): never {
  throw new ChannelCompilationError([{ path, message }]);
}

// --- Parsing -------------------------------------------------------------------

export function parseYaml<Schema extends z.ZodType>(
  file: HubBundleFile,
  schema: Schema,
): z.infer<Schema> {
  let parsed: unknown;
  try {
    parsed = load(file.content);
  } catch (error) {
    issue([file.path], `invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const [first] = result.error.issues;
    issue(
      [file.path, ...(first?.path ?? []).map(String)],
      first?.message ?? "invalid channel configuration",
    );
  }
  return result.data;
}

// --- Roles (fail-closed algebra) -----------------------------------------------

export interface AuthoredRole {
  grants: string[];
  deny?: string[] | undefined;
  extends?: string[] | undefined;
}

export type CompiledRoleRecord = Record<string, CompiledRole & { closure: readonly string[] }>;

export function compileRoles(
  authored: Record<string, AuthoredRole> | undefined,
): CompiledRoleRecord {
  const roles: CompiledRoleRecord = {};
  for (const [name, role] of Object.entries(authored ?? {})) {
    for (const entry of [...role.grants, ...(role.deny ?? [])]) {
      if (!isPrivilegePattern(entry)) {
        issue([CHANNEL_POLICY_PATH, "roles", name], `unknown privilege ${entry}`);
      }
    }
    roles[name] = {
      grants: role.grants,
      deny: role.deny ?? [],
      extends: role.extends ?? [],
      closure: resolveRoleClosure(name, authored ?? {}),
    };
  }
  return roles;
}

function resolveRoleClosure(
  name: string,
  authored: Record<string, AuthoredRole>,
): readonly string[] {
  // Unknown `extends` names contribute nothing (fail-closed); a cycle is a
  // compile error (detected on the active path before the dedupe skips it).
  const closure = new Set<string>([name]);
  const visit = (current: string, chain: ReadonlySet<string>): void => {
    for (const next of authored[current]?.extends ?? []) {
      if (authored[next] === undefined) continue;
      if (chain.has(next)) {
        issue([CHANNEL_POLICY_PATH, "roles", name], `role extends cycle through ${next}`);
      }
      if (!closure.has(next)) {
        closure.add(next);
        visit(next, new Set([...chain, next]));
      }
    }
  };
  visit(name, new Set([name]));
  return [...closure];
}

// --- Users ----------------------------------------------------------------------

/** An authored user with the optional `name` resolved to an explicit null. */
export type CompiledUser = Omit<UserRecord, "name"> & { name: string | null };

export function compileUsers(authored: Record<string, UserRecord> | undefined): {
  users: Record<string, CompiledUser>;
  identityOwners: Record<string, string>;
} {
  const users: Record<string, CompiledUser> = {};
  const identityOwners: Record<string, string> = {};
  for (const [username, record] of Object.entries(authored ?? {})) {
    users[username] = { ...record, name: record.name ?? null };
    for (const identity of record.identities) {
      const owner = identityOwners[identity];
      if (owner !== undefined) {
        issue(
          [CHANNEL_POLICY_PATH, "users", username, "identities"],
          `identity ${identity} already belongs to ${owner}; each identity belongs to exactly one user`,
        );
      }
      identityOwners[identity] = username;
    }
  }
  return { users, identityOwners };
}

// --- Shared helpers --------------------------------------------------------------

export function validateAssignments(
  assignments: readonly RoleAssignment[],
  users: Record<string, CompiledUser>,
  file: string,
): void {
  for (const assignment of assignments) {
    for (const identity of assignment.identities) {
      if (identity.startsWith("user:")) {
        const username = identity.slice("user:".length);
        if (users[username] === undefined) {
          issue([file], `assignment references unknown user ${identity}`);
        }
      }
    }
  }
}

export function compileTransport(
  file: string,
  channel: string,
  authored: unknown,
): Record<string, unknown> {
  // P0 supports two channels; the transport block is channel-native (§4.3.3).
  let schema: typeof SlackTransportSchema | typeof TelegramTransportSchema | null;
  if (channel === "slack") {
    schema = SlackTransportSchema;
  } else if (channel === "telegram") {
    schema = TelegramTransportSchema;
  } else {
    schema = null;
  }
  if (schema === null) {
    issue([file, "transport"], `channel ${channel} is not supported at P0 (slack, telegram)`);
  }
  const result = schema.safeParse(authored);
  if (!result.success) {
    const [first] = result.error.issues;
    issue(
      [file, "transport", ...(first?.path ?? []).map(String)],
      first?.message ?? "invalid transport block",
    );
  }
  if (
    (channel === "slack" && result.data.mode !== "socket") ||
    (channel === "telegram" && result.data.mode !== "polling")
  ) {
    issue(
      [file, "transport", "mode"],
      `${channel} ${String(result.data.mode)} transport is not implemented; refusing a configuration that cannot receive events`,
    );
  }
  return result.data;
}
