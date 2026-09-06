import { useCallback } from "react";
import { useAddProjectFlowStore } from "@/stores/add-project-flow-store";
import { useSessionStore } from "@/stores/session-store";
import { useToast } from "@/contexts/toast-api-context";
import { canManageHostProjects, PROJECT_ACCESS_DENIED } from "@/add-project-flow/permissions";

export function useOpenAddProject(): (preferredHostId?: string) => void {
  const open = useAddProjectFlowStore((state) => state.open);
  const toast = useToast();
  return useCallback(
    (preferredHostId?: string) => {
      const permissions = preferredHostId
        ? useSessionStore.getState().sessions[preferredHostId]?.serverInfo?.permissions
        : undefined;
      if (!canManageHostProjects(permissions)) {
        toast.error(PROJECT_ACCESS_DENIED);
        return;
      }
      open(preferredHostId);
    },
    [open, toast],
  );
}
