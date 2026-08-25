import type { ConfigRef, CompiledConfiguration } from "./schema.js";
export type { ConfigRef } from "./schema.js";

export interface ResolveHubConfig {
  resolve(ref?: ConfigRef): Promise<ResolvedHubConfig>;
}

export interface ResolvedHubConfig {
  ref: ConfigRef;
  config: CompiledConfiguration;
  repoFullName: string | null;
}

export interface ConfigStrategy {
  type: ConfigRef["type"];
  resolve(ref: ConfigRef): Promise<ResolvedHubConfig>;
}

interface ResolverOptions {
  strategies: ConfigStrategy[];
  now?: () => number;
  ttlMs?: number;
}

interface CacheEntry {
  cachedAt: number;
  resolved: ResolvedHubConfig;
}

const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;

export class ConfigRefMissing extends Error {
  constructor() {
    super("config ref is required");
    this.name = "ConfigRefMissing";
  }
}

export class ConfigRefUnsupported extends Error {
  constructor(type: string) {
    super(`unsupported config ref type: ${type}`);
    this.name = "ConfigRefUnsupported";
  }
}

export class ConfigNotFound extends Error {
  constructor(location: string) {
    super(`hub config not found: ${location}`);
    this.name = "ConfigNotFound";
  }
}

export class ConfigInvalid extends Error {
  constructor(location: string, cause: unknown) {
    super(`hub config is invalid: ${location}`, { cause });
    this.name = "ConfigInvalid";
  }
}

export class ConfigUnauthorized extends Error {
  constructor(location: string) {
    super(`hub config is unauthorized: ${location}`);
    this.name = "ConfigUnauthorized";
  }
}

export function createHubConfigResolver(options: ResolverOptions): ResolveHubConfig {
  const strategyByType = new Map(options.strategies.map((strategy) => [strategy.type, strategy]));
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? CONFIG_CACHE_TTL_MS;
  const configCache = new Map<string, CacheEntry>();

  return {
    async resolve(ref) {
      assertConfigRef(ref);

      const cacheKey = createCacheKey(ref);
      const cachedEntry = configCache.get(cacheKey);

      if (cachedEntry !== undefined && cachedEntry.cachedAt + ttlMs > now()) {
        return cachedEntry.resolved;
      }

      const strategy = strategyByType.get(ref.type);

      if (strategy === undefined) {
        throw new ConfigRefUnsupported(ref.type);
      }

      const resolved = await strategy.resolve(ref);
      configCache.set(cacheKey, {
        cachedAt: now(),
        resolved,
      });

      return resolved;
    },
  };
}

function assertConfigRef(ref: ConfigRef | undefined): asserts ref is ConfigRef {
  if (ref === undefined) {
    throw new ConfigRefMissing();
  }
}

function createCacheKey(ref: ConfigRef): string {
  switch (ref.type) {
    case "github":
      return `github:${ref.repo}`;
    case "local":
      return `local:${ref.path}`;
  }

  throw new Error("unreachable config ref type");
}
