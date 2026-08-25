import { expect, type Page } from "@playwright/test";

export class ProjectConnections {
  constructor(private readonly page: Page) {}

  async connectGitHub() {
    await this.page.getByRole("button", { name: "Connect GitHub" }).click();
    await expect(this.page.getByRole("heading", { name: "Connections", level: 1 })).toBeVisible();
    await expect(this.page.getByRole("cell", { name: /acme-inc.*installation/u })).toBeVisible();
  }
}
