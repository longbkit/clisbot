import type { PairedHubTransport } from "./hub-transport";

export type HubDeviceAction =
  | { kind: "list" }
  | { kind: "rename"; deviceId: string; label: string }
  | { kind: "revoke"; deviceId: string };

export async function requestHubDevices(transport: PairedHubTransport, action: HubDeviceAction) {
  const path = `/api/auth/clisbot/device/devices${action.kind === "list" ? "" : `/${encodeURIComponent(action.deviceId)}`}`;
  const response = await transport.request(
    path,
    action.kind === "list"
      ? {}
      : {
          method: action.kind === "revoke" ? "DELETE" : "PATCH",
          ...(action.kind === "rename"
            ? {
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ label: action.label }),
              }
            : {}),
        },
  );
  if (!response.ok)
    throw new Error(`Hub device management requires operator access (${response.status})`);
  const list =
    action.kind === "list" ? response : await transport.request("/api/auth/clisbot/device/devices");
  if (!list.ok) throw new Error(`Hub device management requires operator access (${list.status})`);
  return await list.json();
}
