import { randomUUID } from "node:crypto";
import {
  createAuthorityState,
  assertAuthorityState,
  type DeviceAuthorityState,
  type DeviceAuthorityStore,
} from "@clisbot/device-access/authority";
import type { DatabaseRuntime, QueryRow } from "../db/runtime/index.js";

interface AuthorityRow extends QueryRow {
  state: DeviceAuthorityState;
}

export class HubDeviceAuthorityStore implements DeviceAuthorityStore {
  constructor(
    private readonly database: DatabaseRuntime,
    private readonly initialLoginRequired = true,
  ) {}

  async transaction<T>(action: (state: DeviceAuthorityState) => T): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const initial = createAuthorityState(randomUUID());
      initial.loginRequired = this.initialLoginRequired;
      await transaction.query(
        `insert into device_authority (singleton, state) values (true, $1::jsonb)
        on conflict (singleton) do nothing`,
        [JSON.stringify(initial)],
      );
      const result = await transaction.query<AuthorityRow>(
        `select state from device_authority where singleton = true for update`,
      );
      const state = result.rows[0]?.state;
      assertAuthorityState(state);
      const before = JSON.stringify(state);
      const value = action(state);
      const after = JSON.stringify(state);
      if (after !== before)
        await transaction.query(
          `update device_authority set state = $1::jsonb where singleton = true`,
          [after],
        );
      return value;
    });
  }
}
