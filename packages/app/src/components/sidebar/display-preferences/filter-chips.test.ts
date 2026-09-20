import { describe, expect, it } from "vitest";
import { SIDEBAR_UNLABELLED_LABEL_KEY } from "@/stores/sidebar-view-store";
import { buildSidebarFilterChips } from "./filter-chips";

describe("buildSidebarFilterChips", () => {
  it("builds one chip per selected value, falling back to the raw key", () => {
    expect(
      buildSidebarFilterChips({
        hostFilters: ["host-a", "missing-host"],
        hostLabelById: new Map([["host-a", "Studio"]]),
        projectFilters: ["proj-1"],
        projectLabelByKey: new Map([["proj-1", "clisbot"]]),
        labelFilters: [SIDEBAR_UNLABELLED_LABEL_KEY, "bug"],
        labelNameByKey: new Map([["bug", "Bug"]]),
        unlabelledLabel: "Unlabelled",
        userFilters: ["user-1"],
        userLabelByKey: new Map([["user-1", "Long"]]),
        channelFilters: [],
        channelLabelByKey: new Map(),
      }),
    ).toEqual([
      { category: "host", value: "host-a", label: "Studio" },
      { category: "host", value: "missing-host", label: "missing-host" },
      { category: "project", value: "proj-1", label: "clisbot" },
      { category: "label", value: SIDEBAR_UNLABELLED_LABEL_KEY, label: "Unlabelled" },
      { category: "label", value: "bug", label: "Bug" },
      { category: "user", value: "user-1", label: "Long" },
    ]);
  });

  it("returns no chips when every allowlist is empty", () => {
    expect(
      buildSidebarFilterChips({
        hostFilters: [],
        hostLabelById: new Map(),
        projectFilters: [],
        projectLabelByKey: new Map(),
        labelFilters: [],
        labelNameByKey: new Map(),
        unlabelledLabel: "Unlabelled",
        userFilters: [],
        userLabelByKey: new Map(),
        channelFilters: [],
        channelLabelByKey: new Map(),
      }),
    ).toEqual([]);
  });
});
