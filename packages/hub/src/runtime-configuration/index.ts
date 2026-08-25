import type { DatabaseRuntime } from "../db/runtime/index.js";
import { RuntimeConfigurationStore } from "./internal/store.js";

export interface RuntimeConfiguration {
  authSecret(): Promise<string>;
  publicUrl(): Promise<string>;
}

interface RuntimeConfigurationEnvironment {
  authSecret?: string;
  appUrl?: string;
}

export function createRuntimeConfiguration(options: {
  database: DatabaseRuntime;
  environment: RuntimeConfigurationEnvironment;
  effectivePort: number;
  randomBytes(size: number): Uint8Array;
}): RuntimeConfiguration {
  const store = new RuntimeConfigurationStore(options.database);
  return {
    authSecret: () => {
      const override = nonEmpty(options.environment.authSecret);
      return override === undefined
        ? store.resolveAuthSecret(() => encodeSecret(options.randomBytes(32)))
        : Promise.resolve(override);
    },
    publicUrl: () =>
      Promise.resolve(
        new URL(
          options.environment.appUrl ?? `http://localhost:${options.effectivePort}`,
        ).toString(),
      ),
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function encodeSecret(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
