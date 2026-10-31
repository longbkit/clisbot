import { beforeEach, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => ({ entries: new Map<string, number>() }));

vi.mock("@/constants/platform", () => ({ isWeb: false, isNative: true }));
vi.mock("expo-file-system", () => {
  function join(parent: unknown, name: string): string {
    const base = typeof parent === "string" ? parent : (parent as { uri: string }).uri;
    return `${base}/${name}`;
  }
  class Directory {
    readonly uri: string;
    constructor(parent: unknown, name: string) {
      this.uri = join(parent, name);
    }
    get exists() {
      return [...disk.entries.keys()].some((path) => path.startsWith(`${this.uri}/`));
    }
    get size() {
      if (!this.exists) return null;
      let bytes = 0;
      for (const [path, size] of disk.entries) if (path.startsWith(`${this.uri}/`)) bytes += size;
      return bytes;
    }
    create() {}
    delete() {
      for (const path of disk.entries.keys())
        if (path.startsWith(`${this.uri}/`)) disk.entries.delete(path);
    }
  }
  class File {
    readonly uri: string;
    constructor(parent: unknown, name: string) {
      this.uri = join(parent, name);
    }
    get exists() {
      return disk.entries.has(this.uri);
    }
  }
  return { Directory, File, Paths: { cache: "file:///cache", document: "file:///docs" } };
});

import { clearDownloadedFiles, downloadTargetFile, downloadedFilesBytes } from "./downloaded-files";

beforeEach(() => {
  disk.entries.clear();
});

it("saves downloads in their own folder and never reuses a name", () => {
  disk.entries.set("file:///cache/clisbot-downloads/report.pdf", 10);

  expect(downloadTargetFile("report.pdf").uri).toBe(
    "file:///cache/clisbot-downloads/report (1).pdf",
  );
});

it("measures and removes only downloaded files", () => {
  disk.entries.set("file:///cache/clisbot-downloads/a.bin", 300);
  disk.entries.set("file:///cache/clisbot-downloads/b.bin", 200);
  disk.entries.set("file:///cache/other-cache.db", 9_000);

  expect(downloadedFilesBytes()).toBe(500);
  clearDownloadedFiles();

  expect(downloadedFilesBytes()).toBe(0);
  expect([...disk.entries.keys()]).toEqual(["file:///cache/other-cache.db"]);
});
