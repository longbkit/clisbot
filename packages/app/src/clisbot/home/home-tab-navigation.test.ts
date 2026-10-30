// Test-only entry: the public navigation barrel also loads native UI. Exercise the same
// installed Expo reducer through its pure module so Node never parses React Native Flow.
import {
  CommonActions,
  StackActions,
  StackRouter,
  type StackActionType,
} from "expo-router/build/react-navigation/routers/index.js";
import type { Href } from "expo-router";
import { describe, expect, it } from "vitest";
import { navigateHomeTab, returnToPhoneTabs } from "./home-tab-navigation";
import { PHONE_TABS_ROUTE, phoneTabRouteName } from "./phone-tab-routes";

// Exercise the installed Expo Router navigation reducer: navigate without getId retains a fresh native
// stack page on each cycle. No React trees or app state owners are mocked.
function navigation() {
  const stack = StackRouter({ initialRouteName: "open-project" });
  const options = {
    routeNames: ["open-project", "chat", "sessions", "schedules", "settings"],
    routeParamList: {},
    routeGetIdList: {},
  };
  let state = stack.getInitialState(options);
  const dispatch = (action: StackActionType | ReturnType<typeof CommonActions.navigate>) => {
    const next = stack.getStateForAction(state, action, options);
    if (!next) throw new Error("Unhandled navigation action");
    state = stack.getRehydratedState(next, options);
  };
  const name = (href: Href) => String(href).replace(/^\//, "");
  return {
    state: () => state,
    router: {
      navigate: (href: Href) => dispatch(CommonActions.navigate(name(href))),
      replace: (href: Href) => dispatch(StackActions.replace(name(href))),
      dismissTo: (href: Href) => dispatch(StackActions.popTo(name(href))),
    },
  };
}

describe("Home tab stack ownership", () => {
  it("bounds repeated native peer-tab visits without changing browser navigation", () => {
    const native = navigation();
    const web = navigation();
    for (let index = 0; index < 100; index++) {
      const href = ["/chat", "/sessions", "/schedules", "/open-project"][index % 4] as Href;
      navigateHomeTab({ router: native.router, href, nativeTab: true });
      navigateHomeTab({ router: web.router, href, nativeTab: false });
      expect(native.state().routes).toHaveLength(1);
      expect(native.state().routes[0].name).toBe(String(href).slice(1));
    }
    expect(web.state().routes).toHaveLength(101);
  });

  it("bounds peer visits above the retained workspace route across repeated detail returns", () => {
    const nav = navigation();
    nav.router.replace("/settings");
    const workspace = nav.state().routes[0];
    for (let index = 0; index < 100; index++) {
      // The workspace navigation owner dismisses back to its mounted host. Detail Back
      // then navigates to the entry page, keeping that host's retained deck underneath.
      nav.router.dismissTo("/settings");
      nav.router.navigate("/sessions");
      navigateHomeTab({ router: nav.router, href: "/chat", nativeTab: true });
      navigateHomeTab({ router: nav.router, href: "/open-project", nativeTab: true });
      expect(nav.state().routes).toHaveLength(2);
      expect(nav.state().routes[0].key).toBe(workspace.key);
      expect(nav.state().routes[1].name).toBe("open-project");
    }
  });
});

// Navigation V2 phones: the peer tabs are one `(tabs)` route on the root stack; details push above.
function phoneRoot() {
  const stack = StackRouter({ initialRouteName: PHONE_TABS_ROUTE });
  const options = {
    routeNames: [PHONE_TABS_ROUTE, "h/[serverId]", "settings"],
    routeParamList: {},
    routeGetIdList: {},
  };
  let state = stack.getInitialState(options);
  const apply = (action: StackActionType | ReturnType<typeof CommonActions.navigate>) => {
    const next = stack.getStateForAction(state, action, options);
    if (!next) throw new Error("Unhandled navigation action");
    state = stack.getRehydratedState(next, options);
  };
  const name = (href: Href) => {
    const path = String(href);
    if (path.startsWith("/h/")) return "h/[serverId]";
    return phoneTabRouteName(path) ? PHONE_TABS_ROUTE : path.slice(1);
  };
  return {
    state: () => state,
    root: {
      getRootState: () => state,
      dispatch: (action: { type: "POP"; payload: { count: number }; target: string }) =>
        apply(StackActions.pop(action.payload.count)),
    },
    router: {
      navigate: (href: Href) => apply(CommonActions.navigate(name(href))),
      replace: (href: Href) => apply(StackActions.replace(name(href))),
      dismissTo: (href: Href) => apply(StackActions.popTo(name(href))),
    },
  };
}

const routeNames = (nav: ReturnType<typeof phoneRoot>) =>
  nav.state().routes.map((route) => route.name);

describe("phone tabs under the root stack", () => {
  it("pops every detail back onto the same retained tabs route", () => {
    const nav = phoneRoot();
    const tabs = nav.state().routes[0]!;
    for (let index = 0; index < 50; index++) {
      nav.router.navigate("/h/s/workspace/w");
      expect(routeNames(nav)).toEqual([PHONE_TABS_ROUTE, "h/[serverId]"]);
      returnToPhoneTabs(nav.root, nav.router, "/chat");
      expect(nav.state().routes).toEqual([tabs]);
    }
  });

  it("switches in place, and reaches a tab from a detail without a second tabs route", () => {
    const nav = phoneRoot();
    const tabs = nav.state().routes[0]!;
    navigateHomeTab({ router: nav.router, href: "/work", nativeTab: true, phoneTabs: nav.root });
    expect(nav.state().routes).toHaveLength(1);
    nav.router.navigate("/h/s/workspace/w");
    navigateHomeTab({
      router: nav.router,
      href: "/open-project",
      nativeTab: true,
      phoneTabs: nav.root,
    });
    expect(nav.state().routes.map((route) => route.key)).toEqual([tabs.key]);
  });

  it("turns a cold deep-linked detail into the tabs on Back", () => {
    const nav = phoneRoot();
    nav.router.replace("/h/s/workspace/w");
    returnToPhoneTabs(nav.root, nav.router, "/chat");
    expect(routeNames(nav)).toEqual([PHONE_TABS_ROUTE]);
  });
});
