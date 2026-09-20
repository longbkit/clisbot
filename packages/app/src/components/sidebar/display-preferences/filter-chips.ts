import { SIDEBAR_UNLABELLED_LABEL_KEY } from "@/stores/sidebar-view-store";

export type SidebarFilterChipCategory = "host" | "project" | "label" | "user" | "channel";

export interface SidebarFilterChip {
  category: SidebarFilterChipCategory;
  value: string;
  label: string;
}

export function buildSidebarFilterChips(input: {
  hostFilters: readonly string[];
  hostLabelById: ReadonlyMap<string, string>;
  projectFilters: readonly string[];
  projectLabelByKey: ReadonlyMap<string, string>;
  labelFilters: readonly string[];
  labelNameByKey: ReadonlyMap<string, string>;
  unlabelledLabel: string;
  userFilters: readonly string[];
  userLabelByKey: ReadonlyMap<string, string>;
  channelFilters: readonly string[];
  channelLabelByKey: ReadonlyMap<string, string>;
}): SidebarFilterChip[] {
  return [
    ...input.hostFilters.map((value) => ({
      category: "host" as const,
      value,
      label: input.hostLabelById.get(value) ?? value,
    })),
    ...input.projectFilters.map((value) => ({
      category: "project" as const,
      value,
      label: input.projectLabelByKey.get(value) ?? value,
    })),
    ...input.labelFilters.map((value) => ({
      category: "label" as const,
      value,
      label:
        value === SIDEBAR_UNLABELLED_LABEL_KEY
          ? input.unlabelledLabel
          : (input.labelNameByKey.get(value) ?? value),
    })),
    ...input.userFilters.map((value) => ({
      category: "user" as const,
      value,
      label: input.userLabelByKey.get(value) ?? value,
    })),
    ...input.channelFilters.map((value) => ({
      category: "channel" as const,
      value,
      label: input.channelLabelByKey.get(value) ?? value,
    })),
  ];
}
