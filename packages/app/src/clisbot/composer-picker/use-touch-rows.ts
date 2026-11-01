import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";

/** Rows and segments a thumb presses: 44px tall in the phone sheet and on touch devices. */
export function useTouchRows(): boolean {
  const isCompact = useIsCompactFormFactor();
  return isNative || isCompact;
}
