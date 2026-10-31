import { useCallback } from "react";
import { withLayoutContext } from "expo-router";
import { MobileTabBar } from "./mobile-navigation";
import { createPhoneTabNavigator, type PhoneTabBarProps } from "./phone-tab-navigator";
import { phoneTabPath, phoneTabRouteName } from "./phone-tab-routes";

/** The `app/(tabs)` layout's phone navigator, registered as an Expo Router layout. */
export const PhoneTabs = withLayoutContext(createPhoneTabNavigator().Navigator);

export function renderPhoneTabBar(props: PhoneTabBarProps) {
  return <PhoneTabBar {...props} />;
}

function PhoneTabBar({ state, navigation }: PhoneTabBarProps) {
  const { navigate } = navigation;
  const select = useCallback(
    (path: string) => {
      const name = phoneTabRouteName(path);
      if (name) navigate(name);
    },
    [navigate],
  );
  return <MobileTabBar path={phoneTabPath(state.routes[state.index]!.name)} onSelect={select} />;
}
