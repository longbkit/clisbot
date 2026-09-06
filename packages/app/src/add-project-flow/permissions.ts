export const PROJECT_ACCESS_DENIED =
  "You do not have permission to add projects on this Host. Ask your administrator for access.";

export function canManageHostProjects(permissions: readonly string[] | undefined): boolean {
  // COMPAT(sessionPermissions): older daemons omit this projection; backend remains authoritative.
  return permissions === undefined || permissions.includes("workspace.manage");
}
