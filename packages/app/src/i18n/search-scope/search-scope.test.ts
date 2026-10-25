import { afterEach, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { searchScopeT } from "./index";
import { searchScopeResources } from "./resources";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === "object" ? keys(child, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

it("defines every English key in Vietnamese", () => {
  expect(keys(searchScopeResources.vi!).sort()).toEqual(keys(searchScopeResources.en!).sort());
});

it("translates in the current language and falls back to English elsewhere", async () => {
  expect(searchScopeT("project.onHosts", { count: 4 })).toBe("on 4 Hosts");
  expect(searchScopeT("sessions", { count: 1 })).toBe("1 session");
  await i18n.changeLanguage("vi");
  expect(searchScopeT("project.onHosts", { count: 4 })).toBe("trên 4 Host");
  await i18n.changeLanguage("fr");
  expect(searchScopeT("empty.searchEverywhere")).toBe("Search everywhere");
});
