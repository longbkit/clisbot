// COMPAT(hub-channel-revision-keys): added in Hub 0.7.3, remove after 2026-11-30.
// Revisions saved before then keyed their files under a product directory
// (`.paseo/` before the 2026-09-29 rebrand, `.clisbot/` after it). The Hub runs
// this at boot, before anything reads a revision, and rewrites every stored
// revision to the database-only keys in `bundle-contract.ts`. Revisions are
// rewritten in place, as `one-time/migrate-channel-routes-once.ts` does, so the
// history stays readable and the active revision keeps its id.

import type { HubBundleFile } from "../../config/bundle-contract.js";
import type { DatabaseRuntime } from "../../db/runtime/index.js";
import { canonicalChannelRevision } from "./revision-files.js";

const LEGACY_KEY_PREFIXES = [".paseo/", ".clisbot/"] as const;

interface StoredRevision {
  [column: string]: unknown;
  id: string;
  files: HubBundleFile[];
}

/** Returns how many revisions were rewritten. A revision changed by another
 * writer between the read and the write is left as that writer stored it. */
export async function rekeyLegacyChannelRevisions(database: DatabaseRuntime): Promise<number> {
  const stored = await database.query<StoredRevision>(
    `select id, files from channel_configuration_revisions
     where exists (
       select 1 from jsonb_array_elements(files) as file
       where file->>'path' like '.paseo/%' or file->>'path' like '.clisbot/%'
     )`,
  );
  let rekeyed = 0;
  for (const revision of stored.rows) {
    const { files, contentHash } = canonicalChannelRevision(
      revision.files.map(({ path, content }) => ({ path: currentKey(path), content })),
    );
    const updated = await database.query(
      `update channel_configuration_revisions set files = $1::jsonb, content_hash = $2
       where id = $3 and files = $4::jsonb`,
      [JSON.stringify(files), contentHash, revision.id, JSON.stringify(revision.files)],
    );
    rekeyed += updated.rowCount;
  }
  return rekeyed;
}

function currentKey(path: string): string {
  const prefix = LEGACY_KEY_PREFIXES.find((candidate) => path.startsWith(candidate));
  return prefix === undefined ? path : path.slice(prefix.length);
}
