import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { Miniflare } from "miniflare";
import {
  addedAgo,
  featuredPlugins,
  formatInstalls,
  installCommand,
  mostInstalled,
  newestFirst,
  type Plugin,
  readmeBody,
  recentlyUpdated,
  reportBugUrl,
  searchPlugins,
  updatedAgo,
} from "./registry";
import {
  countInstalls,
  readInstallCounts,
  readCounterCounts,
  recordClientInstall,
  utcDay,
  DAY_MS,
} from "./installs";
import { handlePluginRegistryRequest, loadRegistryIndex, loadRegistryPlugin } from "./published";
const plugin: Plugin = {
  id: "acme/example",
  name: "Example",
  description: "An example",
  categories: ["themes"],
  author: { github: "acme" },
  repository: { url: "https://github.com/acme/example" },
  artifact: {
    kind: "npm",
    package: "clisbot-example",
    version: "1.2.3",
    resolved: "https://registry.npmjs.org/example.tgz",
    integrity: "sha512-YWJj",
  },
  media: [],
  submittedAt: "2026-10-03",
  reviewedAt: "2026-10-03",
  updatedAt: "2026-10-03",
  publishedAt: "2026-10-03",
  installs: 42,
};
describe("plugin registry", () => {
  it("loads a directory and a detail from a static HTTP registry", async () => {
    const index = {
      schemaVersion: 1,
      registry: { name: "Internal", url: "https://example.test" },
      categories: [],
      plugins: [plugin],
      featured: [plugin.id],
      generatedAt: "2026-10-03",
    };
    const detail = { ...plugin, readme: "# Example" };
    const server = createServer((request, response) => {
      const value = request.url === "/index.json" ? index : detail;
      response.end(JSON.stringify(value));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    const base = `http://127.0.0.1:${address.port}`;
    const context = { cache: null, waitUntil: () => undefined };
    try {
      expect(await loadRegistryIndex(base, context)).toEqual(index);
      expect(await loadRegistryPlugin(base, plugin.id, context)).toEqual(detail);
      await expect(loadRegistryPlugin(base, "acme/wrong", context)).rejects.toThrow("different ID");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("features listed plugins once each, in the registry's order, dropping IDs that are not listed", () => {
    const listed = [
      { ...plugin, id: "acme/first" },
      { ...plugin, id: "acme/second" },
      { ...plugin, id: "acme/third" },
    ];
    const featured = ["acme/third", "acme/not-published", "acme/first", "acme/third"];
    expect(featuredPlugins(listed, featured).map((p) => p.id)).toEqual([
      "acme/third",
      "acme/first",
    ]);
    expect(featuredPlugins(listed, ["acme/not-published"])).toEqual([]);
  });
  it("lists what's new by first listing time, so neither a slow review nor an update moves a plugin", () => {
    const listedFirst = {
      ...plugin,
      id: "acme/listed-first",
      submittedAt: "2026-09-30T00:00:00.000Z",
      publishedAt: "2026-09-30T06:00:00.000Z",
      reviewedAt: "2026-10-02T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z",
    };
    const listedLater = {
      ...plugin,
      id: "acme/listed-later",
      submittedAt: "2026-09-02T00:00:00.000Z",
      publishedAt: "2026-09-30T08:00:00.000Z",
      reviewedAt: "2026-09-30T08:00:00.000Z",
      updatedAt: "2026-09-30T08:00:00.000Z",
    };
    expect(newestFirst([listedFirst, listedLater]).map((p) => p.id)).toEqual([
      "acme/listed-later",
      "acme/listed-first",
    ]);
    const now = "2026-10-03T12:00:00.000Z";
    expect(addedAgo(listedLater, now)).toBe("3d ago");
    expect(updatedAgo(listedFirst, now)).toBe("yesterday");
  });
  it("lists only plugins updated after their first listing as recently updated, latest update first", () => {
    const bumped = {
      ...plugin,
      id: "acme/bumped",
      publishedAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-10-01T09:00:00.000Z",
    };
    const bumpedLater = {
      ...plugin,
      id: "acme/bumped-later",
      publishedAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-10-01T17:00:00.000Z",
    };
    const neverUpdated = {
      ...plugin,
      id: "acme/never-updated",
      publishedAt: "2026-10-02T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z",
    };
    expect(recentlyUpdated([bumped, neverUpdated, bumpedLater]).map((p) => p.id)).toEqual([
      "acme/bumped-later",
      "acme/bumped",
    ]);
  });
  it("orders by first listing time and by installs in a window, keeping index order for ties", () => {
    const older = { ...plugin, id: "acme/older", publishedAt: "2026-09-01" };
    const twin = { ...plugin, id: "acme/twin" };
    expect(newestFirst([older, plugin, twin]).map((p) => p.id)).toEqual([
      "acme/example",
      "acme/twin",
      "acme/older",
    ]);
    const installs = {
      "acme/example": { week: 1, month: 5, all: 9 },
      "acme/older": { week: 3, month: 3, all: 3 },
      "acme/twin": { week: 1, month: 1, all: 1 },
    };
    expect(mostInstalled([plugin, older, twin], installs, "week").map((p) => p.id)).toEqual([
      "acme/older",
      "acme/example",
      "acme/twin",
    ]);
    expect(mostInstalled([plugin, older, twin], installs, "month")[0].id).toBe("acme/example");
  });
  it("counts installs this week, this month, and all time from the daily record", async () => {
    const cache = memoryKv();
    const day = (date: string) => new Date(`${date}T12:00:00.000Z`);
    await cache.put("plugin-installs:acme/example", "44");
    await cache.put(
      "plugin-installs-daily:acme/example",
      JSON.stringify({
        "2026-09-10": 1,
        "2026-09-30": 1,
        "2026-10-04": 1,
      }),
    );
    expect(await readInstallCounts(cache, ["acme/example"], day("2026-10-04"))).toEqual({
      "acme/example": { week: 2, month: 3, all: 44 },
    });
  });
  it("counts repeated install reports from the same IP once per hour", async () => {
    const f = await counterFixture();
    const headers = { "X-Clisbot-Install": "1", "CF-Connecting-IP": "192.0.2.1" };
    await resolvePlugin(f.cache, headers, { counter: f.counter });
    await f.setTime(testNow + 3_599_000);
    await resolvePlugin(f.cache, headers, { counter: f.counter });
    expect(await readCounterCounts(f.counter)).toEqual({
      [plugin.id]: { week: 1, month: 1, all: 1 },
    });
    await f.setTime(testNow + 3_600_000);
    await resolvePlugin(f.cache, headers, { counter: f.counter });
    expect(await readCounterCounts(f.counter)).toEqual({
      [plugin.id]: { week: 2, month: 2, all: 2 },
    });
  });
  it("counts different IPs and plugins independently, including query install intent", async () => {
    const f = await counterFixture();
    const first = { "X-Clisbot-Install": "1", "CF-Connecting-IP": "192.0.2.1" };
    await resolvePlugin(f.cache, first, { counter: f.counter });
    await resolvePlugin(
      f.cache,
      { "CF-Connecting-IP": "2001:db8::1" },
      { query: "?intent=install", counter: f.counter },
    );
    await resolvePlugin(f.cache, first, { id: "acme/other", counter: f.counter });
    await resolvePlugin(f.cache, first, { query: "?intent=install", counter: f.counter });
    await resolvePlugin(f.cache, first, {
      id: "acme/other",
      staticDetail: true,
      counter: f.counter,
    });
    expect(await readCounterCounts(f.counter)).toEqual({
      [plugin.id]: { week: 2, month: 2, all: 2 },
      "acme/other": { week: 1, month: 1, all: 1 },
    });
    const receipts = await f.sql("SELECT id, hash FROM receipts ORDER BY id, hash");
    const hash = createHash("sha256").update(first["CF-Connecting-IP"]).digest("hex");
    expect(receipts).toContainEqual({ id: plugin.id, hash });
    expect(JSON.stringify(receipts)).not.toContain("192.0.2.1");
    expect(JSON.stringify(receipts)).not.toContain("2001:db8::1");
  });
  it("does not count without a Cloudflare IP or install intent", async () => {
    const f = await counterFixture();
    await resolvePlugin(
      f.cache,
      { "X-Clisbot-Install": "1", "X-Forwarded-For": "192.0.2.1" },
      { counter: f.counter },
    );
    await resolvePlugin(f.cache, {}, { query: "?intent=install", counter: f.counter });
    await resolvePlugin(
      f.cache,
      { "X-Clisbot-Install": "1", "CF-Connecting-IP": "" },
      { counter: f.counter },
    );
    await resolvePlugin(f.cache, { "CF-Connecting-IP": "192.0.2.1" }, { counter: f.counter });
    expect(await readCounterCounts(f.counter)).toEqual({});
  });
  it("preserves historical totals and the installs endpoint response", async () => {
    const f = await counterFixture();
    await f.cache.put(`plugin-installs:${plugin.id}`, "40");
    const headers = { "X-Clisbot-Install": "1", "CF-Connecting-IP": "192.0.2.1" };
    await resolvePlugin(f.cache, headers, { counter: f.counter });
    await resolvePlugin(f.cache, headers, { counter: f.counter });
    const base = "https://registry.example.test";
    await seedIndex(f.cache, base);
    const response = await handlePluginRegistryRequest(
      new Request("https://clisbot.com/api/plugins/installs"),
      { PLUGINS_REGISTRY_URL: base, PLUGIN_INSTALLS: f.counter },
      { cache: f.cache, waitUntil: () => undefined },
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ [plugin.id]: 41 });
    expect(await readCounterCounts(f.counter)).toEqual({
      [plugin.id]: { week: 1, month: 1, all: 41 },
    });
    expect(await f.cache.get(`plugin-installs:${plugin.id}`)).toBe("40");
  });
  it("uses two list operations and no missing-key reads for 223 zero-count plugins", async () => {
    const cache = memoryKv();
    const get = vi.spyOn(cache, "get");
    const list = vi.spyOn(cache, "list");
    const ids = Array.from({ length: 223 }, (_, i) => `acme/plugin-${i}`);
    const counts = await readInstallCounts(cache, ids, new Date(testNow));
    expect(counts).toEqual(
      Object.fromEntries(ids.map((id) => [id, { week: 0, month: 0, all: 0 }])),
    );
    expect(get).toHaveBeenCalledTimes(0);
    expect(list).toHaveBeenCalledTimes(2);
  });
  it("imports sparse legacy counters once daily and merges late old-Worker writes without overwriting new increments", async () => {
    const f = await counterFixture();
    await f.cache.put(`plugin-installs:${plugin.id}`, "40");
    await f.cache.put(
      `plugin-installs-daily:${plugin.id}`,
      JSON.stringify({ [utcDay(new Date(testNow), 1)]: 3 }),
    );
    expect(await readCounterCounts(f.counter)).toEqual({
      [plugin.id]: { week: 3, month: 3, all: 40 },
    });
    await f.setTime(testNow + 2 * 3_600_000);
    await f.resetOperations();
    await recordClientInstall({ counter: f.counter, id: plugin.id, ip: "192.0.2.1" });
    expect(await readCounterCounts(f.counter)).toEqual({
      [plugin.id]: { week: 4, month: 4, all: 41 },
    });
    expect(await f.operations()).toEqual({ get: 0, put: 0, list: 0 });
    await f.cache.put(`plugin-installs:${plugin.id}`, "42");
    await f.cache.put(
      `plugin-installs-daily:${plugin.id}`,
      JSON.stringify({ [utcDay(new Date(testNow), 1)]: 5 }),
    );
    await f.setTime(testNow + DAY_MS + 1);
    expect(await readCounterCounts(f.counter)).toEqual({
      [plugin.id]: { week: 6, month: 6, all: 43 },
    });
    expect(await f.operations()).toEqual({ get: 2, put: 0, list: 2 });
    expect(await readCounterCounts(f.counter)).toEqual({
      [plugin.id]: { week: 6, month: 6, all: 43 },
    });
    expect(await f.operations()).toEqual({ get: 2, put: 0, list: 2 });
  });
  it("keeps all simultaneous increments and deduplicates simultaneous reports across stubs", async () => {
    const f = await counterFixture();
    await readCounterCounts(f.counter);
    await f.setTime(testNow + 2 * 3_600_000);
    await f.resetOperations();
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        recordClientInstall({ counter: f.counter, id: plugin.id, ip: `192.0.2.${i}` }),
      ),
    );
    await Promise.all(
      Array.from({ length: 20 }, () =>
        recordClientInstall({ counter: f.counter, id: plugin.id, ip: "192.0.2.100" }),
      ),
    );
    expect(await readCounterCounts(f.counter)).toEqual({
      [plugin.id]: { week: 51, month: 51, all: 51 },
    });
    expect(await f.operations()).toEqual({ get: 0, put: 0, list: 0 });
  });
  it("rolls back the receipt and total together when the daily increment fails", async () => {
    const f = await counterFixture();
    await f.sql(
      "CREATE TRIGGER fail_daily BEFORE INSERT ON daily BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    );
    await expect(
      recordClientInstall({ counter: f.counter, id: plugin.id, ip: "192.0.2.1" }),
    ).rejects.toThrow();
    expect(await readCounterCounts(f.counter)).toEqual({});
    expect(await f.sql("SELECT * FROM receipts")).toEqual([]);
    await f.sql("DROP TRIGGER fail_daily");
    await recordClientInstall({ counter: f.counter, id: plugin.id, ip: "192.0.2.1" });
    expect(await readCounterCounts(f.counter)).toEqual({
      [plugin.id]: { week: 1, month: 1, all: 1 },
    });
  });
  it("honors pre-cutover KV receipts and leaves all legacy keys untouched", async () => {
    const f = await counterFixture();
    const ip = "192.0.2.1";
    const hash = createHash("sha256").update(ip).digest("hex");
    await f.cache.put(`plugin-installs-client:${plugin.id}:${hash}`, "1", { expirationTtl: 3600 });
    await recordClientInstall({ counter: f.counter, id: plugin.id, ip });
    expect(await readCounterCounts(f.counter)).toEqual({});
    await f.setTime(testNow + 3_660_001);
    await recordClientInstall({ counter: f.counter, id: plugin.id, ip });
    expect(await readCounterCounts(f.counter)).toEqual({
      [plugin.id]: { week: 1, month: 1, all: 1 },
    });
    expect(await f.cache.get(`plugin-installs-client:${plugin.id}:${hash}`)).toBe("1");
  });
  it("ages UTC windows while preserving all-time counts", () => {
    const now = new Date("2026-10-11T00:00:00Z");
    expect(
      countInstalls(
        {
          "2026-10-11": 1,
          "2026-10-05": 2,
          "2026-10-04": 3,
          "2026-09-12": 4,
          "2026-09-11": 5,
          "2026-10-12": 99,
        },
        100,
        now,
      ),
    ).toEqual({ week: 3, month: 10, all: 100 });
  });
  it("ages SQLite windows and survives a Worker restart without reimporting KV", async () => {
    const f = await counterFixture();
    await f.cache.put(`plugin-installs:${plugin.id}`, "100");
    await f.cache.put(
      `plugin-installs-daily:${plugin.id}`,
      JSON.stringify({
        "2026-10-11": 1,
        "2026-10-05": 2,
        "2026-10-04": 3,
        "2026-09-12": 4,
        "2026-09-11": 5,
      }),
    );
    expect(await readCounterCounts(f.counter)).toEqual({
      [plugin.id]: { week: 3, month: 10, all: 100 },
    });
    await f.setTime(testNow + DAY_MS);
    expect(await readCounterCounts(f.counter)).toEqual({
      [plugin.id]: { week: 1, month: 6, all: 100 },
    });
    const restarted = await f.restart();
    expect(await readCounterCounts(restarted)).toEqual({
      [plugin.id]: { week: 3, month: 10, all: 100 },
    });
    expect(await f.operations()).toEqual({ get: 0, put: 0, list: 0 });
  });
  it("paginates legacy keys and reads only counters that exist", async () => {
    const cache = memoryKv();
    for (let index = 0; index < 1001; index++)
      await cache.put(`plugin-installs:acme/plugin-${index}`, "1");
    const list = vi.spyOn(cache, "list");
    const get = vi.spyOn(cache, "get");
    expect(
      await readInstallCounts(cache, ["acme/plugin-1000", "acme/new"], new Date(testNow)),
    ).toEqual({
      "acme/plugin-1000": { week: 0, month: 0, all: 1 },
      "acme/new": { week: 0, month: 0, all: 0 },
    });
    expect(list).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenCalledTimes(1001);
  });
  it("keeps legacy counts readable when the Durable Object binding is disabled", async () => {
    const cache = memoryKv();
    const base = "https://registry.example.test";
    await cache.put(`plugin-installs:${plugin.id}`, "40");
    await seedIndex(cache, base);
    await resolvePlugin(cache, { "X-Clisbot-Install": "1", "CF-Connecting-IP": "192.0.2.1" });
    const response = await handlePluginRegistryRequest(
      new Request("https://clisbot.com/api/plugins/installs"),
      { PLUGINS_REGISTRY_URL: base },
      { cache, waitUntil: () => undefined },
    );
    expect(await response?.json()).toEqual({ [plugin.id]: 40 });
    expect(await cache.get(`plugin-installs:${plugin.id}`)).toBe("40");
  });

  it("searches name, description, ID, and author, ignoring case", () => {
    const other = {
      ...plugin,
      id: "zed/other",
      name: "Other",
      description: "Unrelated",
      author: { github: "zed" },
    };
    const plugins = [plugin, other];
    expect(searchPlugins(plugins, "EXAMPLE").map((p) => p.id)).toEqual(["acme/example"]);
    expect(searchPlugins(plugins, "unrelated").map((p) => p.id)).toEqual(["zed/other"]);
    expect(searchPlugins(plugins, "zed/").map((p) => p.id)).toEqual(["zed/other"]);
    expect(searchPlugins(plugins, "acme").map((p) => p.id)).toEqual(["acme/example"]);
    expect(searchPlugins(plugins, "  ")).toEqual(plugins);
    expect(searchPlugins(plugins, "nothing")).toEqual([]);
  });
  it("ranks name, then author, then description matches, keeping the given order on ties", () => {
    const named = (id: string, name: string, description: string, github = "acme"): Plugin => ({
      ...plugin,
      id,
      name,
      description,
      author: { github },
    });
    // Given in install order: description-only matches first, the exact name last.
    const plugins = [
      named("acme/editor", "Remote Editor", "Composer pill to open a workspace"),
      named("acme/kit", "PromptKit", "Rewrite prompts"),
      named("omp/tools", "Tools", "Helpers", "omp"),
      named("acme/history", "History", "Inspect raw composer records"),
      named("acme/omp", "OMP", "Clisbot integration for OMP"),
    ];
    expect(searchPlugins(plugins, "omp").map((p) => p.id)).toEqual([
      "acme/omp",
      "acme/kit",
      "omp/tools",
      "acme/editor",
      "acme/history",
    ]);
    expect(searchPlugins(plugins, "prompt").map((p) => p.id)).toEqual(["acme/kit"]);
    expect(searchPlugins(plugins, "tools omp").map((p) => p.id)).toEqual(["omp/tools"]);
  });

  it("strips the README title and quoted description that the page already shows", () => {
    expect(readmeBody("# Example\n\n> An example\n> plugin\n\n## Usage\n")).toBe("## Usage\n");
    expect(readmeBody("## Usage\n\n> Note\n")).toBe("## Usage\n\n> Note\n");
    expect(readmeBody("# Example\n\n> [!WARNING]\n> Needs Docker\n\n## Usage\n")).toBe(
      "> [!WARNING]\n> Needs Docker\n\n## Usage\n",
    );
  });
  it("offers a registry install command", () => {
    expect(installCommand(plugin)).toBe("clisbot plugin add acme/example");
    expect(formatInstalls(1250)).toBe("1.3k");
  });
  it("reports bugs on the source repository's GitHub issue tracker", () => {
    const at = (url: string) => reportBugUrl({ ...plugin, repository: { url } });
    expect(at("https://github.com/acme/example")).toBe(
      "https://github.com/acme/example/issues/new",
    );
    expect(at("https://github.com/acme/plugins.git")).toBe(
      "https://github.com/acme/plugins/issues/new",
    );
    expect(at("https://github.com/acme/plugins/tree/HEAD/packages/example")).toBe(
      "https://github.com/acme/plugins/issues/new",
    );
    expect(at("https://gitlab.com/acme/example")).toBeUndefined();
    expect(at("javascript:alert(1)")).toBeUndefined();
  });
});

/** In-memory stand-in for the website KV namespace, covering the calls the counter makes. */
function memoryKv(now = Date.now): KVNamespace & { values: Map<string, string> } {
  const values = new Map<string, string>();
  const expiresAt = new Map<string, number>();
  const kv = {
    values,
    get: async (key: string, options?: { type?: string }) => {
      if (now() >= (expiresAt.get(key) ?? Infinity)) values.delete(key);
      const value = values.get(key) ?? null;
      return options?.type === "json" && value !== null ? JSON.parse(value) : value;
    },
    list: async ({ prefix = "", cursor = "0", limit = 1000 } = {}) => {
      const keys = [...values.keys()].filter((key) => key.startsWith(prefix)).sort();
      const offset = Number(cursor);
      const page = keys.slice(offset, offset + limit).map((name) => ({ name }));
      return {
        keys: page,
        list_complete: offset + limit >= keys.length,
        cursor: String(offset + limit),
      };
    },
    put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
      values.set(key, value);
      expiresAt.set(key, options?.expirationTtl ? now() + options.expirationTtl * 1000 : Infinity);
    },
  };
  return kv as unknown as KVNamespace & { values: Map<string, string> };
}

async function resolvePlugin(
  cache: KVNamespace,
  headers: HeadersInit,
  {
    id = plugin.id,
    query = "",
    staticDetail = false,
    counter = undefined,
  }: { id?: string; query?: string; staticDetail?: boolean; counter?: DurableObjectNamespace } = {},
): Promise<void> {
  const base = "https://registry.example.test";
  const detail = { ...plugin, id, readme: "# Example" };
  await cache.put(
    `plugins:detail:v1:${base}:${id}`,
    JSON.stringify({ fetchedAt: Date.now(), value: detail }),
  );
  const pending: Promise<unknown>[] = [];
  const path = staticDetail ? `/plugins/${id}.json` : `/api/plugins/resolve/${id}`;
  const response = await handlePluginRegistryRequest(
    new Request(`https://clisbot.com${path}${query}`, { headers }),
    { PLUGINS_REGISTRY_URL: base, PLUGIN_INSTALLS: counter },
    { cache, waitUntil: (promise) => pending.push(promise) },
  );
  expect(response?.status).toBe(200);
  expect(await response?.json()).toEqual(detail);
  await Promise.all(pending);
}

async function seedIndex(cache: KVNamespace, base: string) {
  await cache.put(
    `plugins:index:v1:${base}`,
    JSON.stringify({
      fetchedAt: Date.now(),
      value: {
        schemaVersion: 1,
        registry: { name: "Internal", url: base },
        categories: [],
        plugins: [plugin],
        featured: [],
        generatedAt: "2026-10-03",
      },
    }),
  );
}

const testNow = Date.parse("2026-10-11T12:00:00Z");
let counterScript = "";
const runtimes: Miniflare[] = [];
beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    ssr: { noExternal: true },
    build: {
      ssr: true,
      write: false,
      rollupOptions: { input: fileURLToPath(new URL("./install-counter.ts", import.meta.url)) },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs
    .flatMap((output) => ("output" in output ? output.output : []))
    .find((output) => output.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("Missing counter bundle");
  counterScript =
    chunk.code +
    `
    let testNow = ${testNow};
    const RealDate = Date;
    globalThis.Date = class extends RealDate {
      constructor(value) { if (arguments.length) super(value); else super(testNow); }
      static now() { return testNow; }
    };
    let operations = { get: 0, put: 0, list: 0 };
    export class TestCounter extends PluginInstallCounter {
      constructor(ctx, env) {
        const cache = env.WEBSITE_CACHE;
        super(ctx, { ...env, WEBSITE_CACHE: {
          get(...args) { operations.get++; return cache.get(...args); },
          put(...args) { operations.put++; return cache.put(...args); },
          list(...args) { operations.list++; return cache.list(...args); },
        } });
        this.testState = ctx;
      }
      async fetch(request) {
        if (new URL(request.url).pathname === '/test/sql') {
          const { query } = await request.json();
          return Response.json(this.testState.storage.sql.exec(query).toArray());
        }
        return super.fetch(request);
      }
    }
    export default { fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === '/time') { testNow = Number(url.searchParams.get('ms')); return new Response(null, { status: 204 }); }
      if (url.pathname === '/ops') {
        if (url.searchParams.has('reset')) operations = { get: 0, put: 0, list: 0 };
        return Response.json(operations);
      }
      return env.PLUGIN_INSTALLS.get(env.PLUGIN_INSTALLS.idFromName('plugin-installs:v1')).fetch(request);
    } };
  `;
}, 30_000);
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

async function counterFixture() {
  const options = {
    modules: true,
    script: counterScript,
    compatibilityDate: "2024-12-01",
    kvNamespaces: ["WEBSITE_CACHE"],
    durableObjects: { PLUGIN_INSTALLS: { className: "TestCounter", useSQLite: true } },
  };
  const runtime = new Miniflare(options);
  runtimes.push(runtime);
  const { WEBSITE_CACHE, PLUGIN_INSTALLS } = await runtime.getBindings<{
    WEBSITE_CACHE: KVNamespace;
    PLUGIN_INSTALLS: DurableObjectNamespace;
  }>();
  return {
    cache: WEBSITE_CACHE,
    counter: PLUGIN_INSTALLS,
    setTime: (ms: number) => runtime.dispatchFetch(`http://test/time?ms=${ms}`),
    resetOperations: () => runtime.dispatchFetch("http://test/ops?reset=1"),
    operations: async () => (await runtime.dispatchFetch("http://test/ops")).json(),
    sql: async (query: string) =>
      (
        await runtime.dispatchFetch("http://test/test/sql", {
          method: "POST",
          body: JSON.stringify({ query }),
        })
      ).json(),
    restart: async () => {
      await runtime.setOptions({ ...options, compatibilityDate: "2024-12-02" });
      const bindings = await runtime.getBindings<{ PLUGIN_INSTALLS: DurableObjectNamespace }>();
      return bindings.PLUGIN_INSTALLS;
    },
  };
}
