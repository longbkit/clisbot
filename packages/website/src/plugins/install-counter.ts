import { PluginRegistryIdSchema } from "@clisbot/protocol/plugin-registry";
import { DAY_MS, DAYS_KEPT, readLegacyInstalls, utcDay, type InstallCounts } from "./installs";

interface CounterEnvironment {
  WEBSITE_CACHE?: KVNamespace;
}

const HOUR_MS = 60 * 60 * 1000;

export class PluginInstallCounter {
  private importing: Promise<void> | null = null;

  constructor(
    private state: DurableObjectState,
    private env: CounterEnvironment,
  ) {
    state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS totals (id TEXT PRIMARY KEY, legacy INTEGER NOT NULL DEFAULT 0, current INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS daily (id TEXT NOT NULL, day TEXT NOT NULL, legacy INTEGER NOT NULL DEFAULT 0, current INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (id, day));
      CREATE TABLE IF NOT EXISTS receipts (id TEXT NOT NULL, hash TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY (id, hash));
      CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
    `);
    state.storage.sql.exec("INSERT OR IGNORE INTO metadata VALUES ('createdAt', ?)", Date.now());
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/counts" && request.method === "GET") {
      const now = new Date();
      await this.refreshLegacy(now);
      return Response.json(this.counts(now));
    }
    if (path !== "/install" || request.method !== "POST")
      return new Response("Not found", { status: 404 });
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("id" in body) || !("hash" in body))
      return new Response("Invalid report", { status: 400 });
    const { id, hash } = body;
    if (
      !PluginRegistryIdSchema.safeParse(id).success ||
      typeof id !== "string" ||
      typeof hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(hash)
    )
      return new Response("Invalid report", { status: 400 });
    // Honor receipts written by the old Worker during the first cutover hour.
    const createdAt = this.metadata("createdAt");
    if (this.env.WEBSITE_CACHE && Date.now() - createdAt < HOUR_MS + 60_000) {
      const receipt = await this.env.WEBSITE_CACHE.get(`plugin-installs-client:${id}:${hash}`);
      if (receipt !== null) return new Response(null, { status: 204 });
    }
    this.record(id, hash, new Date());
    return new Response(null, { status: 204 });
  }

  private metadata(name: string): number {
    const rows = this.state.storage.sql
      .exec<{ value: number }>("SELECT value FROM metadata WHERE name = ?", name)
      .toArray();
    return rows[0]?.value ?? 0;
  }

  private refreshLegacy(now: Date): Promise<void> {
    if (this.importing) return this.importing;
    if (now.getTime() - this.metadata("legacyReadAt") < DAY_MS) return Promise.resolve();
    this.importing = readLegacyInstalls(this.env.WEBSITE_CACHE ?? null)
      .then((legacy) => {
        return this.state.storage.transactionSync(() => {
          const sql = this.state.storage.sql;
          for (const [id, counts] of Object.entries(legacy)) {
            if (!PluginRegistryIdSchema.safeParse(id).success) continue;
            const days = Object.entries(counts.daily).filter(
              ([day, count]) => day >= utcDay(now, DAYS_KEPT - 1) && count > 0,
            );
            if (counts.total === 0 && days.length === 0) continue;
            sql.exec(
              "INSERT INTO totals (id, legacy) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET legacy = MAX(legacy, excluded.legacy)",
              id,
              counts.total,
            );
            for (const [day, count] of days)
              sql.exec(
                "INSERT INTO daily (id, day, legacy) VALUES (?, ?, ?) ON CONFLICT (id, day) DO UPDATE SET legacy = MAX(legacy, excluded.legacy)",
                id,
                day,
                count,
              );
          }
          sql.exec(
            "INSERT INTO metadata VALUES ('legacyReadAt', ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value",
            now.getTime(),
          );
        });
      })
      .finally(() => {
        this.importing = null;
      });
    return this.importing;
  }

  private record(id: string, hash: string, now: Date): void {
    this.state.storage.transactionSync(() => {
      const sql = this.state.storage.sql;
      const receipts = sql
        .exec<{ expires: number }>(
          "SELECT expires FROM receipts WHERE id = ? AND hash = ?",
          id,
          hash,
        )
        .toArray();
      if (receipts.length && receipts[0].expires > now.getTime()) return;
      sql.exec(
        "INSERT INTO receipts VALUES (?, ?, ?) ON CONFLICT (id, hash) DO UPDATE SET expires = excluded.expires",
        id,
        hash,
        now.getTime() + HOUR_MS,
      );
      sql.exec(
        "INSERT INTO totals (id, current) VALUES (?, 1) ON CONFLICT (id) DO UPDATE SET current = current + 1",
        id,
      );
      sql.exec(
        "INSERT INTO daily (id, day, current) VALUES (?, ?, 1) ON CONFLICT (id, day) DO UPDATE SET current = current + 1",
        id,
        utcDay(now, 0),
      );
      if (now.getTime() - this.metadata("cleanedAt") >= HOUR_MS) {
        sql.exec("DELETE FROM receipts WHERE expires <= ?", now.getTime());
        sql.exec("DELETE FROM daily WHERE day < ?", utcDay(now, DAYS_KEPT - 1));
        sql.exec(
          "INSERT INTO metadata VALUES ('cleanedAt', ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value",
          now.getTime(),
        );
      }
    });
  }

  private counts(now: Date): Record<string, InstallCounts> {
    const rows = this.state.storage.sql
      .exec<{ id: string; week: number; month: number; total: number }>(
        `
      SELECT t.id, t.legacy + t.current AS total,
        COALESCE(SUM(CASE WHEN d.day >= ? AND d.day <= ? THEN d.legacy + d.current ELSE 0 END), 0) AS week,
        COALESCE(SUM(CASE WHEN d.day >= ? AND d.day <= ? THEN d.legacy + d.current ELSE 0 END), 0) AS month
      FROM totals t LEFT JOIN daily d ON t.id = d.id AND d.day >= ?
      GROUP BY t.id
    `,
        utcDay(now, 6),
        utcDay(now, 0),
        utcDay(now, 29),
        utcDay(now, 0),
        utcDay(now, 29),
      )
      .toArray();
    return Object.fromEntries(
      rows.map((row) => [row.id, { week: row.week, month: row.month, all: row.total }]),
    );
  }
}
