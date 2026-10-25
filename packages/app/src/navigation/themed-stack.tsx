import { useChatListScreenListeners } from "@/clisbot/home/use-chat-list-navigation";
import { Stack } from "expo-router";
import {
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useCallback,
  useMemo,
} from "react";
import { withUnistyles } from "react-native-unistyles";
import { AppearanceStyleBoundary } from "@/components/appearance-style-boundary";

type NativeStackNavigationOptions = Exclude<
  NonNullable<ComponentProps<typeof Stack>["screenOptions"]>,
  (...args: never[]) => unknown
>;

interface ThemedStackBaseProps {
  backgroundColor: string;
  children?: ReactNode;
  screenOptions?: NativeStackNavigationOptions;
  // Screens whose content is another navigator. That navigator owns its own screens' appearance
  // boundary; wrapping it here would remount it.
  nestedNavigatorScreens?: readonly string[];
  /** Screens with retained lifetime owners update appearance at their own leaves. */
  screenOwnedAppearance?: readonly string[];
  /** Replace leaf contents below the navigator when route authority is unavailable. */
  screenContentFallback?: ReactElement;
}

interface ScreenContent {
  route: { name: string };
  children: ReactNode;
}

function ThemedStackBase({
  backgroundColor,
  children,
  screenOptions,
  nestedNavigatorScreens,
  screenOwnedAppearance,
  screenContentFallback,
}: ThemedStackBaseProps) {
  const screenListeners = useChatListScreenListeners();
  const themedScreenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      ...screenOptions,
      contentStyle: [{ backgroundColor }, screenOptions?.contentStyle],
    }),
    [backgroundColor, screenOptions],
  );
  // Appearance changes remount each screen's content below the native stack, so the navigator
  // and its screen containers keep their identity. See docs/unistyles.md.
  const screenLayout = useCallback(
    ({ route, children: content }: ScreenContent): ReactElement => {
      // Keep navigator/route state mounted without mounting inaccessible leaf content.
      if (screenContentFallback)
        return <AppearanceStyleBoundary>{screenContentFallback}</AppearanceStyleBoundary>;
      if (
        (nestedNavigatorScreens?.includes(route.name) ||
          screenOwnedAppearance?.includes(route.name)) &&
        isValidElement(content)
      )
        return content;
      return <AppearanceStyleBoundary>{content}</AppearanceStyleBoundary>;
    },
    [nestedNavigatorScreens, screenOwnedAppearance, screenContentFallback],
  );

  return (
    <Stack
      screenOptions={themedScreenOptions}
      screenLayout={screenLayout}
      screenListeners={screenListeners}
    >
      {children}
    </Stack>
  );
}

export const ThemedStack = withUnistyles(ThemedStackBase, (theme) => ({
  backgroundColor: theme.colors.surface0,
}));
