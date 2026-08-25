import type { DatabaseRuntime, QueryRow } from "../../db/runtime/index.js";

interface StoredSecretRow extends QueryRow {
  auth_secret: string;
}

/** @package */
export class RuntimeConfigurationStore {
  constructor(private readonly database: DatabaseRuntime) {}

  async resolveAuthSecret(generate: () => string): Promise<string> {
    const result = await this.database.query<StoredSecretRow>(
      `insert into runtime_configuration (singleton, auth_secret)
       values (true, $1)
       on conflict (singleton) do update
       set auth_secret = runtime_configuration.auth_secret
       returning auth_secret`,
      [generate()],
    );
    const stored = result.rows[0]?.auth_secret;
    if (stored === undefined) throw new Error("runtime auth secret resolution returned no value");
    return stored;
  }
}
