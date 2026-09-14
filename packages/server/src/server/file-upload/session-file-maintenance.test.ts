import { afterEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PagedJournal } from "../agent/session-storage/paged-journal.js";
import {
  attachSessionFiles,
  pruneSessionDrafts,
  type SessionMessageFiles,
} from "./session-files.js";
import { pruneStoredSessionDrafts } from "./session-file-maintenance.js";
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});
async function temporary() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "draft-maintenance-"));
  roots.push(directory);
  return directory;
}
async function draft(directory: string, id: string) {
  const location = path.join(directory, "uploads", id);
  await fs.mkdir(location, { recursive: true });
  await fs.writeFile(
    path.join(location, "upload.json"),
    JSON.stringify({ status: "draft", createdAt: "2020-01-01T00:00:00Z" }),
  );
  await fs.writeFile(path.join(location, "file.txt"), "keep linked bytes");
}
it("prunes expired drafts beyond10000 linked file IDs without deleting a crash-left linked draft", async () => {
  const directory = await temporary();
  const journal = new PagedJournal<SessionMessageFiles>(path.join(directory, "uploads", ".links"));
  for (let batch = 0; batch < 10; batch++) {
    await journal.append(
      Array.from({ length: 10 }, (__unused, index) => {
        const seq = batch * 10 + index + 1;
        return {
          seq,
          value: {
            version: 1 as const,
            clientMessageId: `m-${seq}`,
            imageDigests: [],
            files: Array.from({ length: 101 }, (_, fileIndex) => {
              const id = `file-${(seq - 1) * 101 + fileIndex}`;
              return {
                id,
                fileName: "file.txt",
                mimeType: "text/plain",
                size: 17,
                relativePath: path.join("uploads", id, "file.txt"),
              };
            }),
          },
        };
      }),
    );
  }
  await draft(directory, "file-10099");
  await draft(directory, "orphan");
  expect(await pruneSessionDrafts(directory)).toBe(1);
  expect(await fs.readFile(path.join(directory, "uploads", "file-10099", "file.txt"), "utf8")).toBe(
    "keep linked bytes",
  );
  expect(
    JSON.parse(
      await fs.readFile(path.join(directory, "uploads", "file-10099", "upload.json"), "utf8"),
    ).status,
  ).toBe("attached");
  await expect(fs.stat(path.join(directory, "uploads", "orphan"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it("maintenance visits temporary, archived and rollback-retained session folders", async () => {
  const directory = await temporary();
  const agentRoot = path.join(directory, "agents");
  const archived = path.join(agentRoot, "cwd", "archived");
  const rollback = path.join(agentRoot, "cwd", "rolled-back");
  await draft(archived, "old");
  await draft(rollback, "old");
  await draft(directory, "old");
  await fs.writeFile(
    path.join(archived, "session.json"),
    JSON.stringify({ archivedAt: "2020-01-01" }),
  );
  await fs.writeFile(`${rollback}.json`, "{}");
  const errors: unknown[] = [];
  await pruneStoredSessionDrafts({
    agentRoot,
    temporaryRoot: directory,
    onError: (error) => errors.push(error),
  });
  expect(errors).toEqual([]);
  for (const location of [directory, archived, rollback])
    await expect(fs.stat(path.join(location, "uploads", "old"))).rejects.toMatchObject({
      code: "ENOENT",
    });
});

it("reclaims an inline image draft after its canonical link write fails", async () => {
  const directory = await temporary();
  const original = PagedJournal.prototype.append;
  const append = vi
    .spyOn(PagedJournal.prototype, "append")
    .mockImplementation(function (this: PagedJournal<unknown>, entries) {
      if (this.directory.endsWith(path.join("uploads", ".links")))
        return Promise.reject(new Error("Injected ENOSPC while linking image"));
      return original.call(this, entries);
    });
  await expect(
    attachSessionFiles({
      directory,
      messageId: "failed-image",
      images: [
        { data: Buffer.from("orphaned image bytes").toString("base64"), mimeType: "image/png" },
      ],
      ownsUpload: () => false,
    }),
  ).rejects.toThrow("ENOSPC");
  append.mockRestore();
  const uploads = await fs.readdir(path.join(directory, "uploads"));
  const imageDirectory = uploads.find((entry) => entry.startsWith("image_"));
  expect(imageDirectory).toBeTruthy();
  expect(
    JSON.parse(
      await fs.readFile(path.join(directory, "uploads", imageDirectory!, "upload.json"), "utf8"),
    ).status,
  ).toBe("draft");
  expect(await pruneSessionDrafts(directory, Date.now() + 48 * 60 * 60 * 1000)).toBe(1);
  await expect(fs.stat(path.join(directory, "uploads", imageDirectory!))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
