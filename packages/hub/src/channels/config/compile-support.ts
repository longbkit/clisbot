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
  DiscordTransportSchema,
  FeishuAccountConfigSchema,
  FeishuTransportSchema,
  GoogleChatAccountConfigSchema,
  GoogleChatTransportSchema,
  TelegramTransportSchema,
  ZaloAccountConfigSchema,
  ZaloTransportSchema,
  ZalouserAccountConfigSchema,
  ZalouserTransportSchema,
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

/** One transport schema per channel with an in-repo vertical (§4.3.3). */
const TRANSPORT_SCHEMAS = {
  slack: SlackTransportSchema,
  telegram: TelegramTransportSchema,
  discord: DiscordTransportSchema,
  googlechat: GoogleChatTransportSchema,
  feishu: FeishuTransportSchema,
  zalouser: ZalouserTransportSchema,
  zalo: ZaloTransportSchema,
} as const;

/**
 * The transport mode the Hub can actually receive events on, per channel. A
 * mode the vertical implements but the Hub cannot drive is refused at compile
 * rather than started into silence:
 *
 *  * Slack `webhook`, Telegram `webhook`, Feishu `webhook` and Zalo `webhook`
 *    all need a public HTTPS URL the Hub does not publish; each has a mode that
 *    needs none (socket / polling / long connection), so that mode is the only
 *    one offered.
 *  * Zalo Personal has one mode: the QR-linked session's push socket. It needs
 *    no public URL, so there is nothing to refuse.
 *  * Google Chat has no such alternative — HTTP POST is its only delivery
 *    model — so `webhook` is admitted and the operator supplies the reverse
 *    proxy (`packages/channels/googlechat/HUB-WIRING.md` §6).
 */
const DRIVABLE_TRANSPORT_MODES: Record<keyof typeof TRANSPORT_SCHEMAS, string> = {
  slack: "socket",
  telegram: "polling",
  discord: "gateway",
  googlechat: "webhook",
  feishu: "websocket",
  zalouser: "qr",
  zalo: "polling",
};

function isTransportChannel(channel: string): channel is keyof typeof TRANSPORT_SCHEMAS {
  return channel in TRANSPORT_SCHEMAS;
}

export function compileTransport(
  file: string,
  channel: string,
  authored: unknown,
): Record<string, unknown> {
  if (!isTransportChannel(channel)) {
    issue(
      [file, "transport"],
      `channel ${channel} has no in-repo vertical (${Object.keys(TRANSPORT_SCHEMAS).join(", ")})`,
    );
  }
  const result = TRANSPORT_SCHEMAS[channel].safeParse(authored);
  if (!result.success) {
    const [first] = result.error.issues;
    issue(
      [file, "transport", ...(first?.path ?? []).map(String)],
      first?.message ?? "invalid transport block",
    );
  }
  const mode = String(result.data.mode);
  if (mode !== DRIVABLE_TRANSPORT_MODES[channel]) {
    issue(
      [file, "transport", "mode"],
      `${channel} ${mode} transport is not implemented; refusing a configuration that cannot receive events`,
    );
  }
  return result.data;
}

/**
 * The vertical-owned `config` block. It is passed through verbatim (each
 * vertical type-checks its own keys on read), but the channels wired in slices
 * 14b/15b/16b get their drive-path keys type-checked here so a wrong-typed knob
 * fails at deploy instead of at start. The shapes are loose: an upstream account
 * file carries knobs this Hub never reads.
 */
const ACCOUNT_CONFIG_SCHEMAS: Record<string, z.ZodType> = {
  googlechat: GoogleChatAccountConfigSchema,
  feishu: FeishuAccountConfigSchema,
  zalo: ZaloAccountConfigSchema,
  zalouser: ZalouserAccountConfigSchema,
};

/**
 * Fusion's product defaults for that same block: a key the Hub fills in when
 * the author left it out. Deliberately per-channel and never a floor across
 * channels — a compiled `config` is otherwise the author's text, so every entry
 * here changes what already-deployed revisions do and has to earn it.
 *
 * `telegram.richMessages` is the one entry: upstream's Telegram HTML path has
 * no heading tag and flattens `#` headings (its `format.test.ts` pins that),
 * while the native rich-blocks path renders headings, lists, blockquotes and
 * tables as Telegram blocks. Fusion wants the native rendering by default
 * (`packages/channels/telegram/DEVIATIONS.md` D-003), so the default lives
 * here rather than in the vertical's `richMessages === true` read, which stays
 * byte-identical to upstream. An authored `false` still wins.
 */
const ACCOUNT_CONFIG_DEFAULTS: Record<string, Record<string, unknown>> = {
  telegram: { richMessages: true },
};

export function compileAccountConfig(
  file: string,
  channel: string,
  authored: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const config = authored ?? {};
  const schema = ACCOUNT_CONFIG_SCHEMAS[channel];
  if (schema !== undefined) {
    const result = schema.safeParse(config);
    if (!result.success) {
      const [first] = result.error.issues;
      issue(
        [file, "config", ...(first?.path ?? []).map(String)],
        first?.message ?? "invalid account configuration",
      );
    }
  }
  return withAccountConfigDefaults(channel, config);
}

/** Fill the channel's absent Fusion defaults; authored keys are untouched. */
function withAccountConfigDefaults(
  channel: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const defaults = ACCOUNT_CONFIG_DEFAULTS[channel];
  if (defaults === undefined) return config;
  const absent = Object.entries(defaults).filter(([key]) => !Object.hasOwn(config, key));
  return absent.length === 0 ? config : { ...config, ...Object.fromEntries(absent) };
}
