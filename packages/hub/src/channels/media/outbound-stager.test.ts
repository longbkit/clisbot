import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createChannelMediaStager } from "./outbound-stager.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function createStagingRoot() {
  const directory = await mkdtemp(path.join(tmpdir(), "channel-stage-"));
  roots.push(directory);
  return directory;
}
it("stages a Host-only file URL in order and cleans the staged copy", async () => {
  const stagingRoot = await createStagingRoot();
  const stage = createChannelMediaStager({
    channel: "slack",
    stagingRoot,
    readLocalFile: async function* (file) {
      expect(file).toBe("/host-only/generated image.png");
      yield Buffer.from("first");
      yield Buffer.from("second");
    },
  });
  const file = await stage({
    media: "file:///host-only/generated%20image.png",
    fileName: "../../safe.png",
  });
  expect(file.fileName).toBe("safe.png");
  expect(await readFile(file.filePath, "utf8")).toBe("firstsecond");
  await file.release?.();
  expect(await readdir(stagingRoot)).toEqual([]);
});
it("cleans partial data on a Host disconnect and never tries a Hub-local read", async () => {
  const stagingRoot = await createStagingRoot();
  const stage = createChannelMediaStager({
    channel: "slack",
    stagingRoot,
    readLocalFile: async function* () {
      yield Buffer.from("partial");
      throw new Error("host_not_connected");
    },
  });
  await expect(stage({ media: "/host-only/image.png" })).rejects.toThrow("host_not_connected");
  expect(await readdir(stagingRoot)).toEqual([]);
  await expect(
    createChannelMediaStager({ channel: "slack" })({ media: "/etc/hosts" }),
  ).rejects.toThrow("Host file transfer is unavailable");
});
