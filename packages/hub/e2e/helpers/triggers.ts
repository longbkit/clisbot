import { expect, type Page } from "@playwright/test";

export class OrganizationTriggers {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.getByRole("link", { name: "Triggers", exact: true }).click();
    await this.page.reload();
    await expect(this.page.getByRole("heading", { name: "Triggers", level: 1 })).toBeVisible();
  }

  async expectEmpty() {
    await expect(this.page.getByText("No triggers", { exact: true })).toBeVisible();
  }

  async startNew() {
    await this.page.getByRole("link", { name: "New trigger" }).click();
    await expect(this.page).toHaveURL(/\/triggers\/new$/u);
    await expect(this.page.getByRole("heading", { name: "New trigger", level: 1 })).toBeVisible();
    await expect(this.page.getByRole("heading", { name: "Trigger details" })).toBeVisible();
    await expect(this.page.getByRole("heading", { name: "Event & access" })).toBeVisible();
    await expect(this.page.getByRole("heading", { name: "Run target" })).toBeVisible();
    await expect(this.page.getByRole("heading", { name: "Agent & instructions" })).toBeVisible();
    const topbar = this.page.locator("header.sticky");
    await expect(topbar.getByRole("button", { name: "Form" })).toBeEnabled();
    await expect(topbar.getByRole("button", { name: "YAML" })).toBeVisible();
    await expect(topbar.getByRole("button", { name: "Discard" })).toBeVisible();
    await expect(this.page.getByLabel("Trigger ID")).toHaveValue("Assigned when saved");
  }

  async configureSlackMention(input: {
    name: string;
    connection: string;
    daemon: string;
    cwd: string;
    users: string;
    agent: string;
    mode: string;
    providerOptions: string;
    prompt: string;
  }) {
    await this.page.getByLabel("Trigger name").fill(input.name);
    await this.page.getByLabel("When this happens").selectOption("slack.mention");
    await this.page.getByLabel("Connection", { exact: true }).selectOption(input.connection);
    await this.page.getByRole("button", { name: "Specific people" }).click();
    await this.page.getByLabel("User IDs").fill(input.users);
    await this.page.getByLabel("Run on daemon").selectOption(input.daemon);
    await this.page.getByLabel("Working directory").fill(input.cwd);
    await this.page.getByLabel("Agent ID", { exact: true }).fill(input.agent);
    await this.page.getByLabel("Execution mode", { exact: true }).fill(input.mode);
    await this.page
      .locator("summary")
      .filter({ hasText: "Advanced provider options (JSON)" })
      .click();
    await this.page.getByLabel("Advanced provider options (JSON)").fill(input.providerOptions);
    await this.page.getByLabel("Instructions", { exact: true }).fill(input.prompt);
  }

  async configureManual(input: {
    name: string;
    daemon: string;
    cwd: string;
    agent: string;
    prompt: string;
  }) {
    await this.page.getByLabel("Trigger name").fill(input.name);
    await this.page.getByLabel("When this happens").selectOption("manual.run");
    await this.page.getByLabel("Run on daemon").selectOption(input.daemon);
    await this.page.getByLabel("Working directory").fill(input.cwd);
    await this.page.getByLabel("Agent ID", { exact: true }).fill(input.agent);
    await this.page.getByLabel("Instructions", { exact: true }).fill(input.prompt);
  }

  async switchToYaml() {
    await this.page.getByRole("button", { name: "YAML" }).click();
    await expect(this.yamlEditor()).toBeVisible();
  }

  async switchToForm() {
    await this.page.getByRole("button", { name: "Form" }).click();
    await expect(this.page.getByLabel("Agent ID", { exact: true })).toBeVisible();
  }

  async replaceYaml(yaml: string) {
    await this.yamlEditor().fill(yaml);
  }

  async save(name: string) {
    await this.page
      .locator("#trigger-editor-form")
      .getByRole("button", { name: /Create trigger|Save changes|Save YAML/u })
      .click();
    await expect(this.page).toHaveURL(/\/triggers$/u);
    await expect(this.page.getByRole("link", { name, exact: true })).toBeVisible();
  }

  async openTrigger(name: string) {
    await this.page.getByRole("link", { name, exact: true }).click();
    await expect(this.page).toHaveURL(/\/triggers\/[^/]+$/u);
    await expect(this.page.getByRole("heading", { name, level: 1 })).toBeVisible();
  }

  async expectFormAgent(input: {
    agent: string;
    mode: string;
    providerOptions: string;
    prompt: string;
  }) {
    await expect(this.page.getByLabel("Agent ID", { exact: true })).toHaveValue(input.agent);
    await expect(this.page.getByLabel("Execution mode", { exact: true })).toHaveValue(input.mode);
    await this.page
      .locator("summary")
      .filter({ hasText: "Advanced provider options (JSON)" })
      .click();
    await expect(this.page.getByLabel("Advanced provider options (JSON)")).toHaveValue(
      input.providerOptions,
    );
    await expect(this.page.getByLabel("Instructions", { exact: true })).toHaveValue(input.prompt);
  }

  async changePrompt(prompt: string) {
    await this.page.getByLabel("Instructions", { exact: true }).fill(prompt);
  }

  async expectMergeTagsAndAutosizing() {
    const instructions = this.page.getByLabel("Instructions", { exact: true });
    await instructions.fill("Start  finish");
    await instructions.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(6, 6));
    await this.page.getByRole("button", { name: "${{ paseo.prompt }}", exact: true }).click();
    await expect(instructions).toHaveValue("Start ${{ paseo.prompt }} finish");
    await instructions.fill(
      Array.from({ length: 24 }, (_, index) => `Line ${index + 1}`).join("\n"),
    );
    const sizing = await instructions.evaluate((element: HTMLTextAreaElement) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(sizing.clientHeight).toBeGreaterThan(300);
    expect(sizing.clientHeight).toBeGreaterThanOrEqual(sizing.scrollHeight - 2);
  }

  async expectYamlContains(...fragments: string[]) {
    for (const fragment of fragments) await expect(this.yamlEditor()).toContainText(fragment);
  }

  async expectLegacyReadOnly() {
    await expect(this.page.getByRole("alert")).toContainText("Legacy multi-step workflow");
    await expect(this.page.getByRole("alert")).toContainText("remains runnable");
    await expect(this.page.getByRole("button", { name: "Form" })).toBeDisabled();
    await expect(this.yamlEditor()).toHaveAttribute("contenteditable", "false");
    await expect(this.page.getByRole("button", { name: "Save changes" }).first()).toBeDisabled();
  }

  async expectOperationalList(name: string) {
    const row = this.page.getByRole("button").filter({ hasText: name });
    await expect(row.getByLabel("slack provider")).toBeVisible();
    await expect(row).toContainText("Never");
  }

  async capture(path: string) {
    await this.page.screenshot({ path });
  }

  async captureInstructions(path: string) {
    await this.page.getByLabel("Instructions", { exact: true }).scrollIntoViewIfNeeded();
    await this.page.screenshot({ path });
  }

  private yamlEditor() {
    return this.page.getByRole("textbox", { name: "Trigger YAML" });
  }
}
