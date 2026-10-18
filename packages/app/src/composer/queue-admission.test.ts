import { queueEditRevision } from "./queue-edit-revision";
import { expect, test } from "vitest";
import { submitAgentInput, submitOneOffInput } from "./submit";

test("a queue draft is retained while Host acceptance is pending, then cleared after ack", async () => {
  let accept!: () => void;
  const pending = new Promise<void>((resolve) => {
    accept = resolve;
  });
  const effects: string[] = [];
  const task = submitAgentInput({
    message: "next",
    attachments: [],
    isAgentRunning: true,
    canSubmit: true,
    queueMessage: () => pending,
    submitMessage: async () => {
      throw new Error("Wrong owner");
    },
    clearDraft: () => {},
    setUserInput: (text) => effects.push(`text:${text}`),
    setAttachments: () => effects.push("attachments"),
    setSendError: () => {},
    setIsProcessing: () => {},
  });
  expect(effects).toEqual([]);
  accept();
  expect(await task).toBe("queued");
  expect(effects).toEqual(["text:", "attachments"]);
});
test("a failed Host write retains text and attachments with a recoverable error", async () => {
  const effects: string[] = [];
  const result = await submitAgentInput({
    message: "next",
    attachments: [
      {
        kind: "file",
        attachment: {
          type: "uploaded_file",
          id: "file",
          fileName: "file.txt",
          mimeType: "text/plain",
          size: 1,
          path: "/synthetic/file.txt",
        },
      },
    ],
    isAgentRunning: true,
    canSubmit: true,
    queueMessage: async () => {
      throw new Error("disk full");
    },
    submitMessage: async () => {},
    clearDraft: () => {},
    setUserInput: () => effects.push("text cleared"),
    setAttachments: () => effects.push("attachments cleared"),
    setSendError: (error) => effects.push(String(error)),
    setIsProcessing: () => {},
  });
  expect(result).toBe("failed");
  expect(effects).toEqual(["disk full"]);
});

for (const action of ["queue", "steer"] as const) {
  test(`one-off ${action} selects only that owner, including attachment-only input`, async () => {
    const calls: string[] = [];
    expect(
      await submitOneOffInput({
        action,
        editing: false,
        message: "",
        attachments: [{ id: "file" }],
        queue: async () => {
          calls.push("queue");
        },
        steer: async () => {
          calls.push("steer");
        },
      }),
    ).toBe(action === "queue" ? "queued" : "submitted");
    expect(calls).toEqual([action]);
  });
  test(`one-off ${action} cannot dispatch from a queue editor`, async () => {
    const calls: string[] = [];
    expect(
      await submitOneOffInput({
        action,
        editing: true,
        message: "Local edit",
        attachments: [],
        queue: async () => {
          calls.push("queue");
        },
        steer: async () => {
          calls.push("steer");
        },
      }),
    ).toBe("noop");
    expect(calls).toEqual([]);
  });
}

test("an earlier item leaving only changes position; changed or claimed original conflicts", () => {
  const original = { id: "editing", text: "original", state: "queued" as const, createdAt: "now" };
  const fingerprint = JSON.stringify(original);
  expect(queueEditRevision(original.id, fingerprint, { revision: 3, items: [original] })).toBe(3);
  for (const items of [
    [],
    [{ ...original, text: "other device" }],
    [{ ...original, state: "sending" as const }],
  ])
    expect(queueEditRevision(original.id, fingerprint, { revision: 4, items })).toBeNull();
});
