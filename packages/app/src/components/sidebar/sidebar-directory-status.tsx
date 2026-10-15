import { DirectoryStatus } from "@/components/directory-status";
import { useDirectoryHealth } from "@/hooks/use-directory-health";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";

export function SidebarDirectoryStatus() {
  const filters = useSidebarViewStore((state) => state.hostFilters);
  const health = useDirectoryHealth(filters.length ? filters : undefined);
  return <DirectoryStatus health={health} label="Conversations" />;
}
