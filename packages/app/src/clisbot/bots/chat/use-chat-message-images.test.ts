// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { collectRetainedAttachmentIds } from "@/attachments/gc-retention";
import type { ChatMessage } from "../data/contracts";

const mocks = vi.hoisted(() => ({ persist: vi.fn() }));
vi.mock("@/attachments/service", () => ({ persistAttachmentFromDataUrl: mocks.persist }));
import { useChatMessageImages } from "./use-chat-message-images";

const line: ChatMessage = {
  id: "message:with/separators",
  seq: 1,
  at: "2026-09-28T00:00:00Z",
  sender: { kind: "user" },
  text: "Image",
  images: [{ mimeType: "image/png", data: "AAECAw==" }],
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("uses filesystem-safe previews and retains the exact saved IDs until unmount", async () => {
  mocks.persist.mockImplementation(async ({ id, mimeType }) => {
    // This is the desktop bridge's attachment-ID contract.
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid attachment id");
    return { id, mimeType, storageType: "desktop-file", storageKey: `/cache/${id}.png` };
  });
  const first = renderHook(() => useChatMessageImages("host:one", line));
  await waitFor(() => expect(first.result.current).toHaveLength(1));
  const id = first.result.current[0].id;
  expect(collectRetainedAttachmentIds().has(id)).toBe(true);

  const same = renderHook(() => useChatMessageImages("host:one", line));
  const other = renderHook(() => useChatMessageImages("host:two", line));
  await waitFor(() => expect(same.result.current).toHaveLength(1));
  await waitFor(() => expect(other.result.current).toHaveLength(1));
  expect(same.result.current[0].id).toBe(id);
  expect(other.result.current[0].id).not.toBe(id);
  first.unmount();
  expect(collectRetainedAttachmentIds().has(id)).toBe(true);
  same.unmount();
  expect(collectRetainedAttachmentIds().has(id)).toBe(false);
  other.unmount();
  expect(collectRetainedAttachmentIds().size).toBe(0);
});
