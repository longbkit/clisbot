// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { hostProjectFromRoute } from "@/projects/host-project-model";
import { useStartTemplate } from "./use-start-template";
vi.mock("@/projects/host-projects", async () => import("@/projects/host-project-model"));
afterEach(cleanup);
type Input = Parameters<typeof useStartTemplate>[0];
function fixture(): Input {
  return {
    focused: true,
    serverId: "host-a",
    pending: {
      serverId: "host-a",
      template: {
        name: "Fix",
        startingPrompt: "Fix the regression",
        visibility: "personal",
        target: { kind: "quickChat" },
        agent: { kind: "configured", config: { provider: "missing" } },
      },
    },
    kind: "quickChat",
    bot: undefined,
    project: null,
    directory: "/quick",
    draft: {
      isHydrated: true,
      replaceText: vi.fn(),
    } as unknown as Input["draft"],
    composer: {
      isAllModelsLoading: false,
      allProviderEntries: [],
    } as unknown as Input["composer"],
    preferences: {} as Input["preferences"],
    worktreeSupport: "unsupported",
    setPending: vi.fn(),
    setIsolation: vi.fn(),
    setBaseRequired: vi.fn(),
    setPickerOpen: vi.fn(),
    setError: vi.fn(),
    dispatchPicker: vi.fn(),
  };
}
test("an old Host's pending template cannot change another Host's composer", () => {
  const input = fixture();
  input.serverId = "host-b";
  renderHook(() => useStartTemplate(input));
  expect(input.setPending).toHaveBeenCalledWith(null);
  expect(input.draft.replaceText).not.toHaveBeenCalled();
});
test("a retained, unfocused Home cannot apply a late template to its shared draft", () => {
  const input = fixture();
  const hook = renderHook((props: Input) => useStartTemplate(props), {
    initialProps: { ...input, focused: false },
  });
  expect(input.draft.replaceText).not.toHaveBeenCalled();
  hook.rerender(input);
  expect(input.draft.replaceText).toHaveBeenCalledWith("Fix the regression");
});
test("unavailable configuration blocks its destination, not the next Host or project", () => {
  const input = fixture();
  const hook = renderHook((props: Input) => useStartTemplate(props), {
    initialProps: input,
  });
  expect(hook.result.current.configurationProblem).toContain("missing");
  hook.rerender({ ...input, serverId: "host-b", pending: null });
  expect(hook.result.current.configurationProblem).toBeNull();
  hook.rerender({
    ...input,
    pending: null,
    kind: "project",
    project: hostProjectFromRoute({
      serverId: "host-a",
      projectId: "project-b",
      sourceDirectory: "/project",
    }),
  });
  expect(hook.result.current.configurationProblem).toBeNull();
});

test("automatic Host changes clear a template's pending branch choice", () => {
  const input = fixture();
  input.kind = "project";
  input.project = hostProjectFromRoute({
    serverId: "host-a",
    projectId: "project-a",
    sourceDirectory: "/project",
  });
  input.worktreeSupport = "supported";
  input.pending!.template.target = {
    kind: "project",
    projectId: "project-a",
    workspace: { kind: "worktree", base: { kind: "ask" } },
  };
  const hook = renderHook((props: Input) => useStartTemplate(props), { initialProps: input });
  expect(input.setBaseRequired).toHaveBeenLastCalledWith(true);
  hook.rerender({ ...input, serverId: "host-b", pending: null });
  expect(input.setBaseRequired).toHaveBeenLastCalledWith(false);
});
