import { useState, type ReactNode } from "react";
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
  };

/**
 * The phone's peer tabs (docs/mobile-panels.md#phone-tabs). A tab mounts on its first visit and
 * stays mounted: switching flips which retained panel is shown, in the press's own commit, with no
 * animation and no settlement. The hidden ones get an inactive retained-panel signal, so panes that
 * hold their inputs (`useHeldWhileInactive`) skip store updates until shown again.
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
  const visited = useVisitedKeys(focusedKey);
  return (
    <NavigationContent>
      <View style={styles.fill}>
        <View style={styles.fill}>
          {state.routes.map((route) =>
            visited.has(route.key) ? (
              <RetainedPanel key={route.key} active={route.key === focusedKey}>
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

/** Route keys shown at least once; a key is never removed, so a visited tab never unmounts. */
function useVisitedKeys(focusedKey: string): ReadonlySet<string> {
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set([focusedKey]));
  if (visited.has(focusedKey)) return visited;
  const next = new Set(visited).add(focusedKey);
  setVisited(next);
  return next;
}

export const createPhoneTabNavigator = createNavigatorFactory(PhoneTabNavigator);

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
});
