import { memo, startTransition, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import {
  TabRouter,
  createNavigatorFactory,
  useNavigationBuilder,
  type DefaultNavigatorOptions,
  type NavigationProp,
  type ParamListBase,
  type TabActionHelpers,
  type TabNavigationState,
  type TabRouterOptions,
} from "expo-router/react-navigation";
import { RetainedPanel } from "@/components/retained-panel";
import { getColdStartConnectTimeline } from "@/runtime/cold-start-connect";
import { RenderProfile } from "@/utils/render-profiler";
import { scheduleIdleAfterStartup } from "./after-startup";

export interface PhoneTabBarProps {
  state: TabNavigationState<ParamListBase>;
  navigation: { navigate: (name: string) => void };
}

/** Runs `run` when the JS thread is idle; returns a cancel. */
export type ScheduleIdle = (run: () => void) => () => void;

// Safari has no requestIdleCallback; a short timer still lets the first paint go out first.
const scheduleIdleSlot: ScheduleIdle = (run) => {
  if (typeof requestIdleCallback !== "function") {
    const timer = setTimeout(run, 200);
    return () => clearTimeout(timer);
  }
  const id = requestIdleCallback(run, { timeout: 2000 });
  return () => cancelIdleCallback(id);
};

const scheduleIdle = scheduleIdleAfterStartup(getColdStartConnectTimeline(), scheduleIdleSlot);

type PhoneTabEventMap = Record<string, { data?: unknown }>;

type PhoneTabNavigatorProps = DefaultNavigatorOptions<
  ParamListBase,
  string | undefined,
  TabNavigationState<ParamListBase>,
  object,
  PhoneTabEventMap,
  NavigationProp<ParamListBase>
> &
  TabRouterOptions & {
    tabBar: (props: PhoneTabBarProps) => ReactNode;
    scheduleIdle?: ScheduleIdle;
  };

/**
 * The phone's peer tabs (docs/mobile-panels.md#phone-tabs). Once startup settles each unvisited
 * tab mounts hidden, one per idle slot, so a first visit is not a mount; a mounted tab never
 * unmounts. A press shows and activates its tab in the press's own commit. Activating in a deferred
 * render instead let a busy JS thread postpone it until the next input, and that input (the first
 * row tap on the tab) was lost on a Galaxy S23.
 */
function PhoneTabNavigator({
  id,
  initialRouteName,
  backBehavior,
  children,
  screenOptions,
  screenListeners,
  screenLayout,
  tabBar,
  scheduleIdle: schedule = scheduleIdle,
}: PhoneTabNavigatorProps) {
  const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder<
    TabNavigationState<ParamListBase>,
    TabRouterOptions,
    TabActionHelpers<ParamListBase>,
    object,
    PhoneTabEventMap
  >(TabRouter, {
    id,
    initialRouteName,
    backBehavior,
    children,
    screenOptions,
    screenListeners,
    screenLayout,
  });
  const focusedKey = state.routes[state.index]!.key;
  const mounted = useMountedKeys(focusedKey, state.routes, schedule);
  return (
    <NavigationContent>
      <View style={styles.fill}>
        <View style={styles.fill}>
          {state.routes.map((route) =>
            mounted.has(route.key) ? (
              <RetainedPanel key={route.key} active={route.key === focusedKey}>
                <RenderProfile id={`Tab:${route.name}`}>
                  {descriptors[route.key]!.render()}
                </RenderProfile>
              </RetainedPanel>
            ) : null,
          )}
        </View>
        <TabBarSlot tabBar={tabBar} state={state} navigation={navigation} />
      </View>
    </NavigationContent>
  );
}

/**
 * The navigator re-renders when its layout does, and a push above the tabs blurs the layout's
 * route. The bar re-renders only when the tab state changes.
 */
const TabBarSlot = memo(function TabBarSlot({
  tabBar,
  ...props
}: PhoneTabBarProps & { tabBar: PhoneTabNavigatorProps["tabBar"] }) {
  return tabBar(props);
});

/**
 * Route keys whose tab is mounted: the focused one at once, then the others in route order, one
 * per idle slot, each in a transition a press can interrupt. A key is never removed.
 */
function useMountedKeys(
  focusedKey: string,
  routes: readonly { key: string }[],
  schedule: ScheduleIdle,
): ReadonlySet<string> {
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set([focusedKey]));
  const next = routes.find((route) => !mounted.has(route.key))?.key;
  useEffect(() => {
    if (next === undefined) return;
    const mountNext = () => setMounted(new Set(mounted).add(next));
    return schedule(() => startTransition(mountNext));
  }, [mounted, next, schedule]);
  if (mounted.has(focusedKey)) return mounted;
  const withFocused = new Set(mounted).add(focusedKey);
  setMounted(withFocused);
  return withFocused;
}

export const createPhoneTabNavigator = createNavigatorFactory(PhoneTabNavigator);

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
});
