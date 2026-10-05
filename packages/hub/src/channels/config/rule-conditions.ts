// COMPAT(route-rule-conditions): added in Hub 0.7.3, remove after 2027-01-31.
// A Route used to carry `contains`, `interaction.requireMention` and
// `interaction.followUp`, shared by all its rules. They are each rule's own now
// (docs/audits/2026-10-05-routes-and-rules.md). The Hub runs this at boot,
// before anything reads a revision, and rewrites every stored revision so the
// Route's values sit on each of its rules: the same messages get in, through
// the same rules, as before. A rule that already authored a leaf keeps it.
//
// One exception, on purpose: on a Route that set `requireMention`, a rule that
// covers only DMs and authors none gets `false`, not the Route's value. The
// docs and the app always said a DM is answered without a mention, but the gate
// applied the Route's `true` to DMs too, so a plain DM was ignored; the app hid
// the switch on DM-only Routes and still wrote `true`. A Route that set nothing
// is not touched: its rules inherit the defaults, as a rule saved after this
// release does, so a revision saved later never changes on the next boot.
// A Route still in the shape before rules (`audience` not a list) is left for
// `one-time/route-shape.ts`, which runs this move on its output.
// Revisions are rewritten in place, as `rekey-revisions.ts` does, so the
// history stays readable and the active revision keeps its id.

import { dump, load } from "js-yaml";
import { CHANNELS_DIRECTORY, CHANNEL_POLICY_PATH } from "../../config/bundle-contract.js";
import type { HubBundleFile } from "../../config/bundle-contract.js";
import type { DatabaseRuntime } from "../../db/runtime/index.js";
import { canonicalChannelRevision } from "./revision-files.js";

type Unknowns = Record<string, unknown>;

/**
 * One account file with every Route's conditions moved onto its rules;
 * `undefined` when no Route carried any, so the file is left byte for byte.
 */
export function moveRouteConditionsToRules(content: string): string | undefined {
  const account: unknown = load(content);
  return moveAccountConditions(account) ? dump(account, { lineWidth: -1 }) : undefined;
}

/** The same move on a parsed account file, in place; true when it changed. */
export function moveAccountConditions(account: unknown): boolean {
  if (!isRecord(account) || !Array.isArray(account["routes"])) return false;
  let changed = false;
  for (const route of account["routes"]) {
    if (isRecord(route) && moveRouteConditions(route)) changed = true;
  }
  return changed;
}

/** True when a condition moved off the Route onto its rules. */
function moveRouteConditions(route: Unknowns): boolean {
  if (!Array.isArray(route["audience"])) return false;
  const interaction = isRecord(route["interaction"]) ? route["interaction"] : {};
  const { requireMention, followUp, ...kept } = interaction;
  const contains = route["contains"];
  if (requireMention === undefined && followUp === undefined && contains === undefined) {
    return false;
  }
  const rules = route["audience"].filter(isRecord);
  // Before the Route's `requireMention` lands on them, or it would decide them.
  if (requireMention !== undefined) answerDirectMessages(rules);
  for (const rule of rules) addRuleConditions(rule, { requireMention, followUp, contains });
  delete route["contains"];
  if (Object.keys(kept).length === 0) delete route["interaction"];
  else route["interaction"] = kept;
  return true;
}

/** DM-only rules that do not decide the mention themselves need none. */
function answerDirectMessages(rules: readonly Unknowns[]): void {
  for (const rule of rules) {
    const own = isRecord(rule["interaction"]) ? rule["interaction"] : {};
    if (own["requireMention"] !== undefined) continue;
    if (!coversOnlyDirectMessages(rule["where"])) continue;
    rule["interaction"] = { ...own, requireMention: false };
  }
}

function coversOnlyDirectMessages(where: unknown): boolean {
  if (!isRecord(where)) return false;
  const named = (key: string) => Array.isArray(where[key]) && (where[key] as unknown[]).length > 0;
  const dm =
    where["dm"] === true || named("dmMembers") || named("dmTeams") || named("dmIdentities");
  const groups = where["groups"] !== undefined && where["groups"] !== "off";
  return dm && !groups && !named("conversations");
}

/** The Route's leaves under the rule's own: a leaf the rule authored wins. */
function addRuleConditions(
  rule: Unknowns,
  route: { requireMention: unknown; followUp: unknown; contains: unknown },
): void {
  const own = isRecord(rule["interaction"]) ? rule["interaction"] : {};
  const interaction: Unknowns = { ...own };
  if (own["requireMention"] === undefined && route.requireMention !== undefined) {
    interaction["requireMention"] = route.requireMention;
  }
  if (isRecord(route.followUp)) {
    interaction["followUp"] = {
      ...route.followUp,
      ...(isRecord(own["followUp"]) ? own["followUp"] : {}),
    };
  }
  if (Object.keys(interaction).length > 0) rule["interaction"] = interaction;
  if (rule["contains"] === undefined && route.contains !== undefined) {
    rule["contains"] = route.contains;
  }
}

/** Every file of one revision, conditions moved; `undefined` when none moved. */
export function moveRevisionConditions(
  files: readonly HubBundleFile[],
): HubBundleFile[] | undefined {
  let changed = false;
  const next = files.map((file) => {
    if (!file.path.startsWith(`${CHANNELS_DIRECTORY}/`) || file.path === CHANNEL_POLICY_PATH) {
      return file;
    }
    const content = moveRouteConditionsToRules(file.content);
    if (content === undefined) return file;
    changed = true;
    return { path: file.path, content };
  });
  return changed ? next : undefined;
}

interface StoredRevision {
  [column: string]: unknown;
  id: string;
  files: HubBundleFile[];
}

/**
 * Returns how many revisions were rewritten and which could not be read. A
 * revision changed by another writer between the read and the write is left as
 * that writer stored it; one that does not parse is left as it is, so a broken
 * historical revision never stops the Hub from starting.
 */
export async function moveStoredRouteConditions(
  database: DatabaseRuntime,
): Promise<{ moved: number; unreadable: string[] }> {
  // Only revisions whose text names a moved key can need it.
  const stored = await database.query<StoredRevision>(
    `select id, files from channel_configuration_revisions
     where files::text like '%contains%' or files::text like '%requireMention%'
        or files::text like '%followUp%'`,
  );
  let moved = 0;
  const unreadable: string[] = [];
  for (const revision of stored.rows) {
    let next: HubBundleFile[] | undefined;
    try {
      next = moveRevisionConditions(revision.files);
    } catch {
      unreadable.push(revision.id);
      continue;
    }
    if (next === undefined) continue;
    moved += await writeRevision(database, revision, next);
  }
  return { moved, unreadable };
}

async function writeRevision(
  database: DatabaseRuntime,
  revision: StoredRevision,
  next: HubBundleFile[],
): Promise<number> {
  const { files, contentHash } = canonicalChannelRevision(next);
  const updated = await database.query(
    `update channel_configuration_revisions set files = $1::jsonb, content_hash = $2
     where id = $3 and files = $4::jsonb`,
    [JSON.stringify(files), contentHash, revision.id, JSON.stringify(revision.files)],
  );
  return updated.rowCount;
}

function isRecord(value: unknown): value is Unknowns {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
