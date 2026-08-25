import { expect, type Page } from "@playwright/test";

export class ProjectNavigation {
  constructor(private readonly page: Page) {}

  async expectProjects() {
    await expect(this.page.getByRole("heading", { name: "Projects" })).toBeVisible();
  }

  async openProject(name: string) {
    await this.page.getByRole("link", { name }).click();
    await expect(this.page.getByRole("heading", { name: "Overview" })).toBeVisible();
  }

  async openOrganizationSection(
    name: "Projects" | "Daemons" | "Connections" | "Team" | "API keys" | "Usage" | "Billing",
  ) {
    await this.page
      .getByRole("navigation", { name: "Organization" })
      .getByRole("link", { name })
      .click();
  }

  async openProjectSection(name: "Overview" | "Configuration" | "Activity" | "Settings") {
    await this.page
      .getByRole("navigation", { name: "Project" })
      .getByRole("link", { name })
      .click();
  }

  async openMobileProjectSection(name: "Overview" | "Configuration" | "Activity" | "Settings") {
    await this.page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await this.openProjectSection(name);
  }

  async openMobileOrganizationSection(
    name: "Projects" | "Daemons" | "Connections" | "Team" | "API keys" | "Usage" | "Billing",
  ) {
    await this.page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await this.openOrganizationSection(name);
  }

  async switchProject(name: string) {
    await this.page.getByRole("button", { name: "Project", exact: true }).click();
    await this.page.getByRole("menuitem", { name, exact: true }).click();
  }

  async expectBreadcrumb(...parts: string[]) {
    const breadcrumb = this.page.getByRole("navigation", { name: "Breadcrumb" });
    for (const part of parts)
      await expect(breadcrumb.getByText(part, { exact: true })).toBeVisible();
  }

  async organizationHref(name: string) {
    await this.page.getByRole("button", { name: "Organization" }).click();
    const href = await this.page.getByRole("menuitem", { name, exact: true }).getAttribute("href");
    await this.page.keyboard.press("Escape");
    expect(href).not.toBeNull();
    return href!;
  }

  async visit(path: string) {
    await this.page.goto(new URL(path, this.page.url()).toString());
  }

  async createOrganizationLandingHint(name: string) {
    await this.page.getByRole("button", { name: "Organization", exact: true }).click();
    await this.page.getByRole("menuitem", { name: "New organization" }).click();
    const form = this.page.getByRole("form", { name: "Create organization" });
    await form.getByLabel("Organization name").fill(name);
    await form.getByRole("button", { name: "Create organization" }).click();
    await expect(
      this.page.getByRole("button", { name: "Organization", exact: true }),
    ).toContainText(name);
  }

  async proveDeepLinkAuthorityWithMismatchedLandingHint(organization: string, project: string) {
    const projectsPath = new URL(this.page.url()).pathname;
    await this.createOrganizationLandingHint("Orbit");
    await this.visit(`${projectsPath}/${project.toLowerCase()}/overview`);
    await this.expectBreadcrumb(organization, project, "Overview");
  }

  async expectUnavailable(kind: "Organization" | "Project") {
    await expect(this.page.getByRole("alert")).toContainText(`${kind} unavailable`);
  }
}
