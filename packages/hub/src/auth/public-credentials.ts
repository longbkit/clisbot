import { CLI_CREDENTIAL_PREFIX, OrganizationCliCredentials } from "./cli-credentials.js";
import type { OrganizationApiKeys } from "./api-keys.js";
import type { OperationAuthenticator } from "./operation-auth.js";

export class PublicCredentialAuthenticator implements OperationAuthenticator {
  constructor(
    private readonly apiKeys: OrganizationApiKeys,
    private readonly cliCredentials: OrganizationCliCredentials,
  ) {}

  authorize(request: Request, requiredScope: Parameters<OperationAuthenticator["authorize"]>[1]) {
    const authorization = request.headers.get("authorization");
    return authorization?.startsWith(`Bearer ${CLI_CREDENTIAL_PREFIX}`)
      ? this.cliCredentials.authorize(request, requiredScope)
      : this.apiKeys.authorize(request, requiredScope);
  }
}
