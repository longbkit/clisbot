// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useQuickStartLibrary } from "./use-library";
import type { QuickStartInput } from "@clisbot/protocol/quick-starts/types";
vi.mock("expo-crypto", () => ({ randomUUID: () => "12345678-1234-1234-1234-123456789012" }));
vi.mock("@/constants/platform", () => ({ isWeb: false }));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: vi.fn(async () => true) }));
afterEach(cleanup);
const input: QuickStartInput = {
  name: "Triage",
  startingPrompt: "Original",
  visibility: "personal",
  target: { kind: "quickChat" },
  agent: { kind: "default" },
};
const seed = { id: "qs_0000000000000001", revision: 1, input };
function fixture() {
  let finish!: (value: unknown) => void;
  const refetch = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const source = { online: true, refetch } as unknown as Parameters<typeof useQuickStartLibrary>[0];
  const hook = renderHook(() => useQuickStartLibrary(source, () => input, vi.fn(), []));
  act(() => hook.result.current.setEdit(seed));
  return {
    ...hook,
    resolve: () =>
      finish({
        data: { items: [{ ...input, id: seed.id, revision: 2, startingPrompt: "Remote" }] },
      }),
  };
}
test("Load latest intentionally replaces the active draft with the current revision", async () => {
  const hook = fixture();
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.reload();
  });
  await act(async () => {
    hook.resolve();
    await pending;
  });
  expect(hook.result.current.edit).toMatchObject({
    revision: 2,
    input: { startingPrompt: "Remote" },
  });
});
test("a late Load latest response does not reopen a dismissed editor", async () => {
  const hook = fixture();
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.reload();
  });
  act(() => hook.result.current.setEdit(null));
  await act(async () => {
    hook.resolve();
    await pending;
  });
  expect(hook.result.current.edit).toBeNull();
  expect(hook.result.current.draft?.input.startingPrompt).toBe("Original");
});
test("reopening the same record is a new form and rejects the old reload response", async () => {
  const hook = fixture();
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.reload();
  });
  act(() => hook.result.current.setEdit(null));
  act(() =>
    hook.result.current.setEdit({ ...seed, input: { ...input, startingPrompt: "New draft" } }),
  );
  await act(async () => {
    hook.resolve();
    await pending;
  });
  expect(hook.result.current.edit?.input.startingPrompt).toBe("New draft");
});
