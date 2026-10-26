import { describe, expect, it } from "vitest";
import { navigation } from "./resources/navigation";
import { vi as viResources } from "./resources/vi";

function strings(value: unknown, prefix = ""): [string, string][] {
  if (typeof value === "string") return [[prefix, value]];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    strings(child, prefix ? `${prefix}.${key}` : key),
  );
}

// Owner naming decision (2026-10-26): Workspace (formerly Work), Chat · Workspace · All on Home,
// Tasks = "Công việc" in Vietnamese and nothing else.
describe("Navigation V2 naming", () => {
  it("never lets the Workspace section share the Tasks word", () => {
    for (const [locale, resource] of Object.entries(navigation)) {
      expect(resource.sections.work, locale).not.toBe(resource.sections.tasks);
      expect(resource.mode.work, locale).toBe(resource.sections.work);
    }
  });

  it("reads Chat · Workspace · All in English and Chat · Workspace · Tất cả in Vietnamese", () => {
    expect(navigation.en.mode).toMatchObject({ chat: "Chat", work: "Workspace", hybrid: "All" });
    expect(navigation.vi.mode).toMatchObject({ chat: "Chat", work: "Workspace", hybrid: "Tất cả" });
    expect(navigation.en.sections).toMatchObject({ work: "Workspace", tasks: "Tasks" });
    expect(navigation.vi.sections).toMatchObject({ work: "Workspace", tasks: "Công việc" });
    expect(navigation.vi.actions.newWorkspace).toBe("Workspace mới");
  });

  it('keeps "Công việc" for Tasks only in Vietnamese', () => {
    const allowed = /^(navigation\.)?(sections\.tasks|tasksPlaceholder\.)/;
    const offenders = [
      ...strings(viResources),
      ...strings(navigation.vi).map(([key, value]) => [`navigation.${key}`, value] as const),
    ].filter(([key, value]) => /công việc/i.test(value) && !allowed.test(key));
    expect(offenders).toEqual([]);
  });
});
