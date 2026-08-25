import type { ApiKeyScope } from "./api-key-contract.js";
import type { OperationAuthorizationResult } from "./api-keys.js";

export interface OperationAuthenticator {
  authorize(request: Request, requiredScope: ApiKeyScope): Promise<OperationAuthorizationResult>;
}
