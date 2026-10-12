import { describe, expect, it, vi } from "vitest";
vi.mock("@/clisbot/home/feature", () => ({ HOME_V2_ENABLED: true }));
import { resolveStartupRoute } from "@/navigation/host-runtime-bootstrap";
const input = {
  route: { kind: "index" as const, pathname: "/" },
  startupBlocker: { kind: "none" as const },
  hostRegistryStatus: "ready" as const,
  hosts: [{ serverId: "host1" }],
  anyOnlineHostServerId: "host1",
  workspaceSelection: { serverId: "host1", workspaceId: "last" },
  workspaceSelectionStatus: "exists" as const,
  isWorkspaceSelectionLoaded: true,
  hasGivenUpWaitingForHost: false,
};
describe("Home startup policy", () => {
  it("cold starts at Home even with a valid remembered workspace", () =>
    expect(resolveStartupRoute(input)).toEqual({ kind: "redirect", href: "/open-project" }));
  it.each(["/sessions", "/h/host1/workspace/last", "/h/host1/chat/cht_1", "/settings"])(
    "preserves warm resume and direct navigation to %s",
    (pathname) => {
      expect(resolveStartupRoute({ ...input, route: { kind: "index", pathname } })).toEqual({
        kind: "render",
      });
    },
  );
  it("shows Home's recovery UI when the saved Hosts are offline", () => {
    expect(resolveStartupRoute({ ...input, anyOnlineHostServerId: null })).toEqual({
      kind: "redirect",
      href: "/open-project",
    });
  });
  it("sends a first run with no Host to Welcome, as before Home V2", () => {
    const empty = { ...input, hosts: [], anyOnlineHostServerId: null, workspaceSelection: null };
    expect(resolveStartupRoute(empty)).toEqual({ kind: "splash" });
    expect(resolveStartupRoute({ ...empty, hasGivenUpWaitingForHost: true })).toEqual({
      kind: "redirect",
      href: "/welcome",
    });
  });
});
