// @vitest-environment jsdom
import React, { act, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceEntryContent, type SchedulePreparation } from "./workspace-entry-content";

const state = vi.hoisted(() => ({ departing: true }));
vi.mock("@/clisbot/home/use-chat-list-departure", () => ({
  useIsChatListDeparting: () => state.departing,
}));
let root: Root | undefined;
let container: HTMLDivElement;
const commits: string[] = [];
const PREPARING = <span>Preparing</span>;
// The body's later task, run by hand: `runScheduled` is that task.
const scheduled = new Set<() => void>();
const schedule: SchedulePreparation = (run) => {
  scheduled.add(run);
  return () => scheduled.delete(run);
};
function runScheduled() {
  const runs = [...scheduled];
  scheduled.clear();
  for (const run of runs) run();
}
function Pane() {
  const [draft] = useState("retained draft");
  useLayoutEffect(() => {
    commits.push("pane");
    return () => {
      commits.push("dispose");
    };
  }, []);
  return <span>{draft}</span>;
}
function view(focused: boolean, nativeCompact = true, identity = "A") {
  return (
    <>
      <button type="button">Back</button>
      <WorkspaceEntryContent
        key={identity}
        nativeCompact={nativeCompact}
        focused={focused}
        placeholder={PREPARING}
        schedule={schedule}
      >
        <Pane />
      </WorkspaceEntryContent>
    </>
  );
}
function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
}
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  container?.remove();
  commits.length = 0;
  scheduled.clear();
  state.departing = true;
});
it("commits the existing Back/header shell without constructing panes during departure", async () => {
  mount();
  await act(() => root!.render(view(true)));
  expect(container.textContent).toBe("BackPreparing");
  expect(commits).toEqual([]);
});
it("lets urgent Back abandon first preparation before any pane commits", async () => {
  mount();
  await act(() => root!.render(view(true)));
  await act(async () => {
    state.departing = false;
    flushSync(() => root!.render(view(true)));
    expect(container.textContent).toBe("BackPreparing");
    flushSync(() => root!.render(view(false)));
  });
  await act(runScheduled);
  expect(commits).toEqual([]);
  expect(container.textContent).toBe("BackPreparing");
});
it("shows the placeholder first and the body in the next task", async () => {
  mount();
  state.departing = false;
  await act(() => root!.render(view(true)));
  expect(container.textContent).toBe("BackPreparing");
  expect(commits).toEqual([]);
  await act(runScheduled);
  expect(container.textContent).toBe("Backretained draft");
  expect(commits).toEqual(["pane"]);
});
it("retains an already committed pane through Back and reopening without destroying its draft", async () => {
  mount();
  state.departing = false;
  await act(() => root!.render(view(true)));
  await act(runScheduled);
  expect(commits).toEqual(["pane"]);
  state.departing = true;
  await act(() => root!.render(view(false)));
  expect(container.textContent).toBe("Backretained draft");
  expect(commits).toEqual(["pane"]);
  state.departing = false;
  await act(() => root!.render(view(true)));
  expect(commits).toEqual(["pane"]);
});
it("does not let new B inherit committed preparation from A", async () => {
  mount();
  state.departing = false;
  await act(() => root!.render(view(true)));
  await act(runScheduled);
  state.departing = true;
  await act(() => root!.render(view(true, true, "B")));
  expect(container.textContent).toBe("BackPreparing");
  expect(commits).toEqual(["pane", "dispose"]);
});
it("does not prepare an unfocused cold native leaf", async () => {
  mount();
  state.departing = false;
  await act(() => root!.render(view(false)));
  await act(runScheduled);
  expect(commits).toEqual([]);
});
it("leaves web/desktop materialization unchanged", async () => {
  mount();
  await act(() => root!.render(view(false, false)));
  expect(container.textContent).toBe("Backretained draft");
  expect(commits).toEqual(["pane"]);
});

// Opening a session while Hosts connect: store updates land every few frames. A deferred
// (transition) body restarted on each one until React's 5 s expiry; the body renders once.
it("renders the body once while store updates keep landing", async () => {
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  state.departing = false;
  let version = 0;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  function Ticker() {
    return <b>{useSyncExternalStore(subscribe, () => version)}</b>;
  }
  let bodyRenders = 0;
  function SlowRow() {
    const start = performance.now();
    while (performance.now() - start < 3) {
      // A row that takes 3 ms to render, like a timeline row on a phone.
    }
    return <i />;
  }
  function Body() {
    bodyRenders += 1;
    return Array.from({ length: 40 }, (_, index) => <SlowRow key={index} />);
  }
  const shown = new Promise<void>((resolve) => {
    function Shown() {
      useLayoutEffect(resolve, []);
      return null;
    }
    mount();
    root!.render(
      <>
        <Ticker />
        <WorkspaceEntryContent nativeCompact focused placeholder={PREPARING}>
          <Body />
          <Shown />
        </WorkspaceEntryContent>
      </>,
    );
  });
  const ticks = setInterval(() => {
    version += 1;
    for (const listener of listeners) listener();
  }, 10);
  try {
    await shown;
  } finally {
    clearInterval(ticks);
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  }
  expect(bodyRenders).toBe(1);
}, 15_000);
