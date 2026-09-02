import type { DatabaseRuntime } from "../db/runtime/index.js";
import { RuntimeConfigurationStore } from "./internal/store.js";
import type { CredentialCipher } from "../credentials/credential-cipher.js";

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
  credentialCipher: CredentialCipher;
}): RuntimeConfiguration {
  const store = new RuntimeConfigurationStore(options.database, options.credentialCipher);
  return {
    authSecret: async () => {
      const override = nonEmpty(options.environment.authSecret);
      // Always resolve the encrypted database value, even when an advanced
      // deployment overrides the effective auth secret. This row is the
      // startup key-check sentinel: a wrong master key must not be masked by
      // an unrelated auth override.
      const stored = await store.resolveAuthSecret(() => encodeSecret(options.randomBytes(32)));
      return override ?? stored;
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
