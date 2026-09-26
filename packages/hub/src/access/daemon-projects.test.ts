import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { embeddedDatabaseRuntime } from "../db/runtime/index.js";
import { createDatabase } from "../db/pg.js";
import type { Database } from "../db/types.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { enrollTestDaemon, TEST_DAEMON_ID } from "../test-utils/project-configuration.js";
import * as schema from "../db/schema.js";
import { replaceDaemonProjects } from "./daemon-projects.js";
import { AccessStore } from "./store.js";

const CREDENTIAL = "daemon-secret";

let root: string;
let bundle: Awaited<ReturnType<typeof embeddedDatabaseRuntime>>;
let database: Database;
let access: AccessStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hub-daemon-projects-"));
  bundle = await embeddedDatabaseRuntime(root);
  await bundle.runtime.migrate();
  await bundle.runtime.drizzle().insert(schema.organizations).values({
    id: "org",
    name: "Org",
    slug: "org",
  });
  database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
  await enrollTestDaemon(database, "org");
  await bundle.runtime
    .drizzle()
    .update(schema.daemons)
    .set({ credentialVerifier: createHash("sha256").update(CREDENTIAL).digest("base64url") });
  access = new AccessStore(bundle.runtime);
});

afterEach(async () => {
  await bundle.runtime.close();
  await rm(root, { recursive: true, force: true });
});

function publish(projects: unknown[]): Promise<Response> {
  return replaceDaemonProjects(
    new Request(`https://hub.example.test/api/daemons/${TEST_DAEMON_ID}/projects`, {
      method: "PUT",
      headers: { authorization: `Bearer ${CREDENTIAL}`, "content-type": "application/json" },
      body: JSON.stringify({ projects }),
    }),
    TEST_DAEMON_ID,
    database,
    access,
  );
}

it("accepts a Bot's Project marker and lists it on the project resource", async () => {
  const marker = { id: "bot_1", kind: "team" };
  const response = await publish([
    { projectId: "bot-home", name: "Ada", bot: marker },
    { projectId: "repo", name: "Website" },
  ]);
  expect(response.status).toBe(200);
  const projects = (await access.listResources("org")).filter(({ kind }) => kind === "project");
  expect(projects.map(({ name, bot }) => ({ name, bot }))).toEqual([
    { name: "Ada", bot: marker },
    { name: "Website", bot: undefined },
  ]);
  const stored = await access.listDaemonProjects("org", TEST_DAEMON_ID);
  expect(stored.find(({ projectId }) => projectId === "bot-home")?.metadata).toEqual({
    bot: marker,
  });
  expect(stored.find(({ projectId }) => projectId === "repo")?.metadata).toEqual({});
});

it("keeps the marker beside the catalogs and drops it when a later snapshot omits it", async () => {
  const terminalProfileCatalog = [{ id: "claude", name: "Claude Code" }];
  const bot = { id: "bot_1", kind: "personal" };
  await publish([{ projectId: "bot-home", name: "Ada", terminalProfileCatalog, bot }]);
  expect((await access.listDaemonProjects("org", TEST_DAEMON_ID))[0]?.metadata).toEqual({
    terminalProfileCatalog,
    bot,
  });
  await publish([{ projectId: "bot-home", name: "Ada", terminalProfileCatalog }]);
  const resource = (await access.listResources("org")).find(({ kind }) => kind === "project");
  expect(resource?.terminalProfileCatalog).toEqual(terminalProfileCatalog);
  expect(resource).not.toHaveProperty("bot");
});

it("rejects a marker it cannot read, as the body schema is strict", async () => {
  expect((await publish([{ projectId: "p", name: "P", bot: { id: "bot_1" } }])).status).toBe(400);
  expect(
    (await publish([{ projectId: "p", name: "P", bot: { id: "bot_1", kind: "swarm" } }])).status,
  ).toBe(400);
  expect(
    (await publish([{ projectId: "p", name: "P", bot: { id: "bot_1", kind: "team", x: 1 } }]))
      .status,
  ).toBe(400);
});
