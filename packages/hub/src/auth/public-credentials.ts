import { hasCliCredential, OrganizationCliCredentials } from "./cli-credentials.js";
import type { OrganizationApiKeys } from "./api-keys.js";
import type { OperationAuthenticator } from "./operation-auth.js";

export class PublicCredentialAuthenticator implements OperationAuthenticator {
  constructor(
    private readonly apiKeys: OrganizationApiKeys,
    private readonly cliCredentials: OrganizationCliCredentials,
  ) {}

  authorize(request: Request, requiredScope: Parameters<OperationAuthenticator["authorize"]>[1]) {
    return hasCliCredential(request.headers.get("authorization"))
      ? this.cliCredentials.authorize(request, requiredScope)
      : this.apiKeys.authorize(request, requiredScope);
  }
}
