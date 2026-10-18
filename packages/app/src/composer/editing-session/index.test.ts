import { describe, expect, it } from "vitest";
import { ComposerEditingSession } from "./index";

function leaveLiveDraft(session: ComposerEditingSession) {
  session.captureForRemount({
    snapshot: { text: "Unpublished live draft", selection: { start: 4, end: 17 } },
    focused: true,
    replacementKey: "draft:applied",
  });
}

describe("composer editing remount handoff", () => {
  it("keeps live text and selection when remounting from an initial draft publication", () => {
    const session = new ComposerEditingSession();
    leaveLiveDraft(session);
    const handoff = session.takeHandoff({ kind: "initial", key: "draft:initial", text: "stale" });
    expect(handoff?.snapshot).toEqual({
      text: "Unpublished live draft",
      selection: { start: 4, end: 17 },
    });
    expect(handoff?.focused).toBe(true);
  });

  it("keeps local edits when the last applied replacement is still current", () => {
    const session = new ComposerEditingSession();
    leaveLiveDraft(session);
    const handoff = session.takeHandoff({
      kind: "replace",
      key: "draft:applied",
      text: "old replacement",
    });
    expect(handoff?.snapshot).toEqual({
      text: "Unpublished live draft",
      selection: { start: 4, end: 17 },
    });
  });

  it.each(["New explicit draft", ""])(
    "honors an explicit replacement made while the editor is absent: %j",
    (text) => {
      const session = new ComposerEditingSession();
      leaveLiveDraft(session);
      const handoff = session.takeHandoff({ kind: "replace", key: "draft:new", text });
      expect(handoff?.snapshot).toEqual({
        text,
        selection: { start: text.length, end: text.length },
      });
      expect(handoff?.focused).toBe(true);
      expect(session.takeHandoff({ kind: "replace", key: "draft:new", text })).toBeNull();
    },
  );
});

describe("local queue edit mutation ownership", () => {
  const editor = { targetKey: "target", id: "old", revision: 1, original: "original", stale: true };
  it("admits one mutation and retains one new admission ID across failed acknowledgements", () => {
    const session = new ComposerEditingSession();
    session.setQueueEdit(editor);
    const first = session.beginQueueMutation(editor)!;
    expect(session.beginQueueMutation(editor)).toBeNull();
    expect(session.queueAdmissionId(first, "same draft", () => "new-a")).toBe("new-a");
    session.finishQueueMutation(first);
    const retry = session.beginQueueMutation(editor)!;
    expect(session.queueAdmissionId(retry, "same draft", () => "new-b")).toBe("new-a");
    session.finishQueueMutation(retry);
    session.setQueueEdit({ ...editor });
    const deliberate = session.beginQueueMutation(session.getQueueEdit())!;
    expect(session.queueAdmissionId(deliberate, "same draft", () => "new-c")).toBe("new-c");
  });
  it("superseded editors reject late ownership and an old completion cannot unlock a newer mutation", () => {
    const session = new ComposerEditingSession();
    session.setQueueEdit(editor);
    const old = session.beginQueueMutation(editor)!;
    session.setQueueEdit({ ...editor, id: "newer" });
    expect(session.ownsQueueMutation(old)).toBe(false);
    session.finishQueueMutation(old);
    const current = session.beginQueueMutation(session.getQueueEdit())!;
    session.finishQueueMutation(old);
    expect(session.getQueueMutationPending()).toBe(true);
    expect(session.ownsQueueMutation(current)).toBe(true);
  });
});
