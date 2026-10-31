import { describe, expect, it } from "vitest";
import {
  PHONE_TABS_ROUTE,
  phoneTabPath,
  phoneTabRouteName,
  phoneTabsRemountAction,
  resolvePhoneTabReturn,
} from "./phone-tab-routes";

const tabs = (focused = "chat") => ({
  name: PHONE_TABS_ROUTE,
  key: "tabs-1",
  state: { type: "tab", index: 0, routes: [{ name: focused, key: `${focused}-1` }] },
});
const host = { name: "h/[serverId]", key: "host-1" };
const settings = { name: "settings/index", key: "settings-1" };

function root(routes: { name: string; key: string }[], index = routes.length - 1) {
  return { type: "stack", key: "root", index, routes };
}

describe("phone tab routes", () => {
  it("keeps every tab's URL: the group adds no path segment", () => {
    for (const path of ["/open-project", "/chat", "/work", "/schedules", "/more"]) {
      expect(phoneTabPath(phoneTabRouteName(path)!)).toBe(path);
    }
    expect(phoneTabRouteName("/h/s/workspace/w")).toBeNull();
    expect(phoneTabRouteName("/settings")).toBeNull();
  });

  it("switches in place when the tabs are on screen", () => {
    expect(resolvePhoneTabReturn(root([tabs()]))).toEqual({ kind: "switch" });
  });

  it("pops a detail back onto the retained tabs instead of remounting them", () => {
    expect(resolvePhoneTabReturn(root([tabs(), host]))).toEqual({
      kind: "pop",
      target: "root",
      count: 1,
    });
    expect(resolvePhoneTabReturn(root([tabs(), host, settings]))).toEqual({
      kind: "pop",
      target: "root",
      count: 2,
    });
  });

  it("finds the app stack under Expo Router's own root navigator", () => {
    const app = root([tabs(), host]);
    const expoRoot = { key: "expo", index: 0, routes: [{ name: "__root", key: "r", state: app }] };
    expect(resolvePhoneTabReturn(expoRoot)).toEqual({ kind: "pop", target: "root", count: 1 });
    expect(
      resolvePhoneTabReturn({
        ...expoRoot,
        routes: [{ ...expoRoot.routes[0]!, state: root([host]) }],
      }),
    ).toEqual({
      kind: "replace",
    });
  });

  it("remounts the focused tabs route on the same tab when the navigator kind changes", () => {
    const app = root([host, tabs("work")]);
    const expoRoot = { key: "expo", index: 0, routes: [{ name: "__root", key: "r", state: app }] };
    expect(phoneTabsRemountAction(expoRoot)).toEqual({
      type: "REPLACE",
      target: "root",
      payload: { name: PHONE_TABS_ROUTE, params: { screen: "work" } },
    });
    // Behind a detail it waits: replacing there would drop the detail.
    expect(phoneTabsRemountAction(root([tabs(), host]))).toBeNull();
  });

  it("replaces a cold deep-linked detail that has no tabs underneath", () => {
    expect(resolvePhoneTabReturn(root([host]))).toEqual({ kind: "replace" });
    expect(resolvePhoneTabReturn(undefined)).toEqual({ kind: "replace" });
  });

  it("returns to the nearest tabs entry when an older one sits further down", () => {
    expect(resolvePhoneTabReturn(root([tabs(), host, tabs("work"), settings]))).toEqual({
      kind: "pop",
      target: "root",
      count: 1,
    });
  });
});
