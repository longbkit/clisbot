import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import { DeploymentProjects } from "./index.js";

describe("deployment projects", () => {
  it("lets an explicit project override the bundle name without creating either", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const explicit = await database.createProject({
      organizationId: "org",
      name: "Explicit",
      slug: "explicit",
      createdByUserId: null,
    });
    const projects = new DeploymentProjects(database);

    const result = await projects.resolve({
      organizationId: "org",
      explicitProjectSlug: "explicit",
      bundleName: "from-bundle",
      dryRun: false,
    });

    assert.equal(result.status, "resolved");
    if (result.status !== "resolved") return;
    assert.equal(result.project.id, explicit.id);
    assert.equal(result.created, false);
    assert.equal(await database.findProjectBySlugForOrganization("org", "from-bundle"), undefined);
  });

  it("reports a dry-run creation without writing it", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const projects = new DeploymentProjects(database);

    assert.deepEqual(
      await projects.resolve({ organizationId: "org", bundleName: "new-project", dryRun: true }),
      { status: "would_create", projectSlug: "new-project" },
    );
    assert.deepEqual(await database.listProjectsForOrganization("org"), []);
  });

  it("upserts the default project when no target is supplied", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const projects = new DeploymentProjects(database);

    const result = await projects.resolve({ organizationId: "org", dryRun: false });

    assert.equal(result.status, "resolved");
    if (result.status !== "resolved") return;
    assert.equal(result.project.slug, "default");
    assert.equal(result.created, true);
  });

  it("restores an archived implicit target instead of colliding with its slug", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const archived = await database.createProject({
      organizationId: "org",
      name: "Default",
      slug: "default",
      createdByUserId: null,
    });
    await database.archiveProject("org", archived.id, "user");
    const projects = new DeploymentProjects(database);

    const result = await projects.resolve({ organizationId: "org", dryRun: false });

    assert.equal(result.status, "resolved");
    if (result.status !== "resolved") return;
    assert.equal(result.project.id, archived.id);
    assert.equal(result.project.status, "active");
    assert.equal(result.created, false);
  });

  it("scopes identical names to their organizations", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org-a", "org-b"] });
    const projects = new DeploymentProjects(database);

    const [left, right] = await Promise.all([
      projects.resolve({ organizationId: "org-a", bundleName: "shared", dryRun: false }),
      projects.resolve({ organizationId: "org-b", bundleName: "shared", dryRun: false }),
    ]);

    assert.equal(left.status, "resolved");
    assert.equal(right.status, "resolved");
    if (left.status !== "resolved" || right.status !== "resolved") return;
    assert.notEqual(left.project.id, right.project.id);
  });

  it("serializes concurrent first deployments to one project", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const projects = new DeploymentProjects(database);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        projects.resolve({ organizationId: "org", bundleName: "racing", dryRun: false }),
      ),
    );

    assert.ok(results.every((result) => result.status === "resolved"));
    assert.equal(
      results.filter((result) => result.status === "resolved" && result.created).length,
      1,
    );
    assert.deepEqual(
      (await database.listProjectsForOrganization("org")).map(({ slug }) => slug),
      ["racing"],
    );
  });
});
