import { readFile } from "node:fs/promises";
import { load } from "js-yaml";
import { compileHubConfig } from "../compiler.js";
import type { ConfigStrategy, ResolvedHubConfig } from "../resolver.js";
import { ConfigInvalid, ConfigNotFound, ConfigRefUnsupported } from "../resolver.js";

export function createLocalConfigStrategy(): ConfigStrategy {
  return {
    type: "local",
    async resolve(ref): Promise<ResolvedHubConfig> {
      if (ref.type !== "local") {
        throw new ConfigRefUnsupported(ref.type);
      }

      try {
        const rawConfig = await readFile(ref.path, "utf8");
        const parsed = load(rawConfig);
        const config = compileHubConfig(parsed);

        return {
          ref,
          config,
          repoFullName: null,
        };
      } catch (error) {
        if (isNotFoundError(error)) {
          throw new ConfigNotFound(ref.path);
        }

        if (error instanceof Error) {
          throw new ConfigInvalid(ref.path, error);
        }

        throw error;
      }
    },
  };
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return error.code === "ENOENT";
}
