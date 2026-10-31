import React from "react";
import { View } from "react-native";
import {
  StackRouter,
  createNavigatorFactory,
  useNavigationBuilder,
  type DefaultNavigatorOptions,
  type NavigationProp,
  type ParamListBase,
  type StackActionHelpers,
  type StackNavigationState,
  type StackRouterOptions,
} from "expo-router/react-navigation";
import type { ScheduleAfterPaint } from "@/navigation/open-gate";

type RetainingStackEventMap = Record<string, { data?: unknown }>;

/**
 * A stack that keeps every pushed screen mounted, as the native stack does. React Navigation
 * renders a pushed screen in the commit of the action that pushed it.
 */
function RetainingStack({
  children,
  initialRouteName,
}: DefaultNavigatorOptions<
  ParamListBase,
  string | undefined,
  StackNavigationState<ParamListBase>,
  object,
  RetainingStackEventMap,
  NavigationProp<ParamListBase>
> &
  StackRouterOptions) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder<
    StackNavigationState<ParamListBase>,
    StackRouterOptions,
    StackActionHelpers<ParamListBase>,
    object,
    RetainingStackEventMap
  >(StackRouter, { children, initialRouteName });
  return (
    <NavigationContent>
      {state.routes.map((route, index) => (
        <View key={route.key} style={index === state.index ? undefined : hidden}>
          {descriptors[route.key]!.render()}
        </View>
      ))}
    </NavigationContent>
  );
}
const hidden = { display: "none" } as const;

export const createRetainingStack = createNavigatorFactory(RetainingStack);

/** What the scheduler would run after the shell's frame; the test decides when. */
export function createManualSchedule() {
  const queued = new Set<() => void>();
  const schedule: ScheduleAfterPaint = (run) => {
    queued.add(run);
    return () => queued.delete(run);
  };
  return {
    schedule,
    get queued() {
      return queued.size;
    },
    runAll: () => {
      const runs = [...queued];
      queued.clear();
      for (const run of runs) run();
    },
  };
}
