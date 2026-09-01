import { expect, type Page } from "@playwright/test";

export type OrganizationSection = "Triggers" | "Activity" | "Daemons" | "Connections" | "Settings";
export type OrganizationSettingsSection = "Team" | "API keys" | "Usage" | "Billing";
export type ProjectSection = "Overview" | "Configuration" | "Activity" | "Settings";
export type InstanceSection = "Apps" | "Operator";

export class ProjectNavigation {
  constructor(private readonly page: Page) {}

  async expectProjects() {
    await expect(this.page.getByRole("heading", { name: "Projects" })).toBeVisible();
  }

  async openProject(name: string) {
    await this.page.getByRole("link", { name }).click();
    await expect(this.page.getByRole("heading", { name: "Overview" })).toBeVisible();
  }

  async openOrganizationSection(name: OrganizationSection) {
    await this.page
      .getByRole("navigation", { name: "Organization", exact: true })
      .getByRole("link", { name })
      .click();
  }

  /** Administration is two hops now: the Settings entry, then the section's tab. */
  async openOrganizationSettings(name: OrganizationSettingsSection) {
    await this.openOrganizationSection("Settings");
    await this.page
      .getByRole("navigation", { name: "Organization settings" })
      .getByRole("link", { name })
      .click();
  }

  async openProjectSection(name: ProjectSection) {
    await this.page
      .getByRole("navigation", { name: "Project", exact: true })
      .getByRole("link", { name })
      .click();
  }

  /** The project sidebar's way back out to organization scope. */
  async leaveProject() {
    await this.page
      .getByRole("navigation", { name: "Project", exact: true })
      .getByRole("link", { name: "All projects" })
      .click();
  }

  /**
   * Instance administration is outside the organization → project chain, so it is not in the
   * sidebar body at all: it enters through the footer account menu, which the signed-in email
   * names. Entering lands on the first instance destination; the section is then picked there.
   */
  async openInstanceSection(account: string, name: InstanceSection) {
    await this.enterInstanceScope(account);
    await this.instanceNav().getByRole("link", { name, exact: true }).click();
  }

  async openMobileInstanceSection(account: string, name: InstanceSection) {
    await this.toggleMobileSidebar();
    await this.enterInstanceScope(account);
    // Leaving for the instance dismisses the drawer, the way a sidebar destination does, so the
    // section has to be picked from a reopened one.
    await expect(this.page.getByRole("dialog", { name: "Sidebar" })).toBeHidden();
    await this.toggleMobileSidebar();
    await this.instanceNav().getByRole("link", { name, exact: true }).click();
  }

  /**
   * The instance sidebar's way back out. Instance routes carry no tenant, so the row is named
   * after the organization the account is active in rather than one in the path.
   */
  async leaveInstance() {
    await this.instanceNav()
      .getByRole("link", { name: /^Back to / })
      .click();
  }

  /** The footer account menu — everything that belongs to the person, not to a tenant. */
  async openAccountMenu(account: string) {
    await this.page.getByRole("button", { name: account }).click();
    const menu = this.page.getByRole("menu");
    await expect(menu).toBeVisible();
    return menu;
  }

  private async enterInstanceScope(account: string) {
    const menu = await this.openAccountMenu(account);
    await menu.getByRole("menuitem", { name: "Instance administration" }).click();
    await expect(this.page).toHaveURL(/\/apps$/u);
  }

  private instanceNav() {
    return this.page.getByRole("navigation", { name: "Instance", exact: true });
  }

  private async toggleMobileSidebar() {
    await this.page.getByRole("button", { name: "Toggle Sidebar" }).click();
  }

  async openMobileProjectSection(name: ProjectSection) {
    await this.toggleMobileSidebar();
    await this.openProjectSection(name);
  }

  async openMobileOrganizationSection(name: OrganizationSection) {
    await this.toggleMobileSidebar();
    await this.openOrganizationSection(name);
  }

  async openMobileOrganizationSettings(name: OrganizationSettingsSection) {
    await this.toggleMobileSidebar();
    await this.openOrganizationSettings(name);
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
