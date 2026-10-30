import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Stack, useNavigationContainerRef } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { AppearanceStyleBoundary } from "@/components/appearance-style-boundary";
import { useUsesPhoneTabs } from "@/clisbot/home/mobile-navigation";
import { phoneTabsRemountAction } from "@/clisbot/home/phone-tab-routes";
import { PhoneTabs, renderPhoneTabBar } from "@/clisbot/home/phone-tabs";
import { ThemedStack } from "@/navigation/themed-stack";

const STACK_SCREEN_OPTIONS = {
  headerShown: false,
  animation: "none" as const,
};

/**
 * The peer pages: Home, Chats, Work, Schedules and More. A route group adds no URL segment, so
 * `/open-project`, `/chat`, `/work`, `/schedules` and `/more` keep their links. Phones get one
 * retained tab navigator (docs/expo-router.md#phone-tabs); every other layout keeps the stack.
 *
 * Each mount keeps the navigator it started with: the root stack holds this route's navigation
 * state, and the other kind of navigator cannot adopt it. Crossing the breakpoint replaces this
 * route on the tab it shows, once the tabs are on screen.
 */
export default function PeerPagesLayout() {
  const phoneTabs = useUsesPhoneTabs();
  const [mountedAsPhoneTabs] = useState(phoneTabs);
  useRemountAcrossBreakpoint(mountedAsPhoneTabs !== phoneTabs);
  return mountedAsPhoneTabs ? <PhoneTabsLayout /> : <PeerPagesStack />;
}

function useRemountAcrossBreakpoint(stale: boolean) {
  const root = useNavigationContainerRef();
  const focused = useIsFocused();
  useEffect(() => {
    if (!stale || !focused) return;
    const action = phoneTabsRemountAction(root.getRootState());
    if (action) root.dispatch(action);
  }, [focused, root, stale]);
}

function PhoneTabsLayout() {
  return (
    <PhoneTabs tabBar={renderPhoneTabBar} screenLayout={appearanceScreenLayout}>
      <PhoneTabs.Screen name="open-project" />
      <PhoneTabs.Screen name="chat" />
      <PhoneTabs.Screen name="work" />
      <PhoneTabs.Screen name="schedules" />
      <PhoneTabs.Screen name="more" />
    </PhoneTabs>
  );
}

/** As `ThemedStack` does for its screens: appearance changes remount content below the navigator. */
function appearanceScreenLayout({ children }: { children: ReactNode }): ReactElement {
  return <AppearanceStyleBoundary>{children}</AppearanceStyleBoundary>;
}

function PeerPagesStack() {
  return (
    <ThemedStack screenOptions={STACK_SCREEN_OPTIONS}>
      <Stack.Screen name="open-project" />
      <Stack.Screen name="chat" />
      <Stack.Screen name="work" />
      <Stack.Screen name="schedules" />
      <Stack.Screen name="more" />
    </ThemedStack>
  );
}
