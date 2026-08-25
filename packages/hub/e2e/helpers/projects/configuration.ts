import { expect, type Page } from "@playwright/test";
import { load } from "js-yaml";

const BASELINE_WORKFLOW_PATH = ".paseo/workflows/baseline.yml";
/**
 * A save is a round trip plus a refetch, so its budget is a server's, not a rendered locator's.
 * This is the command waiting for its own completion — nothing else waits on a save.
 */
const ACTIVATION_TIMEOUT_MS = 30_000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export class ProjectConfiguration {
  constructor(private readonly page: Page) {}

  async useRepository(fullName: string) {
    await this.page.getByRole("link", { name: "Configuration" }).click();
    const githubMode = this.page.getByRole("radio", { name: "GitHub" });
    if ((await githubMode.getAttribute("aria-checked")) !== "true") await githubMode.click();
    await this.page.getByRole("combobox").click();
    await this.page.getByRole("option", { name: new RegExp(escapeRegExp(fullName)) }).click();
    await this.page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(this.page.getByRole("combobox")).toHaveText(fullName);
  }

  async switchToManual() {
    await this.page.getByRole("radio", { name: "Manual" }).click();
  }

  async switchToGitHub() {
    await this.page.getByRole("radio", { name: "GitHub" }).click();
  }

  /**
   * The source controls live in the editor's fixed left rail. A control wider
   * than the rail runs under the document pane instead of being reachable.
   */
  async expectSourceControlsClearOfTheEditor() {
    const picker = await this.page.getByRole("combobox").boundingBox();
    const document = await this.editor().boundingBox();
    if (picker === null || document === null) throw new Error("source controls are not rendered");
    expect(picker.x + picker.width).toBeLessThanOrEqual(document.x);
  }

  /** The open document. CodeMirror exposes its content as a textbox labelled by path. */
  private editor(label = "Configuration YAML") {
    return this.page.getByRole("textbox", { name: label });
  }

  private partialLabel(path: string) {
    return path.startsWith(".paseo/workflows/partials/")
      ? path
      : `.paseo/workflows/partials/${path}`;
  }

  private async startEditing() {
    const editing = this.page.getByText("Editing");
    const edit = this.page.getByRole("button", { name: "Edit", exact: true });
    // Switching the source to manual refetches the snapshot, so neither control is on the page
    // until it lands. Beyond that this waits on nothing: either the workbench is read-only and
    // this opens it, or an edit is already open and this is a no-op. It does not reason about a
    // previous save, because `save()` does not return until its activation has landed.
    await expect(edit.or(editing).first()).toBeVisible();
    if (await edit.isVisible()) await edit.click();
    await expect(editing).toBeVisible();
  }

  async saveManualConfiguration(rawYaml: string) {
    await this.startEditing();
    await this.editor().fill(rawYaml);
    if (
      (await this.page
        .getByRole("list", { name: "Configuration files" })
        .getByRole("button", { name: BASELINE_WORKFLOW_PATH, exact: true })
        .count()) === 0
    ) {
      await this.page.getByRole("button", { name: "Add workflow" }).click();
      await this.page.getByLabel("Workflow file name").fill("baseline.yml");
      await this.page.getByRole("button", { name: "Add", exact: true }).click();
      await this.editor().fill(baselineWorkflow(rawYaml));
    }
    await this.save();
  }

  /** Activate the open documents exactly as they are — the preserved switch-to-manual bundle. */
  async saveUnmodified() {
    await this.startEditing();
    await this.save();
  }

  /**
   * Save and activate, returning only once the save has actually finished.
   *
   * Finished is not "the click landed". An activation creates a revision, and the workbench is
   * keyed on it, so the editor remounts on the new revision some time after the mutation itself
   * resolved — and the operator's next edit belongs in that new mount, not in the one about to
   * be discarded. Owning the whole outcome here is what lets every other command stop guessing
   * whether a previous one is still settling.
   */
  async save() {
    const button = this.page.getByRole("button", { name: "Save and activate" });
    const activated = this.page.getByText(/^Configuration saved and activated as Revision \d+\.$/u);
    const refused = this.page.getByText("Configuration couldn't be activated");
    const unreachable = this.page.getByText("Hub did not receive the project action result", {
      exact: false,
    });
    await button.click();
    // The mutation reported one of its three outcomes.
    await expect(activated.or(refused).or(unreachable).first()).toBeVisible({
      timeout: ACTIVATION_TIMEOUT_MS,
    });
    if (!(await activated.isVisible())) return;
    // It activated, so the workbench is being replaced. Wait for the new one.
    await expect(this.page.getByRole("button", { name: "Edit", exact: true })).toBeVisible({
      timeout: ACTIVATION_TIMEOUT_MS,
    });
  }

  async openFile(name: string) {
    await this.page
      .getByRole("list", { name: "Configuration files" })
      .getByRole("button", { name, exact: true })
      .click();
  }

  async addPartial(path: string, content: string) {
    await this.startEditing();
    await this.page.getByRole("button", { name: "Add partial" }).click();
    await this.page.getByLabel("Partial path").fill(path);
    await this.page.getByRole("button", { name: "Add", exact: true }).click();
    await this.editor(this.partialLabel(path)).fill(content);
  }

  async addWorkflow(name: string, content: string) {
    await this.startEditing();
    await this.page.getByRole("button", { name: "Add workflow" }).click();
    await this.page.getByLabel("Workflow file name").fill(name);
    await this.page.getByRole("button", { name: "Add", exact: true }).click();
    await this.editor().fill(content);
  }

  async removePartial(path: string) {
    await this.startEditing();
    await this.page.getByRole("button", { name: `Remove ${path}` }).click();
  }

  async removeWorkflow(path: string) {
    await this.startEditing();
    await this.page.getByRole("button", { name: `Remove ${path}` }).click();
  }

  async expectReadOnlyEditor(yaml: string) {
    await expect(this.page.getByText("Read-only")).toBeVisible();
    await expect(this.editor()).toHaveAttribute("contenteditable", "false");
    await expect(this.editor()).toContainText(yaml);
  }

  async expectFiles(names: string[]) {
    await expect(
      this.page.getByRole("list", { name: "Configuration files" }).getByRole("button"),
    ).toHaveText(names);
  }

  async expectPartialContent(path: string, content: string) {
    await this.openFile(path);
    await expect(this.editor(this.partialLabel(path))).toContainText(content);
  }

  async expectHighlightedYaml() {
    await expect(this.page.locator(".cm-line span").first()).toBeVisible();
  }

  /** A rendered document line. CodeMirror gives lines no role of their own. */
  private line(text: string) {
    return this.page.locator(".cm-line").filter({ hasText: text });
  }

  /** Reach the end of a long document the way an operator does: wheel over it. */
  async scrollEditorToEnd() {
    await this.editor().hover();
    for (let tick = 0; tick < 20; tick += 1) await this.page.mouse.wheel(0, 600);
  }

  async expectLineOutOfSight(text: string) {
    await expect(this.line(text)).not.toBeInViewport();
  }

  async expectLineInSight(text: string) {
    await expect(this.line(text)).toBeInViewport();
  }

  async expectValidationError(message: string) {
    await expect(this.page.getByRole("alert")).toContainText(message);
  }

  async expectConfigurationActivated(version: number) {
    await expect(this.page.getByRole("status")).toHaveText(
      `Configuration saved and activated as Revision ${String(version)}.`,
    );
  }

  /**
   * Holds back the project refresh that follows the next save, so the activation's remount
   * lands well after the mutation itself resolved. Real instances do this under load; this makes
   * it deterministic, and it is the exact window a save command must not return inside.
   */
  async delayRefreshAfterNextSave(milliseconds: number) {
    let saved = false;
    let delayed = false;
    await this.page.route("**/_serverFn/**", async (route) => {
      const request = route.request();
      if (!saved && request.method() === "POST" && (request.postData() ?? "").includes("files")) {
        saved = true;
        await route.continue();
        return;
      }
      if (!saved || delayed) {
        await route.continue();
        return;
      }
      delayed = true;
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
      await route.fulfill({ response });
    });
  }

  async expectActiveRevision(version: number) {
    await this.page
      .getByRole("navigation", { name: "Project" })
      .getByRole("link", { name: "Configuration" })
      .click();
    await expect(this.page.getByText(`Revision ${version}`, { exact: true })).toBeVisible();
  }

  async expectNoPriorProjectFeedback(version: number, validationResource: string) {
    await expect(this.page.getByRole("status")).toHaveText("No active configuration.");
    await expect(this.page.getByRole("alert")).toHaveCount(0);
    await expect(this.page.getByText(`Revision ${String(version)}`, { exact: true })).toHaveCount(
      0,
    );
    await expect(this.page.getByText(validationResource)).toHaveCount(0);
  }

  async syncNow() {
    await this.page.getByRole("button", { name: "Sync now" }).click();
  }

  async expectInvalidPreserved(version: number) {
    await expect(this.page.getByText(`Revision ${version}`, { exact: true })).toBeVisible();
    await expect(this.page.getByRole("status")).toContainText(
      "Invalid revision; active revision preserved",
    );
  }
}

function baselineWorkflow(rawYaml: string): string {
  const raw = load(rawYaml);
  const environments = isRecord(raw) && isRecord(raw["environments"]) ? raw["environments"] : {};
  const environment = Object.keys(environments)[0] ?? "runner";
  return [
    "name: baseline",
    "on: manual.run",
    "max_runtime: 1h",
    "steps:",
    "  - id: work",
    `    environment: ${environment}`,
    "    max_runtime: 10m",
    "    idle_timeout: 1m",
    "    agent: { provider: test }",
    "    prompt: [{ text: baseline }]",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
