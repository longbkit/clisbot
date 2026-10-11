import { env, waitUntil } from "cloudflare:workers";
import type { WebsiteCacheContext } from "./github-cache";

export function getWebsiteCacheContext(): WebsiteCacheContext {
  return {
    cache: (env as { WEBSITE_CACHE?: KVNamespace }).WEBSITE_CACHE ?? null,
    edgeCache: caches.open("website-data:v2"),
    waitUntil,
  };
}
