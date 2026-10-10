import { expect, test } from "@playwright/test";
import { SessionActorSchema } from "@clisbot/protocol/session-authorship";
import {
  loadDaemonClientConstructor,
  loadProtocolSchemas,
} from "../support/helpers/daemon-client-loader";

test("built daemon client loads after a fixture imports a protocol schema", async () => {
  expect(SessionActorSchema.parse({ kind: "user", id: "module-loading-fixture" }).id).toBe(
    "module-loading-fixture",
  );
  expect(typeof (await loadDaemonClientConstructor())).toBe("function");
  expect(await loadProtocolSchemas()).toHaveProperty("WSOutboundMessageSchema");
});
