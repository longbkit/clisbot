import {
  CommonActions,
  StackActions,
  StackRouter,
  type StackActionType,
} from "@react-navigation/routers";
import type { Href } from "expo-router";
import { describe, expect, it } from "vitest";
import { navigateHomeTab } from "./home-tab-navigation";

// Exercise the installed navigation reducer: navigate without getId retains a fresh native
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
