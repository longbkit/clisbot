import { DirectoryStatus } from "@/components/directory-status";
import { useSidebarDirectoryHealth } from "@/hooks/use-sidebar-directory-health";

export function SidebarDirectoryStatus() {
  const health = useSidebarDirectoryHealth();
  // The compact navigation row already provides the geometry. Healthy catalogs need no
  // second heading; refresh/error/recovery still use the shared status/action owner.
  return health.status === "ready" ? null : (
    <DirectoryStatus health={health} label="Conversations" inset={false} />
  );
}
