import { expect, type Page } from "@playwright/test";

export class ProjectLifecycle {
  constructor(private readonly page: Page) {}

  async expectDefaultProject() {
    await expect(this.page.getByRole("link", { name: "Default" })).toBeVisible();
  }

  async create(name: string, slug: string) {
    await this.page.getByRole("button", { name: "New project" }).click();
    const form = this.page.getByRole("form", { name: "Create project" });
    await form.getByLabel("Project name").fill(name);
    await form.getByLabel("Project slug").fill(slug);
    await form.getByRole("button", { name: "Create project" }).click();
    await expect(this.page.getByRole("link", { name })).toBeVisible();
  }

  /** Archiving lives in project settings; the list is only for choosing a project. */
  async archive(name: string) {
    await this.page.getByRole("link", { name }).click();
    await this.page
      .getByRole("navigation", { name: "Project" })
      .getByRole("link", {
        name: "Settings",
      })
      .click();
    await this.page.getByRole("button", { name: "Archive project" }).click();
    await this.page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Archive project" })
      .click();
    // Back on the list, an archived project keeps its row and loses its link.
    const row = this.page
      .getByRole("list", { name: "Projects" })
      .getByRole("listitem")
      .filter({ hasText: name });
    await expect(row).toContainText("Archived");
    await expect(row.getByRole("link")).toHaveCount(0);
  }
}
