import type { RefObject } from "react";

/** Web only: native lists have no wheel handler to step around. */
export function usePinchZoomPassthrough(_list: RefObject<unknown>): void {}
