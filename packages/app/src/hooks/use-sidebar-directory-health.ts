import { useDirectoryHealth } from "./use-directory-health";
import { useSidebarHostIds } from "./use-sidebar-host-ids";

export function useSidebarDirectoryHealth() {
  return useDirectoryHealth(useSidebarHostIds(), "workspaces");
}
