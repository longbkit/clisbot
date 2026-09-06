import { expect, it } from "vitest";
import { parseServerInfoStatusPayload } from "@getpaseo/protocol/messages";
import { toSessionServerInfo } from "./session-server-info";

it("keeps wire session authority through the shared handshake replay/live projection", () => {
  for (const permissions of [undefined, [], ["workspace.read"], ["workspace.manage"]]) {
    const wire = parseServerInfoStatusPayload({
      status: "server_info",
      serverId: "host",
      permissions,
    });
    expect(wire).not.toBeNull();
    if (!wire) throw new Error("Invalid fixture");
    expect(toSessionServerInfo(wire)).toEqual({
      serverId: "host",
      hostname: null,
      version: null,
      ...(permissions === undefined ? {} : { permissions }),
    });
  }
});
