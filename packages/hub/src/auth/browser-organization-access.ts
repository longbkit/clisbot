import type { AccountAccessValue, OrganizationAccessValue } from "./organization-access.js";

export interface BrowserOrganizationAccess {
  resolveOrganizationAccess(request: Request): Promise<OrganizationAccessValue>;
  resolveAccount(request: Request): Promise<AccountAccessValue>;
  rejectCookieMutation(request: Request): Response | undefined;
}
