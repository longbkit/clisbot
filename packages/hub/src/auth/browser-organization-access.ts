import type { AccountAccessValue, OrganizationAccessValue } from "./organization-access.js";

export interface BrowserOrganizationAccess {
  deviceId?(request: Request): Promise<string | undefined>;
  resolveOrganizationAccess(request: Request): Promise<OrganizationAccessValue>;
  resolveAccount(request: Request): Promise<AccountAccessValue>;
  rejectCookieMutation(request: Request): Response | undefined;
}
