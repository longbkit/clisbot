import { DirectoryStatus } from "@/components/directory-status";
import { useSidebarDirectoryHealth } from "@/hooks/use-sidebar-directory-health";

export function SidebarDirectoryStatus() {
  const health = useSidebarDirectoryHealth();
  return <DirectoryStatus health={health} label="Conversations" />;
}
