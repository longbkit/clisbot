import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";

/** The host's "give agents Clisbot tools" switch, bound to the host's config. */
export function ClisbotToolsCard({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({ mcp: { injectIntoAgents: next } });
    },
    [patchConfig],
  );

  if (!isConnected) return null;

  return (
    <SettingsCard testID="host-page-inject-mcp-card">
      <ClisbotToolsRow
        value={config?.mcp.injectIntoAgents !== false}
        onValueChange={handleValueChange}
      />
    </SettingsCard>
  );
}

/** The Clisbot tools row on its own, for a caller that decides what the switch is bound to. */
export function ClisbotToolsRow({
  value,
  onValueChange,
  disabled,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <SettingsRow
      label={t("settings.host.orchestration.enableTools.title")}
      hint={t("settings.host.orchestration.enableTools.hint")}
    >
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={t("settings.host.orchestration.enableTools.accessibilityLabel")}
      />
    </SettingsRow>
  );
}
