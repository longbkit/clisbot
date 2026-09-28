import { expect, it } from "vitest";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import { resolvePinTarget, type PinCatalog } from "./pin-target";
const project = {
  projectName: "Shared checkout",
  hosts: [
    { serverId: "a", projectId: "p" },
    { serverId: "b", projectId: "p" },
  ],
  workspaces: [
    { serverId: "a", workspaceId: "wa" },
    { serverId: "b", workspaceId: "wb" },
  ],
} as SidebarProjectEntry;
const catalog: PinCatalog = { bots: [], chats: [], projects: [project], agents: {} };
it("opens the pinned Host's workspace even when the aggregated project starts on another Host", () => {
  const result = resolvePinTarget({ kind: "project", serverId: "b", id: "p" }, catalog);
  expect(result?.route).toContain("/h/b/workspace/wb");
});
it("does not surface names or routes of no-longer-accessible resources", () => {
  expect(resolvePinTarget({ kind: "project", serverId: "c", id: "p" }, catalog)).toBeNull();
  expect(resolvePinTarget({ kind: "bot", serverId: "a", id: "old" }, catalog)).toBeNull();
  expect(resolvePinTarget({ kind: "session", serverId: "a", id: "old" }, catalog)).toBeNull();
});
