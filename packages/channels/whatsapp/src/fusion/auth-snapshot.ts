// Fusion-owned storage format of the linked-device auth directory (D-WA-010):
// how `fusion/auth-fs.ts`'s in-memory directory becomes keyed-store entries.
//
// The Hub caps one stored value at 64KB (`state/keyed-store.ts`) and a freshly
// paired device alone holds ~800 pre-keys, so the snapshot is split into parts
// written under a new generation, and the header entry (`auth-dir`) is switched
// to that generation last. A persist that dies midway leaves the previous header
// and its parts intact, so creds and keys always read back as one consistent
// set; superseded parts are deleted after the switch, and parts a crash left
// behind are swept on the next bind.
//
// Cost. The Hub's encrypted backing rewrites the whole namespace per upsert and
// coalesces the mutations made before its queued upsert starts
// (`state/secret-backend.ts`). The parts are therefore registered together, then
// the header, then the deletes: three upserts per persist, whatever the number
// of parts. Parts are sized by their encoded bytes, close to the cap, so a big
// account needs few of them.
import { randomUUID } from "node:crypto";
import type { HostKeyedStore } from "@clisbot/channels-shared";

export type AuthFile = { content: string; mtimeMs: number };
export type StoredAuthDir = { files: Record<string, AuthFile> };
/** The header: which generation's parts make up the snapshot. */
export type AuthDirHeader = { generation: string; parts: number };
type AuthDirPart = { part: string };
/** `StoredAuthDir` is the pre-chunking single entry, still read on bind. */
export type StoredAuthEntry = AuthDirHeader | AuthDirPart | StoredAuthDir;
export type AuthStore = HostKeyedStore<StoredAuthEntry>;

const HEADER_KEY = "auth-dir";
const PART_PREFIX = `${HEADER_KEY}@`;
/** Encoded bytes per part: under the Hub's 64KB value cap, with headroom. */
const PART_BYTES = 60_000;
/** Parts of two generations plus the header: room for ~30MB of auth state. */
export const WHATSAPP_AUTH_MAX_ENTRIES = 1_024;

function partKey(generation: string, index: number): string {
  return `${PART_PREFIX}${generation}#${index}`;
}

/** The size the keyed store checks: the stored value, JSON-encoded. */
function encodedBytes(part: string): number {
  return Buffer.byteLength(JSON.stringify({ part }), "utf8");
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Splits the snapshot into parts of at most `maxBytes` encoded, never inside a surrogate pair. */
export function splitAuthSnapshot(text: string, maxBytes = PART_BYTES): string[] {
  if (maxBytes < 64) throw new RangeError("an auth snapshot part needs at least 64 bytes");
  const parts: string[] = [];
  let start = 0;
  do {
    // One UTF-16 unit encodes to at least one byte, so this is an upper bound.
    let end = Math.min(text.length, start + maxBytes);
    let bytes = encodedBytes(text.slice(start, end));
    while (bytes > maxBytes) {
      end = start + Math.max(1, Math.floor(((end - start) * maxBytes * 0.97) / bytes));
      bytes = encodedBytes(text.slice(start, end));
    }
    if (end < text.length && end - start > 1 && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
    parts.push(text.slice(start, end));
    start = end;
  } while (start < text.length);
  return parts;
}

/**
 * Reads the stored snapshot: the header's parts, or the pre-chunking entry. A
 * header whose parts are missing or unreadable reads as no login at all: the
 * account then asks for a QR scan, which is the only recovery there is, instead
 * of failing every QR verb on the same broken snapshot.
 */
export async function loadAuthSnapshot(
  store: AuthStore,
): Promise<{ files: Record<string, AuthFile>; header?: AuthDirHeader }> {
  const head = await store.lookup(HEADER_KEY);
  if (head === undefined) return { files: {} };
  if ("files" in head) return { files: head.files };
  if (!("generation" in head)) return { files: {} };
  const parts: string[] = [];
  for (let index = 0; index < head.parts; index += 1) {
    const part = await store.lookup(partKey(head.generation, index));
    if (part === undefined || !("part" in part)) return { files: {} };
    parts.push(part.part);
  }
  try {
    return { files: (JSON.parse(parts.join("")) as StoredAuthDir).files, header: head };
  } catch {
    return { files: {} };
  }
}

/** Deletes the parts no header points at. */
export async function sweepStaleAuthParts(store: AuthStore, header?: AuthDirHeader): Promise<void> {
  const live = header ? `${PART_PREFIX}${header.generation}#` : undefined;
  const stale = (await store.entries())
    .map(({ key }) => key)
    .filter((key) => key.startsWith(PART_PREFIX) && (live === undefined || !key.startsWith(live)));
  await Promise.all(stale.map((key) => store.delete(key)));
}

/** Writes a new generation's parts, switches the header to it, drops the previous one. */
export async function saveAuthSnapshot(
  store: AuthStore,
  previous: AuthDirHeader | undefined,
  snapshot: StoredAuthDir,
): Promise<AuthDirHeader> {
  const generation = randomUUID();
  const parts = splitAuthSnapshot(JSON.stringify(snapshot));
  if (parts.length + (previous?.parts ?? 0) + 1 > WHATSAPP_AUTH_MAX_ENTRIES) {
    throw new Error(`WhatsApp auth state is too large to store (${parts.length} parts of ~60KB)`);
  }
  try {
    // Registered in one tick: the Hub writes them as one upsert.
    await Promise.all(parts.map((part, index) => store.register(partKey(generation, index), { part })));
  } catch (error) {
    // The header still names the previous generation; drop what was written.
    await sweepStaleAuthParts(store, previous).catch(() => undefined);
    throw error;
  }
  const header = { generation, parts: parts.length };
  await store.register(HEADER_KEY, header);
  // The new generation is durable from here: a failed cleanup is swept on the next bind.
  const superseded = Array.from({ length: previous?.parts ?? 0 }, (_, index) =>
    partKey(previous!.generation, index),
  );
  await Promise.all(superseded.map((key) => store.delete(key))).catch(() => undefined);
  return header;
}
