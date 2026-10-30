import { startTransition, useDeferredValue, useEffect, useState, type ReactNode } from "react";
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

export interface PhoneTabBarProps {
  state: TabNavigationState<ParamListBase>;
  navigation: { navigate: (name: string) => void };
}

/** Runs `run` when the JS thread is idle; returns a cancel. */
export type ScheduleIdle = (run: () => void) => () => void;

// Safari has no requestIdleCallback; a short timer still lets the first paint go out first.
const scheduleIdle: ScheduleIdle = (run) => {
  if (typeof requestIdleCallback !== "function") {
    const timer = setTimeout(run, 200);
    return () => clearTimeout(timer);
  }
  const id = requestIdleCallback(run, { timeout: 2000 });
  return () => cancelIdleCallback(id);
};

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
 * The phone's peer tabs (docs/mobile-panels.md#phone-tabs). After the first paint each unvisited
 * tab mounts hidden, one per idle slot, so a first visit is not a mount; a mounted tab never
 * unmounts. A press shows its tab in the press's own commit as the tab last rendered and
 * activates it in a deferred render: hidden panes hold their inputs (`useHeldWhileInactive`), so
 * the press's commit renders no tab body.
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
  const activeKey = useDeferredValue(focusedKey);
  const mounted = useMountedKeys(focusedKey, state.routes, schedule);
  return (
    <NavigationContent>
      <View style={styles.fill}>
        <View style={styles.fill}>
          {state.routes.map((route) =>
            mounted.has(route.key) ? (
              <RetainedPanel
                key={route.key}
                shown={route.key === focusedKey}
                active={route.key === focusedKey && route.key === activeKey}
              >
                {descriptors[route.key]!.render()}
              </RetainedPanel>
            ) : null,
          )}
        </View>
        {tabBar({ state, navigation })}
      </View>
    </NavigationContent>
  );
}

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
