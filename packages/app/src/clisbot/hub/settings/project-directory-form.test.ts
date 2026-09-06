import { describe, expect, it } from "vitest";
import { openProjectDirectoryForm } from "./project-directory-form";

describe("Project working directory", () => {
  it("waits for the selected Project root before defaulting the directory", () => {
    const form = openProjectDirectoryForm({ projectId: null, cwd: "" });
    form.selectProject("project-a");
    form.applyRoot("project-a", null);
    expect(form.getState()).toEqual({
      projectId: "project-a",
      rootPath: null,
      cwd: "",
      mode: "project",
    });

    form.applyRoot("project-a", "/work/project-a");
    expect(form.getState()).toEqual({
      projectId: "project-a",
      rootPath: "/work/project-a",
      cwd: "/work/project-a",
      mode: "project",
    });
  });

  it("preserves a saved custom directory while the root is unavailable and after it loads", () => {
    const form = openProjectDirectoryForm({
      projectId: "project-a",
      cwd: "/work/project-a/services/api",
    });
    form.applyRoot("project-a", null);
    expect(form.getState()).toMatchObject({
      cwd: "/work/project-a/services/api",
      mode: "preserve",
    });

    form.applyRoot("project-a", "/work/project-a");
    expect(form.getState()).toMatchObject({
      cwd: "/work/project-a/services/api",
      mode: "custom",
    });
  });

  it("recognizes a saved root directory and follows later root changes", () => {
    const form = openProjectDirectoryForm({ projectId: "project-a", cwd: "/work/project-a" });
    form.applyRoot("project-a", "/work/project-a");
    expect(form.getState().mode).toBe("project");

    form.applyRoot("project-a", "/moved/project-a");
    expect(form.getState()).toMatchObject({
      rootPath: "/moved/project-a",
      cwd: "/moved/project-a",
      mode: "project",
    });
  });

  it("keeps the user's custom choice when directory data changes or temporarily disappears", () => {
    const form = openProjectDirectoryForm({ projectId: "project-a", cwd: "" });
    form.applyRoot("project-a", "/work/project-a");
    form.setCustomDirectory(true);
    form.setCwd("/work/project-a/services/api");
    form.applyRoot("project-a", null);
    form.applyRoot("project-a", "/moved/project-a");

    expect(form.getState()).toMatchObject({
      rootPath: "/moved/project-a",
      cwd: "/work/project-a/services/api",
      mode: "custom",
    });
  });

  it("clears the previous directory when selecting another Project and ignores its late root", () => {
    const form = openProjectDirectoryForm({ projectId: "project-a", cwd: "/work/project-a/api" });
    form.applyRoot("project-a", "/work/project-a");
    form.selectProject("project-b");
    form.applyRoot("project-a", "/late/project-a");

    expect(form.getState()).toEqual({
      projectId: "project-b",
      rootPath: null,
      cwd: "",
      mode: "project",
    });
    form.applyRoot("project-b", "/work/project-b");
    expect(form.getState().cwd).toBe("/work/project-b");
    form.selectProject("project-a");
    expect(form.getState().cwd).toBe("");
    form.applyRoot("project-a", "/work/project-a");
    expect(form.getState().cwd).toBe("/work/project-a");
  });

  it("returns to the current Project root when custom mode is disabled", () => {
    const form = openProjectDirectoryForm({ projectId: "project-a", cwd: "/work/project-a/api" });
    form.applyRoot("project-a", "/work/project-a");
    form.setCustomDirectory(false);
    expect(form.getState()).toMatchObject({ cwd: "/work/project-a", mode: "project" });

    form.setCustomDirectory(true);
    form.setCwd("/work/project-a/other");
    form.applyRoot("project-a", null);
    form.setCustomDirectory(false);
    expect(form.getState()).toMatchObject({ cwd: "", rootPath: null, mode: "project" });
    form.applyRoot("project-a", "/moved/project-a");
    expect(form.getState().cwd).toBe("/moved/project-a");
  });

  it("keeps custom input entered before the Project root arrives", () => {
    const form = openProjectDirectoryForm({ projectId: "project-a", cwd: "" });
    form.setCustomDirectory(true);
    form.setCwd("/work/project-a/api");
    form.applyRoot("project-a", "/work/project-a");
    form.selectProject("project-a");

    expect(form.getState()).toMatchObject({ cwd: "/work/project-a/api", mode: "custom" });
  });
});
