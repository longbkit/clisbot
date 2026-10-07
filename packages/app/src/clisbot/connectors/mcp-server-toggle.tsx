import { useCallback, useState } from "react";
import type { ConnectorMcpServer } from "@clisbot/protocol/connectors/types";
import { SettingsSwitch } from "@/components/settings";
import { saveMcpServer } from "./data";
import { toErrorMessage } from "@/utils/error-messages";

/**
 * Turns one MCP server off for every agent on this Host without forgetting it: its URL or
 * command, headers and the Projects' grants stay, and on brings it all back.
 */
export function McpServerToggle({
  serverId,
  server,
}: {
  serverId: string;
  server: ConnectorMcpServer;
}) {
  const [error, setError] = useState<string | null>(null);
  const toggle = useCallback(
    async (enabled: boolean) => {
      setError(null);
      try {
        await saveMcpServer(serverId, {
          previousName: server.name,
          server: {
            name: server.name,
            transport: server.transport,
            ...(server.url ? { url: server.url } : {}),
            ...(server.command ? { command: server.command, args: server.args ?? [] } : {}),
            enabled,
          },
        });
      } catch (cause) {
        setError(toErrorMessage(cause));
      }
    },
    [server, serverId],
  );
  const onValueChange = useCallback((value: boolean) => void toggle(value), [toggle]);
  return (
    <SettingsSwitch
      label="On everywhere"
      hint="Off keeps the server and each Project's tools; no agent can reach it until you turn it back on."
      value={server.enabled !== false}
      onValueChange={onValueChange}
      error={error ?? undefined}
    />
  );
}
