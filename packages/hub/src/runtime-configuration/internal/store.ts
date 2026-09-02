import type { DatabaseRuntime, QueryRow } from "../../db/runtime/index.js";
import type { CredentialCipher, CredentialEnvelope } from "../../credentials/credential-cipher.js";

interface StoredSecretRow extends QueryRow {
  auth_secret_envelope: CredentialEnvelope;
}

/** @package */
export class RuntimeConfigurationStore {
  constructor(
    private readonly database: DatabaseRuntime,
    private readonly credentialCipher: CredentialCipher,
  ) {}

  async resolveAuthSecret(generate: () => string): Promise<string> {
    const result = await this.database.query<StoredSecretRow>(
      `insert into runtime_configuration (singleton, auth_secret_envelope)
       values (true, $1)
       on conflict (singleton) do update
       set auth_secret_envelope = runtime_configuration.auth_secret_envelope
       returning auth_secret_envelope`,
      [
        JSON.stringify(
          this.credentialCipher.encrypt("runtime-configuration:auth-secret", generate()),
        ),
      ],
    );
    const envelope = result.rows[0]?.auth_secret_envelope;
    const decrypted =
      envelope === undefined
        ? undefined
        : this.credentialCipher.decrypt("runtime-configuration:auth-secret", envelope);
    if (typeof decrypted !== "string") {
      throw new Error("runtime auth secret resolution returned a malformed value");
    }
    return decrypted;
  }
}
