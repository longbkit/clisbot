import { expect, test } from "vitest";
import { conversationFilePath } from "./source-file-path";
import { applyFileMentionReplacement } from "@/utils/file-mention-autocomplete";
import { resolveWorkspaceFileDrop } from "@/attachments/workspace-file-drag";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";
test("file drop keeps source and line selection when the selected bot later changes", () => {
  const file = resolveWorkspaceFileDrop({
    serverId: "host",
    workspaceId: "a",
    payload: {
      version: 1,
      serverId: "host",
      workspaceId: "a",
      attachment: createWorkspaceFileAttachment({
        path: "src/app.ts",
        selection: { kind: "line_range", startLine: 2, endLine: 5 },
      }),
    },
    resolvePath: (path) => conversationFilePath("/alpha", path),
  });
  expect(file).toMatchObject({
    path: "/alpha/src/app.ts",
    selection: { startLine: 2, endLine: 5 },
  });
  expect(conversationFilePath("/beta", file!.path)).toBe("/alpha/src/app.ts");
});
test("file mention captures absolute source path at insertion and escapes names", () => {
  expect(
    applyFileMentionReplacement({
      text: "@src",
      mention: { start: 0, end: 4, query: "src" },
      relativePath: conversationFilePath("/alpha", "src/file.ts"),
    }),
  ).toBe('"/alpha/src/file.ts"');
  expect(conversationFilePath("C:\\bot", "src/file.ts")).toBe("C:\\bot/src/file.ts");
  expect(conversationFilePath("/beta", "C:\\bot\\file.ts")).toBe("C:\\bot\\file.ts");
});
