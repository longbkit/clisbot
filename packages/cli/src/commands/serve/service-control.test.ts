import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { requestServiceShutdown, startServiceControl } from "./service-control.js";

test("an OS operator stops only the recorded supervisor, without process signals", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "clisbot-service-control-"));
  const file = path.join(home, "control.json");
  let stopped = false;
  const server = await startServiceControl(file, () => {
    stopped = true;
  });
  try {
    await expect(requestServiceShutdown(file, process.pid + 1)).rejects.toThrow("preserved");
    expect(stopped).toBe(false);
    await requestServiceShutdown(file, process.pid);
    expect(stopped).toBe(true);
  } finally {
    await server.close();
    await rm(home, { recursive: true, force: true });
  }
});
