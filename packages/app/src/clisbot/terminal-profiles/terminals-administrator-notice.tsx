import { Alert } from "@/components/ui/alert";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { canManageTerminalProfiles } from "./launchable";

/**
 * Settings › Terminals for someone who is not the Host's Administrator. The daemon
 * refuses them its config, so the page would otherwise read as "no profiles" and
 * show the hooks switch off whatever the Host has.
 */
export function useCanManageHostTerminals(serverId: string): boolean {
  return canManageTerminalProfiles(
    useSessionStore((state) => state.sessions[serverId]?.serverInfo?.permissions),
  );
}

export function TerminalsAdministratorNotice() {
  return (
    <SettingsSection title="Terminals">
      <Alert
        variant="info"
        title="Only a Host Administrator can change these"
        description="Terminal agent hooks and Terminal profiles are Host settings."
      />
    </SettingsSection>
  );
}
