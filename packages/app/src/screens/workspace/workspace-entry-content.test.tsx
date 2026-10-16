// @vitest-environment jsdom
import React, { act, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceEntryContent } from "./workspace-entry-content";

const state = vi.hoisted(() => ({ departing: true }));
vi.mock("@/clisbot/home/use-chat-list-departure", () => ({
  useIsChatListDeparting: () => state.departing,
}));
let root: Root | undefined;
let container: HTMLDivElement;
const commits: string[] = [];
const PREPARING = <span>Preparing</span>;
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
function view(focused: boolean, nativeCompact = true, identity = "A", awaitChatDeparture = true) {
  return (
    <>
      <button type="button">Back</button>
      <WorkspaceEntryContent
        key={identity}
        nativeCompact={nativeCompact}
        focused={focused}
        placeholder={PREPARING}
        awaitChatDeparture={awaitChatDeparture}
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
  expect(commits).toEqual([]);
  expect(container.textContent).toBe("BackPreparing");
});
it("retains an already committed pane through Back and reopening without destroying its draft", async () => {
  mount();
  state.departing = false;
  await act(() => root!.render(view(true)));
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
  state.departing = true;
  await act(() => root!.render(view(true, true, "B")));
  expect(container.textContent).toBe("BackPreparing");
  expect(commits).toEqual(["pane", "dispose"]);
});
it("does not prepare an unfocused cold native leaf", async () => {
  mount();
  state.departing = false;
  await act(() => root!.render(view(false)));
  expect(commits).toEqual([]);
});
it("leaves web/desktop materialization unchanged", async () => {
  mount();
  await act(() => root!.render(view(false, false)));
  expect(container.textContent).toBe("Backretained draft");
  expect(commits).toEqual(["pane"]);
});
it("can prepare during departure at deferred priority, still committing the shell first", async () => {
  mount();
  let first = "";
  // The urgent pass commits only the shell; the deferred pass then constructs the pane.
  flushSync(() => root!.render(view(true, true, "A", false)));
  first = container.textContent ?? "";
  expect(first).toBe("BackPreparing");
  await act(async () => {});
  expect(container.textContent).toBe("Backretained draft");
  expect(commits).toEqual(["pane"]);
});
