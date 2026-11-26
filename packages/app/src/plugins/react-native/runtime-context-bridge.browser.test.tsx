import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import type { PluginNewWorkspace, PluginClisbotApi } from "@clisbot/plugin/client";
import {
  ClisbotApiProvider,
  PluginNewWorkspaceProvider,
  PluginRpcProvider,
  PluginTranslationProvider,
  PluginTranslationRuntime,
  usePluginRuntimeContextBridge,
  type PluginRuntimeContextBridge,
  type PluginSubscribe,
} from "@clisbot/plugin/client/host";
import { useNewWorkspace } from "@clisbot/plugin/client";

// App sources compile against the classic JSX runtime, which expects React on the global, as the
// other browser tests here arrange.
beforeEach(() => vi.stubGlobal("React", React));

const newWorkspace = {
  host: { id: "host_1", label: "Laptop" },
  project: { id: "project_1", name: "clisbot" },
  isolation: "worktree",
  baseRef: { type: "branch", name: "refs/remotes/origin/main" },
  branch: null,
  metadata: {},
} as PluginNewWorkspace;

const translations = new PluginTranslationRuntime({
  getLocale: () => "en",
  subscribe: () => () => undefined,
});
const clisbot = {} as PluginClisbotApi;
const rejectRpc = () => Promise.reject(new Error("no rpc in this test"));
const noSubscribe: PluginSubscribe = () =>
  Object.assign(() => undefined, { ready: Promise.resolve(), release: () => Promise.resolve() });

/** An item the way a plugin writes one: it reads the setup it sits in and shows the branch base. */
function BaseRefLabel() {
  const setup = useNewWorkspace();
  return (
    <span data-testid="base">{setup.baseRef?.type === "branch" ? setup.baseRef.name : "none"}</span>
  );
}

it("a New workspace item rendered through a portal host still finds its setup", () => {
  let bridge: PluginRuntimeContextBridge | null = null;
  function Capture() {
    bridge = usePluginRuntimeContextBridge();
    return null;
  }
  const surface = createRoot(document.createElement("div"));
  act(() =>
    surface.render(
      <ClisbotApiProvider clisbot={clisbot}>
        <PluginRpcProvider invoke={rejectRpc} subscribe={noSubscribe}>
          <PluginTranslationProvider runtime={translations}>
            <PluginNewWorkspaceProvider newWorkspace={newWorkspace}>
              <Capture />
            </PluginNewWorkspaceProvider>
          </PluginTranslationProvider>
        </PluginRpcProvider>
      </ClisbotApiProvider>,
    ),
  );
  if (!bridge) throw new Error("bridge did not mount");

  // A portal host, such as the modal sheet, mounts the item in a separate React tree.
  const portalElement = document.createElement("div");
  const portal = createRoot(portalElement);
  act(() => portal.render(<>{bridge!(<BaseRefLabel />)}</>));
  expect(portalElement.querySelector('[data-testid="base"]')?.textContent).toBe(
    "refs/remotes/origin/main",
  );

  act(() => portal.unmount());
  act(() => surface.unmount());
});
