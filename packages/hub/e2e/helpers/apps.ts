import { expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { DaemonHandoffSurface } from "./daemon-handoff.js";

export type AppProvider = "GitHub" | "Slack" | "Discord" | "Linear";

export type AppStatus =
  | "Not set up"
  | "Verified"
  | "Connected"
  | "Action needed"
  | "Managed by environment";

/** The link each section offers into the provider's own portal, by its visible name. */
const PORTAL_LINKS: Readonly<Record<AppProvider, string>> = {
  GitHub: "Create a GitHub App",
  Slack: "Create a Slack app",
  Discord: "Discord developer portal",
  Linear: "Open Linear API applications",
};

const APP_SUMMARIES: Readonly<Record<AppProvider, string>> = {
  GitHub: "Reads issues and pull requests, and lets agents push.",
  Slack: "Reads mentions in your workspace and replies in the thread.",
  Discord: "Reads mentions in your server and replies in the thread.",
  Linear: "Starts project-scoped workflows from issues and posts outcomes back to Linear.",
};

/**
 * The credentials the fixture providers accept. Anything else is a genuine rejection.
 *
 * GitHub's webhook secret is deliberately not here: it belongs to event triggers, which only
 * exist on an HTTPS origin, so a test that wants it asks for it by name.
 */
export const WORKING_CREDENTIALS: Readonly<Record<AppProvider, Readonly<Record<string, string>>>> =
  {
    GitHub: {
      "App ID": "42",
      "App slug": "paseo",
      "Client ID": "client",
      "Client secret": "secret",
      "Private key": "fixture-private-key",
    },
    Discord: {
      "Application ID": "900",
      "Client Secret": "secret",
      "Bot token": "token",
    },
    Slack: {
      "App-level token": "xapp-browser-fixture",
      "Bot token": "xoxb-browser-fixture",
    },
    Linear: {
      "Client ID": "browser-linear-client",
      "Client Secret": "browser-linear-client-secret",
      "Webhook signing secret": "browser-linear-webhook-secret",
    },
  };

export const SLACK_WEBHOOK_CREDENTIALS = {
  "App ID": "browser-slack-app",
  "Client ID": "browser-slack-client",
  "Client Secret": "browser-slack-client-secret",
  "Signing Secret": "phase-zero-slack-webhook-secret",
} as const;

/** The one GitHub value that only exists once the origin can receive deliveries. */
export const GITHUB_EVENT_CREDENTIALS = { "Webhook secret": "phase-zero-webhook-secret" } as const;

/**
 * One provider's collapsible section. Everything is addressed by role and accessible name, so a
 * passing journey is also evidence that the section is reachable without sight or a pointer.
 */
export class AppSection {
  constructor(
    private readonly page: Page,
    readonly provider: AppProvider,
  ) {}

  private get root(): Locator {
    return this.page.locator(`[data-provider="${this.provider.toLowerCase()}"]`);
  }

  header(): Locator {
    return this.root.getByRole("button", { name: this.provider, exact: false }).first();
  }

  body(): Locator {
    return this.root.getByRole("region", { name: this.provider });
  }

  form(): Locator {
    return this.page.getByRole("form", { name: `Set up ${this.provider}` });
  }

  status(): Locator {
    return this.page.getByRole("status", { name: `${this.provider} status` });
  }

  async expectStatus(status: AppStatus): Promise<void> {
    await expect(this.header()).toContainText(status);
  }

  async expectCollapsed(): Promise<void> {
    await expect(this.header()).toHaveAttribute("aria-expanded", "false");
    await expect(this.body()).toBeHidden();
  }

  async expectExpanded(): Promise<void> {
    await expect(this.header()).toHaveAttribute("aria-expanded", "true");
    await expect(this.body()).toBeVisible();
  }

  async expectCompactHeaderLayout(): Promise<void> {
    const title = await this.header().getByText(this.provider, { exact: true }).boundingBox();
    const description = await this.header()
      .getByText(APP_SUMMARIES[this.provider], { exact: true })
      .boundingBox();
    const status = await this.header()
      .getByText(/^(?:Not set up|Verified|Connected|Action needed|Managed by environment)$/u)
      .boundingBox();
    expect(title).not.toBeNull();
    expect(description).not.toBeNull();
    expect(status).not.toBeNull();
    expect(description!.y).toBeGreaterThan(title!.y);
    expect(status!.y).toBeGreaterThan(description!.y);
    expect(status!.x).toBeLessThan(title!.x + 8);
  }

  /**
   * Everything the operator has to read or press has to fit inside the card it lives in. The
   * section body clips its own overflow, so a descendant that is too wide is silently cut off
   * instead of producing a page scrollbar — `documentElement.scrollWidth` says nothing about it.
   * Each candidate is measured by how far right its content actually reaches, which also catches
   * a block that fits only because it scrolls its own content out of sight.
   */
  async expectNothingClipped(): Promise<void> {
    const clipped = await this.root.evaluate((card) => {
      const edge = Math.min(card.getBoundingClientRect().right, window.innerWidth);
      const carriesContent = (node: Element): boolean =>
        node.matches("input, textarea, select, button, a, pre, img") ||
        [...node.childNodes].some(
          (child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim() !== "",
        );
      const cut: string[] = [];
      for (const node of card.querySelectorAll("*")) {
        if (node.getClientRects().length === 0 || !carriesContent(node)) continue;
        const rect = node.getBoundingClientRect();
        const hidden = Math.max(0, node.scrollWidth - node.clientWidth);
        const overflow = Math.round(rect.right + hidden - edge);
        if (overflow <= 1) continue;
        const text = (node.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 60);
        cut.push(`${node.tagName.toLowerCase()} +${overflow}px "${text}"`);
      }
      return cut;
    });
    expect(clipped, `${this.provider} content cut off at the section edge`).toEqual([]);
  }

  async expand(): Promise<void> {
    await expect(this.page.getByLabel("Loading your apps")).toHaveCount(0);
    if ((await this.header().getAttribute("aria-expanded")) === "true") return;
    await this.header().click();
    await this.expectExpanded();
  }

  async collapse(): Promise<void> {
    await expect(this.page.getByLabel("Loading your apps")).toHaveCount(0);
    if ((await this.header().getAttribute("aria-expanded")) === "false") return;
    await this.header().click();
    await this.expectCollapsed();
  }

  /** Toggling never steals focus: the operator stays on the control they pressed. */
  async toggleFromKeyboard(): Promise<void> {
    await this.header().focus();
    await this.page.keyboard.press("Enter");
    await expect(this.header()).toBeFocused();
  }

  async fill(values: Readonly<Record<string, string>>): Promise<void> {
    for (const [label, value] of Object.entries(values)) {
      await this.form().getByLabel(label, { exact: true }).fill(value);
    }
  }

  async fillWorkingCredentials(): Promise<void> {
    await this.fill(WORKING_CREDENTIALS[this.provider]);
  }

  async value(label: string): Promise<string> {
    return await this.form().getByLabel(label, { exact: true }).inputValue();
  }

  action(name: string): Locator {
    return this.body().getByRole("button", { name, exact: true });
  }

  async save(): Promise<void> {
    await this.body()
      .getByRole("button", {
        name:
          this.provider === "Slack"
            ? /^(?:Connect Slack|Save and continue to Slack)$/u
            : this.provider === "Linear"
              ? "Save and continue to Linear"
              : "Verify and save",
      })
      .click();
  }

  async chooseSlackTransport(transport: "Socket Mode" | "Webhooks"): Promise<void> {
    await this.body().getByRole("radio", { name: transport }).check();
  }

  /** Presses a copy control and reads back what actually reached the clipboard. */
  async copiedValue(label: string): Promise<string> {
    await this.body()
      .getByRole("button", { name: `Copy ${label}`, exact: true })
      .click();
    return await this.page.evaluate(() => navigator.clipboard.readText());
  }

  /** The Slack manifest block, whose control carries its own visible label. */
  async copiedManifest(): Promise<string> {
    await this.body().getByRole("button", { name: "Copy manifest", exact: true }).click();
    return await this.page.evaluate(() => navigator.clipboard.readText());
  }

  async expectGeneratedUrl(label: string, expected: string): Promise<void> {
    await expect(this.body().getByText(expected, { exact: true })).toBeVisible();
    expect(await this.copiedValue(label)).toBe(expected);
  }

  async expectFieldError(message: string): Promise<void> {
    await expect(this.form().getByText(message, { exact: true })).toBeVisible();
  }

  async expectResult(message: string | RegExp): Promise<void> {
    await expect(this.status()).toContainText(message);
  }

  /** The section reports what happened and takes the keyboard with it. */
  async expectFocusedResult(message: string | RegExp): Promise<void> {
    await this.expectResult(message);
    await expect(this.status()).toBeFocused();
  }

  /**
   * The alert says what happened and what to do, under a title that says which provider it
   * belongs to. The copy assertion is scoped to the description so an anchored expectation is
   * about the sentence, not about the title stuck to the front of it.
   */
  async expectFocusedError(message: string | RegExp): Promise<void> {
    const alert = this.status().getByRole("alert");
    await expect(alert.locator('[data-slot="alert-description"]')).toContainText(message);
    await expect(alert).toContainText(`${this.provider} setup didn't finish`);
    await expect(alert).toBeFocused();
  }

  /** Plain HTTP is a terminal Slack setup state, not an editable workflow with disabled inputs. */
  async expectHttpsBlocked(origin: string): Promise<void> {
    await this.expectExpanded();
    await expect(this.body().getByRole("alert")).toContainText("HTTPS required");
    await expect(this.body().getByRole("alert")).toContainText(
      `Slack only works over HTTPS, and Hub is at ${origin}. Reopen Hub at its public HTTPS address to set up Slack.`,
    );
    await expect(this.body().getByRole("link", { name: "Create a Slack app" })).toHaveCount(0);
    await expect(this.body().getByRole("list")).toHaveCount(0);
    await expect(this.body().getByRole("button", { name: "Copy manifest" })).toHaveCount(0);
    await expect(this.form()).toHaveCount(0);
    await expect(this.action("Save and continue to Slack")).toHaveCount(0);
    await expect(this.setupSteps()).toHaveCount(0);
  }

  async expectLinearHttpsBlocked(origin: string): Promise<void> {
    await this.expectExpanded();
    await expect(this.body().getByRole("alert")).toContainText("HTTPS required");
    await expect(this.body().getByRole("alert")).toContainText(
      `Linear webhooks need HTTPS, and Hub is at ${origin}. Reopen Hub at its public HTTPS address to set up Linear.`,
    );
    await expect(
      this.body().getByRole("link", { name: "Open Linear API applications" }),
    ).toHaveCount(0);
    await expect(this.form()).toHaveCount(0);
    await expect(this.action("Save and continue to Linear")).toHaveCount(0);
    await expect(this.setupSteps()).toHaveCount(0);
  }

  /** The ordered portal checklist. Its first list is the steps; chips and mappings nest inside. */
  steps(): Locator {
    return this.body().getByRole("list").first();
  }

  setupSteps(): Locator {
    return this.body().getByRole("button", { name: "Setup steps", exact: true });
  }

  /**
   * The saved summary. A `dl` has no ARIA role to address it by, so this is the escape hatch —
   * and giving it a role purely to be locatable would cost the rows their term/definition
   * semantics, which is the whole point of the panel.
   */
  summary(): Locator {
    return this.body().locator(`dl[data-summary="${this.provider} app"]`);
  }

  /**
   * The portal-control mapping a step renders instead of listing six settings in one sentence.
   * Read as pairs, because that is the whole claim: each control has one value.
   */
  async permissionMapping(): Promise<Readonly<Record<string, string>>> {
    return await this.steps()
      .locator("dl")
      .first()
      .evaluate((list) => {
        const pairs: Record<string, string> = {};
        const terms = [...list.querySelectorAll("dt")];
        for (const term of terms) {
          const definition = term.nextElementSibling;
          if (definition?.tagName.toLowerCase() !== "dd") continue;
          pairs[(term.textContent ?? "").trim()] = (definition.textContent ?? "").trim();
        }
        return pairs;
      });
  }

  /** The named checkboxes a step renders as items rather than as a comma run-on. */
  async subscribedEvents(): Promise<readonly string[]> {
    return (await this.body().locator("ol ul").first().locator("li").allInnerTexts()).map((text) =>
      text.trim(),
    );
  }

  /**
   * The step sentences, in the order the operator will walk the provider's portal. Only the
   * sentence: the copy fields, mappings and chips a step renders under itself are asserted on
   * their own, and folding them in here would make the order assertion about layout.
   */
  async stepOrder(): Promise<readonly string[]> {
    const sentences = await this.steps().locator("> li > span:first-child").allInnerTexts();
    // An inline link is a flex box, so the browser puts a space either side of it. That is a
    // rendering artefact of the icon, not a space in the copy.
    return sentences.map((text) =>
      text
        .replace(/\s+/gu, " ")
        .replace(/\s+([,.:;])/gu, "$1")
        .trim(),
    );
  }

  async fieldOrder(): Promise<readonly string[]> {
    return await this.form().locator("label").allInnerTexts();
  }

  /** Finished work is never buried under the manual that produced it. */
  async expectSetupStepsRetired(): Promise<void> {
    await expect(this.setupSteps()).toBeVisible();
    await expect(this.setupSteps()).toHaveAttribute("aria-expanded", "false");
    await expect(this.body().getByRole("link", { name: PORTAL_LINKS[this.provider] })).toBeHidden();
  }

  async openSetupSteps(): Promise<void> {
    await this.setupSteps().click();
    await expect(this.setupSteps()).toHaveAttribute("aria-expanded", "true");
  }

  /** The saved summary as the labelled facts it claims to be. */
  async summaryValues(): Promise<Readonly<Record<string, string>>> {
    return await this.summary().evaluate((panel) => {
      const values: Record<string, string> = {};
      for (const row of panel.querySelectorAll(":scope > div")) {
        const term = row.querySelector("dt");
        const definition = row.querySelector("dd");
        if (term === null || definition === null) continue;
        values[(term.textContent ?? "").trim()] = (definition.textContent ?? "")
          .replace(/\s+/gu, " ")
          .trim();
      }
      return values;
    });
  }

  async expectSummary(expected: Readonly<Record<string, string | RegExp>>): Promise<void> {
    await expect(this.summary()).toBeVisible();
    const matchers = Object.fromEntries(
      Object.entries(expected).map(([label, value]) => [
        label,
        typeof value === "string" ? value : expect.stringMatching(value),
      ]),
    );
    await expect.poll(() => this.summaryValues()).toMatchObject(matchers);
    // One statement of each fact. The rejected surface said "Connected to X" and "X connected"
    // one line apart, and repeated the identity a third time above both.
    const text = (await this.summary().innerText()).replace(/\s+/gu, " ");
    expect(text).not.toMatch(/Connected to /u);
  }

  /**
   * On a wide screen the instructions and the form share the row rather than the form hiding in
   * a narrow strip at the bottom left of a full-width wall of text.
   */
  async expectSideBySideLayout(): Promise<void> {
    const [steps, form] = await this.taskBoxes();
    expect(form.x, "the paste form should start to the right of the instructions").toBeGreaterThan(
      steps.x + steps.width - 1,
    );
    const overlap =
      Math.min(steps.y + steps.height, form.y + form.height) - Math.max(steps.y, form.y);
    expect(overlap, "the two columns should share vertical space").toBeGreaterThan(0);
  }

  /** On a phone the same task reads top to bottom in the same order. */
  async expectStackedLayout(): Promise<void> {
    const [steps, form] = await this.taskBoxes();
    expect(form.y, "the paste form should follow the instructions").toBeGreaterThanOrEqual(
      steps.y + steps.height - 1,
    );
    await this.expectNothingClipped();
  }

  private async taskBoxes(): Promise<
    [
      { x: number; y: number; width: number; height: number },
      { x: number; y: number; width: number; height: number },
    ]
  > {
    const steps = await this.steps().boundingBox();
    const form = await this.form().boundingBox();
    expect(steps, "no instructions on screen").not.toBeNull();
    expect(form, "no paste form on screen").not.toBeNull();
    return [steps!, form!];
  }

  /** HTTPS exposes every user action needed to create and install the Slack app. */
  async expectSlackSetupActionable(origin: string): Promise<void> {
    await this.expectExpanded();
    await expect(this.body().getByRole("link", { name: "Create a Slack app" })).toBeVisible();
    await expect(this.body().getByRole("list")).toBeVisible();
    await expect(this.body().getByRole("button", { name: "Copy manifest" })).toBeVisible();
    await expect(this.form()).toBeVisible();
    for (const label of Object.keys(WORKING_CREDENTIALS.Slack)) {
      await expect(this.form().getByLabel(label, { exact: true })).toBeEnabled();
    }
    await expect(this.action("Connect Slack")).toBeEnabled();
    expect(await this.copiedManifest()).toContain("socket_mode_enabled: true");
  }
}

/**
 * The app setup surface, in either frame. The first-run journey and Instance → Apps render the
 * same sections, so one page object drives both and any divergence shows up as a failure.
 */
export class AppSetupSurface {
  readonly github: AppSection;
  readonly slack: AppSection;
  readonly discord: AppSection;
  readonly linear: AppSection;
  /** Where the way out leads on first run, before the dashboard. */
  readonly daemonHandoff: DaemonHandoffSurface;

  constructor(private readonly page: Page) {
    this.github = new AppSection(page, "GitHub");
    this.slack = new AppSection(page, "Slack");
    this.discord = new AppSection(page, "Discord");
    this.linear = new AppSection(page, "Linear");
    this.daemonHandoff = new DaemonHandoffSurface(page);
  }

  sections(): readonly AppSection[] {
    return [this.github, this.slack, this.discord, this.linear];
  }

  section(provider: AppProvider): AppSection {
    if (provider === "GitHub") return this.github;
    if (provider === "Slack") return this.slack;
    if (provider === "Discord") return this.discord;
    return this.linear;
  }

  async expectOnboarding(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Set up your apps" })).toBeVisible();
    await expect(
      this.page.getByText(
        "Paseo Hub talks to GitHub, Slack, Discord, and Linear through apps you create and own.",
        { exact: false },
      ),
    ).toBeVisible();
    await this.expectCopyContract();
  }

  async expectManagement(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Apps", exact: true })).toBeVisible();
    await expect(
      this.page.getByText(
        "The GitHub, Slack, Discord, and Linear apps Hub uses to reach your workspaces.",
      ),
    ).toBeVisible();
  }

  /** The alert that reports a failed attempt to leave app setup, with its own retry. */
  exitFailure(): Locator {
    return this.page.getByRole("alert").filter({ hasText: "Hub couldn't leave app setup" });
  }

  async expectFocusedExitFailure(message: string): Promise<void> {
    const alert = this.exitFailure();
    await expect(alert).toContainText(message);
    await expect(alert).toBeFocused();
  }

  wayOut(label: "Finish" | "Do this later"): Locator {
    return this.page.getByRole("button", { name: label, exact: true });
  }

  /** Leaves app setup and stops on the daemon handoff, which is where the way out now leads. */
  async reachDaemonHandoff(label: "Finish" | "Do this later"): Promise<void> {
    await this.wayOut(label).click();
    await this.daemonHandoff.expectWaiting();
  }

  /** All the way out: app setup, past the daemon handoff, into the default project. */
  async leave(label: "Finish" | "Do this later"): Promise<void> {
    await this.reachDaemonHandoff(label);
    await this.daemonHandoff.leave("Do this later");
  }

  async expectStatuses(expected: Readonly<Record<AppProvider, AppStatus>>): Promise<void> {
    for (const section of this.sections()) await section.expectStatus(expected[section.provider]);
  }

  /** No sideways page scroll, and no section paying for that by clipping its own content. */
  async expectNothingClipped(): Promise<void> {
    const document = await this.page.evaluate(() => ({
      scrollWidth: window.document.documentElement.scrollWidth,
      clientWidth: window.document.documentElement.clientWidth,
    }));
    expect(document.scrollWidth).toBeLessThanOrEqual(document.clientWidth + 1);
    for (const section of this.sections()) await section.expectNothingClipped();
  }

  /** Only one section open at a time is an accordion's rule, not this surface's. */
  async expectIndependentCollapse(): Promise<void> {
    await this.github.expand();
    await this.slack.expand();
    await this.github.expectExpanded();
    await this.slack.expectExpanded();
    await this.discord.expectCollapsed();
    await this.linear.expectCollapsed();
  }

  async collapseAll(): Promise<void> {
    for (const section of this.sections()) await section.collapse();
  }

  async expandAll(): Promise<void> {
    for (const section of this.sections()) await section.expand();
  }

  async verifyGitHubFromKeyboard(): Promise<void> {
    const github = this.github;
    await github.expectExpanded();
    // The loading surface deliberately exposes the same static instructions and controls.
    // Wait for the dynamic form before starting the uninterrupted tab-order assertion so
    // hydration cannot replace the currently focused node halfway through the journey.
    await expect(github.form()).toBeVisible();
    await github.header().focus();
    await this.tabTo(github.body().getByRole("link", { name: "Create a GitHub App" }));
    // The copy controls come in the order their URLs are read off the page, and on a plain-HTTP
    // origin the webhook URL is not one of them.
    for (const label of ["Homepage URL", "Callback URL", "Setup URL"]) {
      await this.tabTo(github.body().getByRole("button", { name: `Copy ${label}` }));
    }
    for (const [label, value] of Object.entries(WORKING_CREDENTIALS.GitHub)) {
      const field = github.form().getByLabel(label, { exact: true });
      await this.tabTo(field);
      await field.fill(value);
    }
    await this.tabTo(github.action("Verify and save"));
    await this.page.keyboard.press("Enter");
  }

  private async tabTo(target: Locator): Promise<void> {
    await this.page.keyboard.press("Tab");
    await expect(target).toBeFocused();
  }

  async accessible(): Promise<void> {
    const results = await new AxeBuilder({ page: this.page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }

  /**
   * Paseo's own vocabulary never reaches this surface. "Restart" is the one exception and it is
   * not a general one: an environment-managed app genuinely cannot be changed without restarting
   * Hub, so that alert says so and is measured separately.
   */
  async expectCopyContract(): Promise<void> {
    const copy = (await this.page.locator("body").innerText()).toLowerCase();
    for (const phrase of [
      "runtime configuration",
      "persistence",
      "database",
      "storage",
      "migration",
      "provider registration",
      "factory",
      "hot reload",
      "activation",
      "environment precedence",
      "latch",
      "configuration version",
      "snapshot",
      "first owner",
      "instance operator flag",
      "this hub",
      "app settings",
    ]) {
      expect(copy, `visible copy contains prohibited phrase: ${phrase}`).not.toContain(phrase);
    }
    // "Project" is Linear's native resource name and belongs in that card. It remains internal
    // vocabulary everywhere else on this app-ownership surface.
    const copyWithoutLinear = await this.page.locator("body").evaluate((body) => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const visible: string[] = [];
      let node = walker.nextNode();
      while (node !== null) {
        const element = node.parentElement;
        if (
          element !== null &&
          element.closest('[data-provider="linear"]') === null &&
          element.getClientRects().length > 0
        ) {
          visible.push(node.textContent ?? "");
        }
        node = walker.nextNode();
      }
      return visible.join(" ").toLowerCase();
    });
    for (const phrase of ["project", "projects"]) {
      expect(
        copyWithoutLinear,
        `visible non-Linear copy contains prohibited phrase: ${phrase}`,
      ).not.toContain(phrase);
    }
    const restarts = await this.page.getByText("restart Hub", { exact: false }).all();
    for (const mention of restarts) {
      await expect(
        mention.locator("xpath=ancestor-or-self::*[@data-slot='alert']"),
        "only an environment-managed app may speak about restarting Hub",
      ).toHaveCount(1);
    }
  }

  /** Evidence, not an assertion. Animations are frozen so a shot never catches a mid-transition. */
  async shoot(directory: string, name: string): Promise<void> {
    await this.page.screenshot({
      path: `${directory}/${name}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
}

/** Grants clipboard access so copy affordances can be proven, not just clicked. */
export async function allowClipboard(page: Page, origin: string): Promise<void> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
}
