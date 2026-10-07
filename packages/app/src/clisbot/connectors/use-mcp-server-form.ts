import { useCallback, useState } from "react";
import type { ConnectorMcpServer, ConnectorMcpTransport } from "@clisbot/protocol/connectors/types";
import { saveMcpServer, type McpServerSave } from "./data";
import { buildMcpServerSave, joinCommandLine } from "./mcp-server-form";
import { toErrorMessage } from "@/utils/error-messages";

export type McpServerForm = ReturnType<typeof useMcpServerForm>;

/** The MCP server sheet's fields and its save; the request is built by `buildMcpServerSave`. */
export function useMcpServerForm(
  serverId: string,
  editing: ConnectorMcpServer | null,
  onSaved: (name: string) => void,
) {
  const [name, setName] = useState(editing?.name ?? "");
  const [transport, setTransport] = useState<ConnectorMcpTransport>(
    editing?.transport === "stdio" ? "stdio" : "http",
  );
  const [url, setUrl] = useState(editing?.url ?? "");
  const [command, setCommand] = useState(
    editing?.command ? joinCommandLine([editing.command, ...(editing.args ?? [])]) : "",
  );
  const [secrets, setSecrets] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const request: McpServerSave = buildMcpServerSave({
        previousName: editing?.name,
        name,
        transport,
        url,
        command,
        secrets,
      });
      await saveMcpServer(serverId, request);
      onSaved(request.server.name);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }, [command, editing, name, onSaved, secrets, serverId, transport, url]);
  const save = useCallback(() => void run(), [run]);
  return {
    transport,
    command,
    saving,
    error,
    save,
    setName,
    setTransport,
    setUrl,
    setCommand,
    setSecrets,
  };
}
