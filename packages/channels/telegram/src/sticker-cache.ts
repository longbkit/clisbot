// upstream: extensions/telegram/src/sticker-cache.ts@5d8067a4483
// D-TG-030: sticker *vision* is a Fusion boundary. Upstream's
// `describeStickerImage` selects a vision-capable provider/model through
// `openclaw/plugin-sdk/agent-runtime` (prepared model catalog, per-agent
// directories, provider API-key resolution) and `openclaw/plugin-sdk/media-runtime`,
// then calls `getTelegramRuntime().mediaUnderstanding.describeImageFileWithModel`.
// None of that graph exists in Fusion: the Hub owns agents, models and provider
// credentials, and the `HostRuntime` a vertical is given has no media-understanding
// surface. The selection is a slice-21 (media) boundary, so this module keeps
// upstream's signature and reports "no vision provider available" instead of
// pretending to describe. It never throws: upstream's contract for an
// unavailable provider is `null`, and the inbound path treats that as "cache the
// sticker without a description".
//
// The sticker *cache* itself — `searchStickers`, `getCacheStats`, `cacheSticker`
// and the store — is carried verbatim from `./sticker-cache-store.js`, which is
// what the `sticker-search` message action reads.
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { logVerbose } from "@getpaseo/channels-core/plugin-sdk/runtime-env";
export {
  cacheSticker,
  getAllCachedStickers,
  getCachedSticker,
  getCacheStats,
  searchStickers,
  type CachedSticker,
} from "./sticker-cache-store.js";

export interface DescribeStickerParams {
  imagePath: string;
  cfg: OpenClawConfig;
  agentDir?: string;
  agentId?: string;
}

/**
 * Describe a sticker image using vision API.
 *
 * Fusion has no vision provider at this boundary yet (see the module note), so
 * this reports unavailable the way upstream does when no provider is configured.
 */
export async function describeStickerImage(params: DescribeStickerParams): Promise<string | null> {
  void params;
  logVerbose("telegram: no vision provider available for sticker description");
  return null;
}
