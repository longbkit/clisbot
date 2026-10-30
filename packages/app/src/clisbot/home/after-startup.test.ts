import { describe, expect, it } from "vitest";
import { ColdStartConnectTimeline } from "@/runtime/cold-start-connect";
import { scheduleIdleAfterStartup } from "./after-startup";

function startup() {
  const timeline = new ColdStartConnectTimeline({
    now: () => 0,
    report: () => undefined,
    schedule: () => () => undefined,
  });
  const idle: Array<() => void> = [];
  let cancelledIdle = 0;
  const schedule = scheduleIdleAfterStartup(timeline, (run) => {
    idle.push(run);
    return () => {
      cancelledIdle += 1;
    };
  });
  const settle = () => {
    timeline.registryRestored(["host"]);
    timeline.hostOnline("host");
    timeline.mark("cachedDirectories");
  };
  return { schedule, idle, settle, cancelledIdle: () => cancelledIdle };
}

describe("idle work after startup", () => {
  it("waits for startup to settle before asking for an idle slot", () => {
    const { schedule, idle, settle } = startup();
    const ran: string[] = [];
    schedule(() => ran.push("mount Work"));
    expect(idle).toHaveLength(0);

    settle();
    expect(idle).toHaveLength(1);
    idle[0]!();
    expect(ran).toEqual(["mount Work"]);
  });

  it("asks for the idle slot at once when startup has settled", () => {
    const { schedule, idle, settle } = startup();
    settle();
    schedule(() => undefined);
    expect(idle).toHaveLength(1);
  });

  it("never asks for a slot when cancelled before startup settles", () => {
    const { schedule, idle, settle, cancelledIdle } = startup();
    const cancel = schedule(() => undefined);
    cancel();
    settle();
    expect(idle).toHaveLength(0);
    expect(cancelledIdle()).toBe(0);
  });

  it("cancels the idle slot when cancelled after startup settled", () => {
    const { schedule, settle, cancelledIdle } = startup();
    const cancel = schedule(() => undefined);
    settle();
    cancel();
    expect(cancelledIdle()).toBe(1);
  });
});
