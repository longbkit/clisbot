import assert from "node:assert/strict";
import { it } from "vitest";
import { connectionStatusSchema } from "./functions.js";

it("keeps provider readiness separate from connection inventory", () => {
  const status = connectionStatusSchema.parse({
    canManage: true,
    github: { status: "connected" },
    discord: { status: "connected" },
    slack: { status: "disconnected" },
    linear: { status: "disconnected" },
  });
  assert.deepEqual(status, {
    canManage: true,
    github: { status: "connected" },
    discord: { status: "connected" },
    slack: { status: "disconnected" },
    linear: { status: "disconnected" },
  });
});
