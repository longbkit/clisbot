import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
const noop = (_event: NativeSyntheticEvent<NativeScrollEvent>) => {};
const handlers = { onScroll: noop, onScrollBeginDrag: noop, onScrollEndDrag: noop };
/** Native owns IME dismissal; browser scrolling keeps its existing focus behavior. */
export function useChatKeyboardDismiss() {
  return handlers;
}
