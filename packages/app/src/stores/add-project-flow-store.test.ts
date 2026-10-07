import { expect, it } from "vitest";
import { useAddProjectFlowStore } from "./add-project-flow-store";
import { openAddProjectFlow } from "@/add-project-flow/model";

it("keeps the active folder through a layout remount and discards it on close or another request", () => {
  const store = useAddProjectFlowStore;
  store.getState().open("host");
  const id = store.getState().request!.id;
  const draft = {
    state: openAddProjectFlow({ hosts: [] }),
    browsing: true,
    browseInput: "/workspace/research/",
  };
  store.getState().saveDraft(id, draft);
  expect(store.getState().draft).toEqual(draft);
  store.getState().close();
  store.getState().saveDraft(id, draft);
  expect(store.getState().draft).toBeNull();
  store.getState().open("another-host");
  store.getState().saveDraft(id, draft);
  expect(store.getState().draft).toBeNull();
  store.getState().close();
});
