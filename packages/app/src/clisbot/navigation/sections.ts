import type { PluginSidebarGroup } from "@/plugins/sidebar-groups";
import type { SidebarNavItem } from "@/sidebar-nav/model";

/**
 * The navigation registry (brief C1): one entry per destination. The desktop rail, the phone tab
 * bar and More all read `resolveNavigationSections`, so a new section is one entry here.
 */
export type BuiltinSectionId =
  | "home"
  | "chats"
  | "work"
  | "design"
  | "schedules"
  | "tasks"
  | "connectors"
  | "usage"
  | "hosts"
  | "help"
  | "settings";

export interface BuiltinSection {
  kind: "builtin";
  id: BuiltinSectionId;
  key: BuiltinSectionId;
  labelKey: string;
  /** Route the entry opens; Hosts and Help open a picker or menu instead. */
  href?: string;
  rail: "primary" | "bottom";
  phone: "tab" | "more";
  /** `preview` sections show the In development badge and a placeholder page. */
  status: "ready" | "preview";
}

export interface PluginSection {
  kind: "plugin";
  key: string;
  group: PluginSidebarGroup;
  /** Header contributions join the primary rail; footer ones the bottom group. */
  rail: "primary" | "bottom";
  phone: "more";
}

export type NavigationSection = BuiltinSection | PluginSection;

function builtin(
  id: BuiltinSectionId,
  rail: BuiltinSection["rail"],
  phone: BuiltinSection["phone"],
  href?: string,
  status: BuiltinSection["status"] = "ready",
): BuiltinSection {
  return {
    kind: "builtin",
    id,
    key: id,
    labelKey: `navigation.sections.${id}`,
    href,
    rail,
    phone,
    status,
  };
}

export const HOME_PATH = "/open-project";
export const CHATS_PATH = "/chat";
export const WORK_PATH = "/work";
export const SCHEDULES_PATH = "/schedules";
export const MORE_PATH = "/more";
export const TASKS_PATH = "/tasks";
export const DESIGN_PATH = "/design";

export const BUILTIN_SECTIONS: readonly BuiltinSection[] = [
  builtin("home", "primary", "tab", HOME_PATH),
  builtin("chats", "primary", "tab", CHATS_PATH),
  builtin("work", "primary", "tab", WORK_PATH),
  builtin("design", "primary", "more", DESIGN_PATH, "preview"),
  builtin("schedules", "primary", "tab", SCHEDULES_PATH),
  builtin("tasks", "primary", "more", TASKS_PATH, "preview"),
  builtin("connectors", "primary", "more", "/connectors"),
  builtin("usage", "bottom", "more"),
  builtin("hosts", "bottom", "more"),
  builtin("help", "bottom", "more"),
  builtin("settings", "bottom", "more", "/settings"),
];

export interface ResolvedNavigation {
  railPrimary: NavigationSection[];
  railBottom: NavigationSection[];
  phoneTabs: BuiltinSection[];
  /** More lists everything that is not a tab; Settings is always last. */
  more: NavigationSection[];
}

/**
 * Plugin entries keep the user's existing sidebar order and visibility preferences
 * (`sidebarNavItems`, `sidebarFooterItems`): visible plugin header items follow Connectors on the
 * rail, visible footer items lead the bottom group. Usage shows only when the user enabled it.
 */
export function resolveNavigationSections(input: {
  headerItems: readonly SidebarNavItem[];
  footerItems: readonly SidebarNavItem[];
  usageEnabled: boolean;
  connectorsEnabled: boolean;
}): ResolvedNavigation {
  const visible = (section: BuiltinSection) =>
    (section.id !== "usage" || input.usageEnabled) &&
    (section.id !== "connectors" || input.connectorsEnabled);
  const builtins = BUILTIN_SECTIONS.filter(visible);
  const plugins = (items: readonly SidebarNavItem[], rail: PluginSection["rail"]) =>
    items.flatMap((item): PluginSection[] =>
      item.kind === "plugin" && item.visible
        ? [{ kind: "plugin", key: item.key, group: item.group, rail, phone: "more" }]
        : [],
    );
  const railPrimary: NavigationSection[] = [
    ...builtins.filter((section) => section.rail === "primary"),
    ...plugins(input.headerItems, "primary"),
  ];
  const railBottom: NavigationSection[] = [
    ...plugins(input.footerItems, "bottom"),
    ...builtins.filter((section) => section.rail === "bottom"),
  ];
  const phoneTabs = builtins.filter((section) => section.phone === "tab");
  const more = [...railPrimary, ...railBottom].filter((section) => section.phone === "more");
  return { railPrimary, railBottom, phoneTabs, more };
}

/** Which section a pathname belongs to; detail routes belong to the list they open from. */
export function sectionForPath(
  pathname: string,
  lastList: "chats" | "work" = "work",
): BuiltinSectionId | "more" | null {
  if (pathname === HOME_PATH || pathname === "/" || pathname === "/sessions") return "home";
  if (pathname === CHATS_PATH) return "chats";
  if (pathname === WORK_PATH || pathname === "/new") return "work";
  if (pathname === SCHEDULES_PATH || pathname === "/automations") return "schedules";
  if (pathname === TASKS_PATH) return "tasks";
  if (pathname === DESIGN_PATH) return "design";
  if (pathname === "/connectors") return "connectors";
  if (pathname === MORE_PATH) return "more";
  if (pathname.startsWith("/settings")) return "settings";
  const host = /^\/h\/[^/]+\/([^/]+)/.exec(pathname)?.[1];
  if (host === "chat" || host === "bot") return "chats";
  if (host === "workspace" || host === "agent") return lastList;
  return null;
}

/** Sections whose list pane sits beside the detail on desktop. */
export function sectionHasListPane(section: ReturnType<typeof sectionForPath>): boolean {
  return section === "chats" || section === "work";
}
