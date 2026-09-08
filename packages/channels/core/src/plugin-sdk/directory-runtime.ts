// Fusion-owned boundary for `src/plugin-sdk/directory-runtime.ts` (D-CORE-251).
//
// Upstream's barrel is the channel directory adapter surface (live adapters,
// config-derived listers, read-only account inspection). Fusion's Hub owns the
// conversation directory, so only `resolveDirectoryAllowlistEntries` — declared
// in the barrel itself and carried verbatim — is kept for the ported Slack
// channel/user resolvers.

// Resolves id and provider-specific allowlist entries against one directory snapshot.
export function resolveDirectoryAllowlistEntries<
  TParsed extends { id?: string },
  TLookup,
  TResult,
>(params: {
  entries: readonly string[];
  lookup: readonly TLookup[];
  parseInput: (input: string) => TParsed;
  findById: (lookup: readonly TLookup[], id: string) => TLookup | undefined;
  buildIdResolved: (params: { input: string; parsed: TParsed; match?: TLookup }) => TResult;
  resolveNonId: (params: {
    input: string;
    parsed: TParsed;
    lookup: readonly TLookup[];
  }) => TResult | undefined;
  buildUnresolved: (input: string) => TResult;
}): TResult[] {
  return params.entries.map((input) => {
    const parsed = params.parseInput(input);
    if (parsed.id) {
      return params.buildIdResolved({
        input,
        parsed,
        match: params.findById(params.lookup, parsed.id),
      });
    }
    return (
      params.resolveNonId({ input, parsed, lookup: params.lookup }) ?? params.buildUnresolved(input)
    );
  });
}

// Slice 13 additions (Discord vertical port): the ported Discord directory
// resolver types. `DirectoryConfigParams` is upstream's
// `src/channels/plugins/directory-types.ts` verbatim; `ChannelDirectoryEntry`
// is declared in upstream's `src/channels/plugins/types.core.ts`, whose Fusion
// boundary is `types.public.host-adapter.ts` (D-CORE-010).
export type { DirectoryConfigParams } from "../channels/plugins/directory-types.js";
export type {
  ChannelDirectoryEntry,
  ChannelDirectoryEntryKind,
} from "../channels/plugins/types.public.host-adapter.js";

// Slice 15 additions (Feishu vertical port): the ported static directory builds
// user/group entries out of the account's allowlists and group map. Same
// upstream barrel, same source module
// (`src/channels/plugins/directory-config-helpers.ts`).
export {
  applyDirectoryQueryAndLimit,
  listDirectoryGroupEntriesFromMapKeysAndAllowFrom,
  listDirectoryUserEntriesFromAllowFrom,
  listDirectoryUserEntriesFromAllowFromAndMapKeys,
} from "../channels/plugins/directory-config-helpers.js";
