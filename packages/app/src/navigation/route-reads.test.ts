import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A whole-route read re-renders its caller on every push, pop and tab switch. In an always-mounted
 * tree (the root chrome, a phone tab, the tab bar) that put Home, the hidden tabs and the chrome
 * into the commit that pushed a chat. Read a selected fact instead (`useRoutePath`,
 * `useReadRoutePath`, `useRoutePathEffect`; docs/expo-router.md#route-reads). These are the reads
 * left, each with the reason it may stay.
 */
const ALLOWED_ROUTE_READS: Record<string, { reads: number; reason: string }> = {
  "app/_layout.tsx": {
    reads: 1,
    reason: "OverlayProviders scopes web confirmations; stable children",
  },
  "app/index.tsx": { reads: 1, reason: "startup route leaf" },
  "app/h/[serverId]/workspace/[workspaceId]/index.tsx": { reads: 1, reason: "session leaf" },
  "screens/workspace/workspace-header-menu.tsx": { reads: 1, reason: "session leaf header" },
  "clisbot/analytics/host.tsx": { reads: 1, reason: "renders nothing; records each route" },
  "clisbot/home/mobile-navigation.tsx": {
    reads: 3,
    reason: "MobileHomeTabs' Back handler renders nothing on phone tabs; V1 panel bar; detail Back",
  },
  "clisbot/navigation/list-panel.tsx": { reads: 1, reason: "desktop list pane" },
  "clisbot/hub/sidebar-account.tsx": { reads: 1, reason: "V1 sidebar" },
  "clisbot/hub/automation-sidebar-item.tsx": { reads: 1, reason: "V1 sidebar" },
  "clisbot/hub/sidebar-nav-group.tsx": { reads: 1, reason: "V1 sidebar" },
  "clisbot/connectors/connectors-sidebar-item.tsx": { reads: 1, reason: "V1 sidebar" },
  "components/sidebar/sidebar-nav-rows.tsx": { reads: 3, reason: "V1 sidebar" },
  "clisbot/home/use-chat-list-navigation.ts": { reads: 1, reason: "V1 sidebar" },
  "clisbot/home/pending-chat-presentation.tsx": { reads: 1, reason: "V1 sidebar" },
  "clisbot/bots/sidebar/chats-section.tsx": { reads: 1, reason: "V1 sidebar" },
  "clisbot/bots/sidebar/sections.tsx": { reads: 1, reason: "V1 sidebar sections" },
};

const SOURCE_ROOT = path.resolve(__dirname, "..");
const ROUTE_READ = /\b(usePathname|useSegments|useGlobalSearchParams|useNavigationState)\(/g;

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(entryPath);
    const source = /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name);
    return source ? [entryPath] : [];
  });
}

function countRouteReads(filePath: string): number {
  const code = readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  return code.match(ROUTE_READ)?.length ?? 0;
}

function routeReadsByFile(): Record<string, number> {
  const reads: Record<string, number> = {};
  for (const filePath of listSourceFiles(SOURCE_ROOT)) {
    const count = countRouteReads(filePath);
    if (count > 0) reads[path.relative(SOURCE_ROOT, filePath)] = count;
  }
  return reads;
}

describe("whole-route reads", () => {
  it("stay in leaf screens and the listed exceptions", () => {
    const allowed = Object.fromEntries(
      Object.entries(ALLOWED_ROUTE_READS).map(([file, { reads }]) => [file, reads]),
    );
    expect(routeReadsByFile()).toEqual(allowed);
  });
});
