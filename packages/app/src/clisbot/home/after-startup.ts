import type { ColdStartConnectTimeline } from "@/runtime/cold-start-connect";
import type { ScheduleIdle } from "./phone-tab-navigator";

/**
 * Idle work that must not compete with startup: it waits until the cache restore is done and the
 * restored Hosts are online, then for an idle slot. Mounting Work's ~6,100 rows in an idle slot
 * forced by the 2 s idle timeout landed in the middle of the restore on 2026-10-30.
 */
export function scheduleIdleAfterStartup(
  startup: Pick<ColdStartConnectTimeline, "whenSettled">,
  idle: ScheduleIdle,
): ScheduleIdle {
  return (run) => {
    let cancelIdle: (() => void) | null = null;
    const stopWaiting = startup.whenSettled(() => {
      cancelIdle = idle(run);
    });
    return () => {
      stopWaiting();
      cancelIdle?.();
    };
  };
}
