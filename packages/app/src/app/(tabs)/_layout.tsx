import type { ReactElement, ReactNode } from "react";
import { Stack } from "expo-router";
import { AppearanceStyleBoundary } from "@/components/appearance-style-boundary";
import { useUsesPhoneTabs } from "@/clisbot/home/mobile-navigation";
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
 * The choice follows the breakpoint. Crossing it mounts the other navigator, which starts from
 * the linked tab, not the one shown before.
 */
export default function PeerPagesLayout() {
  return useUsesPhoneTabs() ? <PhoneTabsLayout /> : <PeerPagesStack />;
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
