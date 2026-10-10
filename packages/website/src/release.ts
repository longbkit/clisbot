import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getWebsiteCacheContext } from "./cloudflare-cache";
import { getReleaseChannels } from "./latest-release";

export const getLatestRelease = createServerFn({ method: "GET" }).handler(async () => {
  return getReleaseChannels(
    getWebsiteCacheContext(),
    (env as { GITHUB_RELEASES_URL?: string }).GITHUB_RELEASES_URL,
  );
});
