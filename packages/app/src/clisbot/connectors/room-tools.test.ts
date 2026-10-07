import { describe, expect, it } from "vitest";
import { roomOnCount, roomTools } from "./room-tools";

const defaults = { agentTools: true, browserTools: false };

function holderNames(entry: { key: string; holders: readonly { name: string }[] }) {
  return [entry.key, entry.holders.map((holder) => holder.name)];
}

describe("room tools", () => {
  it("lists what any Bot here has, with who has it", () => {
    const room = roomTools(
      [
        {
          name: "writer",
          grant: {
            apps: { gmail: { tools: "all", access: "write" } },
            agentTools: { disabledTools: ["create_terminal"] },
          },
        },
        { name: "researcher", grant: { apps: { notion: { tools: "all", access: "read" } } } },
      ],
      defaults,
    );
    const terminals = room.groups.find((entry) => entry.group.id === "terminals")!;
    expect(terminals.holders.get("create_terminal")).toEqual(["researcher"]);
    expect(terminals.holders.get("list_terminals")).toEqual(["writer", "researcher"]);
    expect(room.groups.some((entry) => entry.group.id === "browser")).toBe(false);
    expect(room.connectors.map(holderNames)).toEqual([
      ["gmail", ["writer"]],
      ["notion", ["researcher"]],
    ]);
  });

  it("counts what the room keeps on", () => {
    const room = roomTools(
      [{ name: "writer", grant: { apps: { gmail: { tools: "all", access: "read" } } } }],
      defaults,
    );
    const all = roomOnCount(room, new Set());
    expect(roomOnCount(room, new Set(["gmail", "tools:agents"]))).toBe(all - 2);
  });
});
