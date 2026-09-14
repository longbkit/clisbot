import { View } from "react-native";
import type { PropsWithChildren } from "react";

export function PressabilityDebugView(props: PropsWithChildren) {
  return <View {...(props as object)} />;
}
export function isEnabled(): boolean {
  return false;
}
export function setEnabled(_value: boolean): void {
  // No-op: debug overlays are off in tests.
}
