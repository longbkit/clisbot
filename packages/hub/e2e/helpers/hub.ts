import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WebSocket, type RawData } from "ws";
import { z } from "zod";
import { dump } from "js-yaml";
import type { SourcePaseo } from "./source-paseo.js";
import type { HubBundleFile } from "../../src/config/bundle.js";
import type { BrowserDiscordEvent } from "../../src/e2e/harness/browser-providers.js";
import type { BrowserProviderScenario } from "../../src/e2e/harness/browser-providers.js";
import type { FixtureBillingProduct } from "../../src/e2e/harness/browser-billing.js";
import {
  FIXTURE_BILLING_PRODUCTS,
  fixtureSubscriptionId,
} from "../../src/e2e/harness/browser-billing.js";
import { configurationBundleFixture } from "../../src/test-utils/configuration-bundle.js";
import { slugify } from "../../src/slug.js";
import { AppSetupSurface, allowClipboard } from "./apps.js";
import { SHOTS } from "./app-evidence.js";
import {
  ProjectNavigation,
  type OrganizationSection,
  type OrganizationSettingsSection,
} from "./projects/navigation.js";
import { ProjectConfiguration } from "./projects/configuration.js";

export interface BuiltApplication {
  origin: string;
  machineKey: string;
  logs(): string;
  deliverDiscord(event: BrowserDiscordEvent): Promise<void>;
  setGitHubConfiguration(input: {
    repositoryId: number;
    commitSha: string;
    files?: readonly HubBundleFile[];
  }): Promise<void>;
  setBillingProduct(product: FixtureBillingProduct): Promise<void>;
  /** Stand in for a portal cancellation: move the organization's fixture subscription to canceled. */
  cancelSubscription(organizationId: string): Promise<void>;
  /** The seat quantity billing last reported to the fixture Stripe for this organization. */
  reportedSeatQuantity(organizationId: string): Promise<number | null>;
  /** Arms one account-setup failure inside the built application, for the error/retry journey. */
  failNextAccountSetup(): Promise<void>;
  /** Records a daemon enrollment token for this instance's organization. */
  issueDaemonEnrollment(verifier: string): Promise<void>;
  /** Arms one project snapshot read failure inside the disposable built application. */
  failNextProjectRead(): Promise<void>;
  prepareSlackSocketWorkflow(): Promise<void>;
  deliverSlackSocketMention(eventId: string): Promise<void>;
  slackSocketEvidence(eventId: string): Promise<{ receipts: number; runs: number }>;
  /** Executes fixture setup or inspection against the database owned by this application. */
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  installUnroutedSlackFixture(input: {
    projectId: string;
    userId: string;
    files: readonly HubBundleFile[];
  }): Promise<void>;
  installProviderDispatchFixture(input: {
    organizationId: string;
    repositoryId: number;
    repository: string;
    guildId: string;
    files: readonly HubBundleFile[];
  }): Promise<void>;
  restart(): Promise<void>;
}

export interface BuiltApplicationOptions {
  browserAuth?: boolean;
  machineAuth?: boolean;
  databaseProfile?: "fresh" | "legacy";
  registrationMode?: "open" | "invite_only" | "disabled";
  organizationCreation?: "open" | "disabled";
  providerConnections?: boolean;
  githubApprovalRequired?: boolean;
  providerScenario?: BrowserProviderScenario;
  /** Operator-managed provider applications, starting from nothing configured. */
  providerApplications?: boolean;
  /** Providers the instance environment configures, which the surface must render read-only. */
  environmentApps?: readonly ("github" | "slack" | "discord" | "linear")[];
  /** Run the built app with direct local TLS for provider journeys that require real HTTPS. */
  https?: boolean;
  /** Terminate HTTPS at a trusted proxy and intentionally omit PASEO_HUB_APP_URL. */
  reverseProxy?: boolean;
  bootstrap?: {
    organizationName: string;
    ownerEmail: string;
    ownerPassword: string;
  };
  /** Configures billing with the fixture Stripe catalog (internal free record plus the one
   * purchasable Paseo Hub plan). Default: unconfigured. */
  billing?: boolean;
}

export interface Account {
  name: string;
  email: string;
  password: string;
}

const INTERACTIVE_ORGANIZATION_NAME = "Paseo Hub";

/** The flat organization sidebar entries, in rendered order. */
const ORGANIZATION_DESTINATIONS = [
  "Triggers",
  "Activity",
  "Daemons",
  "Connections",
  "Settings",
] as const;
/** Instance surfaces sit outside `/o/`, so the path is what says the sidebar is in instance scope. */
const INSTANCE_ROUTES: readonly string[] = ["/apps", "/operator"];
const ORGANIZATION_SETTINGS_SECTIONS: readonly OrganizationSettingsSection[] = [
  "Team",
  "API keys",
  "Usage",
  "Billing",
];

interface TeamExpectation {
  membersPresent: string[];
  membersAbsent: string[];
  invitationsPresent?: string[];
  invitationsAbsent?: string[];
}

interface OrganizationJourneyMember {
  alias: string;
  account: Account;
}

interface OrganizationIsolationJourney {
  owner: OrganizationJourneyMember;
  sharedMember: OrganizationJourneyMember;
  first: {
    name: string;
    member: OrganizationJourneyMember;
    pendingInvitation: string;
  };
  second: {
    name: string;
    member: OrganizationJourneyMember;
    pendingInvitation: string;
  };
}

type StartBuiltApplication = (options?: BuiltApplicationOptions) => Promise<BuiltApplication>;
type StartSourcePaseo = () => Promise<SourcePaseo>;

export class PaseoHub {
  private readonly users = new Map<string, HubUser>();
  private readonly hubCredentials = new Map<string, string>();
  private sourcePaseo: SourcePaseo | undefined;

  constructor(
    private readonly primary: BuiltApplication,
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly requests: APIRequestContext,
    private readonly startApplication: StartBuiltApplication,
    private readonly startSourcePaseo: StartSourcePaseo,
  ) {}

  primaryApplication(): BuiltApplication {
    return this.primary;
  }

  async visitHome(): Promise<void> {
    await this.page.goto(this.primary.origin);
  }

  async provisionAccount(account: Account): Promise<void> {
    const response = await this.requests.post(`${this.primary.origin}/api/auth/sign-up/email`, {
      data: account,
    });
    expect(response.status()).toBe(200);
  }

  async verifyHttpContractMatrix(): Promise<void> {
    const application = await this.startApplication({ databaseProfile: "legacy" });
    await this.verifyManualApplication(application);
    const webhook = await this.startApplication({ databaseProfile: "legacy" });
    await this.verifyWebhookApplication(webhook);
    await this.verifyLegacyStartupCompatibility();
  }

  private async verifyLegacyStartupCompatibility(): Promise<void> {
    const application = await this.startApplication({
      browserAuth: false,
      machineAuth: false,
    });
    await this.verifyExactContract(application, {
      name: "legacy deployment remains healthy without browser auth",
      request: { path: "/health", method: "GET" },
      expected: { status: 200, body: '{"ok":true}', headers: { "content-type": JSON_TYPE } },
    });
    await this.verifyExactContract(application, {
      name: "browser auth closes independently",
      request: { path: "/api/auth/get-session", method: "GET" },
      expected: {
        status: 503,
        body: '{"error":"auth_unavailable"}',
        headers: { "content-type": JSON_TYPE },
      },
    });
    await this.verifyExactContract(application, {
      name: "public API closes when organization credential auth is unavailable",
      request: {
        path: "/api/v1/configurations/install",
        method: "POST",
        headers: { "x-request-id": "phase-zero-unavailable" },
      },
      expected: {
        status: 503,
        body: problemBody(
          "phase-zero-unavailable",
          503,
          "infrastructure_unavailable",
          "Service unavailable",
          "Public API authentication or storage is currently unavailable.",
        ),
        headers: { "content-type": PROBLEM_TYPE },
      },
    });
  }

  async expectWelcome(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Sign in to Paseo Hub" })).toBeVisible();
  }

  async expectSignedOut(): Promise<void> {
    await this.visitHome();
    await expect(this.page.getByRole("status")).toHaveText("Signed out");
  }

  async expectSignedInAs(email: string): Promise<void> {
    await this.visitHome();
    await expect(this.page.getByRole("status")).toHaveText(`Signed in as ${email}`);
  }

  async expectSignedOutAccountEntry(): Promise<void> {
    await this.visitHome();
    await expect(this.page.getByRole("heading", { name: "Sign in to Paseo Hub" })).toBeVisible();
    await expect(this.page.getByRole("form", { name: "Sign in" })).toBeVisible();
    await expectAccessible(this.page);
  }

  async signUpAs(alias: string, account: Account): Promise<void> {
    const user = await this.user(alias);
    await user.signUp(account);
  }

  async createOrganization(alias: string, name: string): Promise<void> {
    await this.requireUser(alias).createOrganization(name);
  }

  async proveBootstrapJourney(
    account: Account,
    organizationName: string,
    replacementPassword: string,
  ): Promise<void> {
    const application = await this.startApplication({
      databaseProfile: "fresh",
      bootstrap: {
        organizationName,
        ownerEmail: account.email,
        ownerPassword: account.password,
      },
    });
    const context = await this.browser.newContext();
    const page = await context.newPage();
    const user = new HubUser(application.origin, context, page);
    try {
      await user.completeBootstrapJourney(account, replacementPassword, organizationName);
    } finally {
      await context.close();
    }
  }

  /**
   * The whole first-run journey on an instance nobody owns: welcome, the initial operator form,
   * the dashboard it lands on, and the ordinary sign-in wall that replaces setup afterwards.
   * `machineAuth: false` is what keeps this application genuinely pristine — the machine-key
   * fixture seeds an organization and user into every other fresh application.
   */
  async proveFirstRunOperatorClaim(account: Account): Promise<void> {
    const application = await this.startApplication({
      databaseProfile: "fresh",
      machineAuth: false,
    });
    const context = await this.browser.newContext();
    try {
      const user = new HubUser(application.origin, context, await context.newPage());
      await user.completeFirstRunJourney(account, () => application.failNextAccountSetup());
      const logs = plainLogs(application.logs());
      expect(logs).toContain("auth.setup_instance");
      expect(logs).toMatch(/failureKind:\s*["']?internal/u);
      expect(logs).toMatch(/err:\s*\{/u);
      expect(logs).toMatch(/["']?type["']?\s*:\s*["']?Error/u);
      expect(logs).toMatch(/["']?stack["']?\s*:/u);
      expect(logs).not.toContain("account setup failed");
      expect(logs).not.toContain(account.email);
      expect(logs).not.toContain(account.password);
    } finally {
      await context.close();
    }
  }

  /**
   * A fresh instance with operator-managed apps and nothing configured, claimed by a first
   * operator who is left standing on the app setup screen. The caller drives the surface through
   * the returned DSL; closing the session tears the browser context down.
   */
  async openAppSetup(input: {
    account: Account;
    providerScenario?: BrowserProviderScenario;
    environmentApps?: readonly ("github" | "slack" | "discord" | "linear")[];
    https?: boolean;
    reverseProxy?: boolean;
  }): Promise<AppSetupSession> {
    const application = await this.startApplication({
      databaseProfile: "fresh",
      machineAuth: false,
      providerApplications: true,
      ...(input.providerScenario === undefined ? {} : { providerScenario: input.providerScenario }),
      https: input.https === true,
      reverseProxy: input.reverseProxy === true,
      ...(input.environmentApps === undefined ? {} : { environmentApps: input.environmentApps }),
    });
    const context = await this.browser.newContext({
      ignoreHTTPSErrors: input.https === true || input.reverseProxy === true,
    });
    const page = await context.newPage();
    await allowClipboard(page, application.origin);
    const user = new HubUser(application.origin, context, page);
    await user.claimInstance(input.account);
    const surface = new AppSetupSurface(page);
    await surface.expectOnboarding();
    return {
      application,
      page,
      surface,
      origin: application.origin,
      openManagement: async () => {
        await page.goto(`${application.origin}/apps`);
        await surface.expectManagement();
      },
      navigateToApps: async () => {
        await new ProjectNavigation(page).openInstanceSection(input.account.email, "Apps");
        await surface.expectManagement();
      },
      returnFromProvider: async (provider, result) => {
        await page.goto(`${application.origin}/?app=${provider}&result=${result}`);
      },
      seedSignedDelivery: (provider) => seedSignedDelivery(page, application.origin, provider),
      prepareSlackSocketWorkflow: () => application.prepareSlackSocketWorkflow(),
      deliverSlackSocketMention: (eventId) => application.deliverSlackSocketMention(eventId),
      slackSocketEvidence: (eventId) => application.slackSocketEvidence(eventId),
      restart: () => application.restart(),
      connectDaemon: () => this.enrollOperatorDaemon(application),
      openMember: async (member) => {
        const memberContext = await this.browser.newContext();
        const memberPage = await memberContext.newPage();
        const joining = new HubUser(application.origin, memberContext, memberPage);
        await joining.signUp(member);
        await joining.createOrganization("Member Organization");
        return { page: memberPage, close: () => memberContext.close() };
      },
      close: () => context.close(),
    };
  }

  /** Two browsers open the same welcome; the one that submits second rejoins the ordinary flow. */
  async proveStaleSetupFormFallsBackToSignIn(winner: Account, loser: Account): Promise<void> {
    const application = await this.startApplication({
      databaseProfile: "fresh",
      machineAuth: false,
    });
    const winnerContext = await this.browser.newContext();
    const loserContext = await this.browser.newContext();
    try {
      const loserPage = await loserContext.newPage();
      const losingUser = new HubUser(application.origin, loserContext, loserPage);
      await losingUser.openFirstRunSetupForm();

      const winningUser = new HubUser(
        application.origin,
        winnerContext,
        await winnerContext.newPage(),
      );
      await winningUser.openFirstRunSetupForm();
      await winningUser.completeFirstRunClaim(winner);

      await losingUser.expectSetupFormFallsBackToSignIn(loser);
    } finally {
      await winnerContext.close();
      await loserContext.close();
    }
  }

  async expectApiKeyLifecycle(alias: string): Promise<void> {
    await this.requireUser(alias).expectApiKeyLifecycle();
  }

  async createRunApiKey(alias: string): Promise<string> {
    return await this.requireUser(alias).createRunApiKey();
  }

  async proveInviteOnlyJourney(account: Account): Promise<void> {
    const application = await this.startApplication({
      databaseProfile: "fresh",
      registrationMode: "invite_only",
      organizationCreation: "disabled",
      bootstrap: {
        organizationName: "Invited Organization",
        ownerEmail: "invite-owner@example.com",
        ownerPassword: "temporary-invite-owner-password",
      },
    });
    const ownerContext = await this.browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const owner = new HubUser(application.origin, ownerContext, ownerPage);
    const memberContext = await this.browser.newContext();
    const memberPage = await memberContext.newPage();
    const user = new HubUser(application.origin, memberContext, memberPage);
    try {
      await owner.completeBootstrapJourney(
        {
          name: "Organization Owner",
          email: "invite-owner@example.com",
          password: "temporary-invite-owner-password",
        },
        "permanent-invite-owner-password",
        "Invited Organization",
      );
      const invitationLink = await owner.invite(account.email, "member");
      await user.openInvitation(invitationLink);
      await expect(
        memberPage.getByRole("heading", { name: "Join Invited Organization" }),
      ).toBeVisible();
      await expectAccessible(memberPage);
      const invitationEmail = memberPage
        .getByRole("form", { name: "Create account" })
        .getByLabel("Email");
      await expect(invitationEmail).toHaveValue(account.email);
      await expect(invitationEmail).toHaveAttribute("readonly", "");
      await user.signUpForInvitation(account);
      await user.acceptInvitation();
      await user.expectActiveOrganization("Invited Organization");
    } finally {
      await ownerContext.close();
      await memberContext.close();
    }
  }

  async proveDisabledRegistrationPresentation(): Promise<void> {
    const application = await this.startApplication({
      databaseProfile: "fresh",
      registrationMode: "disabled",
      organizationCreation: "disabled",
    });
    const context = await this.browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(application.origin);
      await expect(page.getByRole("heading", { name: "Sign in to Paseo Hub" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Create an account" })).toHaveCount(0);
      await expect(page.getByText("Paseo Hub isn't accepting new accounts.")).toBeVisible();
      await expectAccessible(page);
      const response = await page.evaluate(async (origin) => {
        const result = await fetch(`${origin}/api/auth/sign-up/email`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Blocked Signup",
            email: "blocked-signup@example.com",
            password: "blocked-signup-password",
          }),
        });
        return { status: result.status, body: await result.json() };
      }, application.origin);
      expect(response).toEqual({ status: 403, body: { error: "registration_closed" } });
    } finally {
      await context.close();
    }
  }

  async proveOrganizationCreationDisabled(): Promise<void> {
    const application = await this.startApplication({
      databaseProfile: "fresh",
      registrationMode: "open",
      organizationCreation: "disabled",
    });
    const context = await this.browser.newContext();
    const page = await context.newPage();
    const user = new HubUser(application.origin, context, page);
    try {
      await user.signUp({
        name: "No Organization Owner",
        email: "no-organization-owner@example.com",
        password: "no-organization-owner-password",
      });
      await expect(page.getByRole("heading", { name: "Choose an organization" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Create an organization" })).toHaveCount(0);
      await expect(page.getByText("Ask an organization owner to invite you.")).toBeVisible();
      await expectAccessible(page);
      const response = await page.evaluate(async (origin) => {
        const result = await fetch(`${origin}/api/auth/paseo/create-organization`, {
          method: "POST",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify({ name: "Blocked Organization" }),
        });
        return { status: result.status, body: await result.json() };
      }, application.origin);
      expect(response).toEqual({ status: 403, body: { error: "organization_creation_disabled" } });
    } finally {
      await context.close();
    }
  }

  async rejectOrganizationGateCommand(alias: string, name: string): Promise<void> {
    await this.requireUser(alias).rejectOrganizationGateCommand(name);
  }

  async expectDesktopSidebarAndOrganizationMenu(alias: string): Promise<void> {
    await this.requireUser(alias).expectDesktopSidebarAndOrganizationMenu();
  }

  async proveAuthenticationPendingLocksMode(alias: string, account: Account): Promise<void> {
    await this.requireUser(alias).proveAuthenticationPendingLocksMode(account);
  }

  async proveAuthenticationSettlementLocksMode(
    alias: string,
    account: Account,
    organization: string,
  ): Promise<void> {
    await this.requireUser(alias).proveAuthenticationSettlementLocksMode(account, organization);
  }

  async proveOrganizationSwitchUnmountsOldPanel(
    alias: string,
    owningOrganization: string,
    destinationOrganization: string,
    daemonName: string,
  ): Promise<void> {
    const daemonId = await this.seedDaemon(alias, daemonName);
    await this.createAnotherOrganization(alias, destinationOrganization);
    await this.chooseOrganization(alias, owningOrganization);
    const user = this.requireUser(alias);
    await user.expectDaemon(daemonName, daemonId, "Offline");
    await user.expectOrganizationSwitchUnmountsOldPanel(destinationOrganization, daemonName);
  }

  async seedProjectHistory(alias: string, projectSlug: string): Promise<void> {
    await this.queryDatabase(
      this.primary,
      `with target as (
         select project.id project_id, project.organization_id, "user".id user_id
         from session
         join "user" on "user".id = session.user_id
         join projects project on project.organization_id = session.active_organization_id
         where lower("user".email) = $1 and project.slug = $2
         order by session.expires_at desc limit 1
       ), revision as (
         insert into project_configuration_revisions
           (project_id, organization_id, version, source_kind, source_evidence, raw_yaml,
            normalized_configuration, content_hash, created_by_user_id, validated_at)
         select project_id, organization_id, 1, 'manual', '{"kind":"manual"}'::jsonb,
                'environments: []\ntriggers: []', '{"environments":[],"triggers":[]}'::jsonb,
                'browser-history', user_id, clock_timestamp()
         from target returning id, project_id, organization_id
       ), activated as (
         update projects set active_configuration_revision_id = revision.id
         from revision where projects.id = revision.project_id returning projects.id
       ), receipt as (
         insert into provider_event_receipts
           (organization_id, provider, delivery_id, source, payload, received_at)
         select organization_id, 'manual', concat('browser-history-', project_id),
                'manual.run', '{}'::jsonb, clock_timestamp()
         from revision
         returning id, delivery_id
       ), activity as (
         insert into trigger_runs
           (organization_id, project_id, configuration_revision_id, provider_event_receipt_id,
            configured_trigger_name, status, prompt, inputs, "values",
            trigger_context, output_context, deadline_at, deadline_kind, outcome,
            created_at, completed_at)
         select revision.organization_id, revision.project_id, revision.id, receipt.id,
                'Browser history', 'succeeded', 'Browser history',
                '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                clock_timestamp(), 'whole_run', 'accepted', clock_timestamp(), clock_timestamp()
         from revision
         join receipt on receipt.delivery_id = concat('browser-history-', revision.project_id)
         returning id
       )
       insert into workflow_step_runs
         (trigger_run_id, step_id, ordinal, status, output, started_at, completed_at)
       select id, 'history', 0, 'succeeded', '{"status":"succeeded"}'::jsonb,
              clock_timestamp(), clock_timestamp()
       from activity`,
      [this.requireUser(alias).accountEmail, projectSlug],
    );
  }

  async deliverSignedUnroutedSlackEvent(alias: string): Promise<void> {
    const email = this.requireUser(alias).accountEmail;
    const [target] = z
      .array(
        z.object({
          project_id: z.string().uuid(),
          organization_id: z.string(),
          user_id: z.string(),
        }),
      )
      .parse(
        await this.queryDatabaseRows(
          this.primary,
          `select project.id project_id, project.organization_id, "user".id user_id
           from session
           join "user" on "user".id = session.user_id
           join projects project on project.organization_id = session.active_organization_id
           where lower("user".email) = $1 and project.slug = 'default'
           order by session.expires_at desc limit 1`,
          [email],
        ),
      );
    if (target === undefined) throw new Error("Slack event project unavailable");
    await this.queryDatabase(
      this.primary,
      `insert into slack_connections
         (organization_id, team_id, slug, team_name, bot_user_id, bot_access_token, scopes, connected_by_user_id)
       values ($1, 'T-drop-reason', 'drop-reason-slack', 'Drop Reason Slack', 'UBOT',
               'PRIVATE-SLACK-TOKEN',
               '["app_mentions:read","channels:history","chat:write","files:read","groups:history","reactions:write","users:read"]'::jsonb, $2)`,
      [target.organization_id, target.user_id],
    );
    const daemonSlug = "browser-drop-reason";
    await this.seedDaemonForEmail(this.primary, email, daemonSlug);
    await this.primary.installUnroutedSlackFixture({
      projectId: target.project_id,
      userId: target.user_id,
      files: configurationBundleFixture(dump(browserUnroutedSlackConfiguration(daemonSlug))),
    });

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T-drop-reason",
      api_app_id: "browser-slack-app",
      event_id: "browser-unrouted-reason",
      event_time: Math.floor(Date.now() / 1_000),
      event: {
        type: "app_mention",
        user: "PRIVATE-EVENT-SENDER-ID",
        channel: "PRIVATE-EVENT-CHANNEL-ID",
        text: "<@UBOT> PRIVATE-EVENT-BODY",
        ts: "1700000000.000001",
        event_ts: "1700000000.000001",
        files: [{ id: "PRIVATE-EVENT-ATTACHMENT-ID", name: "PRIVATE-EVENT-ATTACHMENT-NAME" }],
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = createHmac("sha256", SLACK_WEBHOOK_SECRET)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex");
    const response = await this.requests.post(
      `${this.primary.origin}/api/integrations/slack/events`,
      {
        headers: {
          "content-type": "application/json",
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": `v0=${signature}`,
        },
        data: Buffer.from(body),
      },
    );
    expect(response.status()).toBe(200);

    const reasons = z.array(z.object({ dropped_reason: z.string() })).parse(
      await this.queryDatabaseRows(
        this.primary,
        `select dropped_reason from provider_event_receipts
           where delivery_id = 'slack-browser-unrouted-reason'`,
        [],
      ),
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]!.dropped_reason).toBe("trigger_filters_rejected");
    expect(JSON.stringify(reasons)).not.toMatch(/PRIVATE-|TOKEN|SIGNATURE/u);
  }

  async setDaemonSlug(daemonId: string, slug: string): Promise<void> {
    await this.queryDatabase(this.primary, "update daemons set slug = $2 where id = $1", [
      daemonId,
      slug,
    ]);
  }

  async runManualInput(input: {
    rawInput: string;
    deliveryKey: string;
    trigger?: string;
    apiKey?: string;
  }): Promise<{
    status: number;
    error?: string;
    reason?: string;
    workflowStatus?: string;
    triggerRunId?: string;
  }> {
    const response = await this.requests.post(`${this.primary.origin}/api/v1/manual-runs`, {
      headers: {
        ...(input.apiKey === undefined
          ? machineHeaders(this.primary.machineKey)
          : { authorization: `Bearer ${input.apiKey}` }),
        "content-type": "application/json",
      },
      data: {
        projectSlug: "default",
        trigger: input.trigger ?? "deploy",
        actor: "alice",
        deliveryKey: input.deliveryKey,
        input: input.rawInput,
      },
    });
    const body = z
      .object({
        code: z.string().optional(),
        detail: z.string().optional(),
        issues: z.array(z.object({ message: z.string() }).passthrough()).optional(),
        error: z.string().optional(),
        reason: z.string().optional(),
        workflowStatus: z.string().optional(),
        triggerRunId: z.string().optional(),
      })
      .passthrough()
      .parse(await response.json());
    const error = body.error ?? body.code;
    const reason = body.reason ?? body.issues?.[0]?.message;
    const triggerRunId =
      body.triggerRunId ??
      /^Run (?<triggerRunId>\S+) rejected/u.exec(body.detail ?? "")?.groups?.["triggerRunId"];
    return {
      status: response.status(),
      ...(error === undefined ? {} : { error }),
      ...(reason === undefined ? {} : { reason }),
      ...(body.workflowStatus === undefined ? {} : { workflowStatus: body.workflowStatus }),
      ...(triggerRunId === undefined ? {} : { triggerRunId }),
    };
  }

  async createAdminInvitationWithKeyboard(alias: string, email: string): Promise<void> {
    await this.requireUser(alias).createAdminInvitationWithKeyboard(email);
  }

  async navigateToTeamFromMobileSidebar(alias: string): Promise<void> {
    await this.requireUser(alias).navigateToTeamFromMobileSidebar();
  }

  async expectMobileTeamFitsViewport(alias: string): Promise<void> {
    await this.requireUser(alias).expectMobileTeamFitsViewport();
  }

  async expectConnections(alias: string): Promise<void> {
    await this.requireUser(alias).expectConnections();
  }

  async expectUsageUnlimitedDefaults(alias: string): Promise<void> {
    await this.requireUser(alias).expectUsageUnlimitedDefaults();
  }

  async expectUsageReadOnly(alias: string): Promise<void> {
    await this.requireUser(alias).expectUsageReadOnly();
  }

  async expectNoOperatorNav(alias: string): Promise<void> {
    await this.requireUser(alias).expectNoOperatorNav();
  }

  async expectOperatorRouteRefused(alias: string): Promise<void> {
    await this.requireUser(alias).expectOperatorRouteRefused();
  }

  async openOperatorConsole(alias: string): Promise<void> {
    await this.requireUser(alias).openOperatorConsole();
  }

  /**
   * Grant the instance-operator flag exactly as an administrator would in production — a single
   * SQL statement, documented in docs/entitlements.md, with no UI. These journeys are not
   * app-onboarding journeys, so the same transition also records that the instance has deferred app
   * setup. Reload so the client re-reads both states and the operator nav appears.
   */
  async grantOperator(alias: string): Promise<void> {
    await this.queryDatabaseRows(
      this.primary,
      `with promoted as (
         update "user"
         set is_instance_operator = true
         where lower(email) = lower($1)
         returning id
       )
       insert into instance_bootstrap (
         id, organization_id, owner_user_id, completed_at, app_onboarding_completed_at
       )
       select 'default', member.organization_id, promoted.id, now(), now()
       from promoted
       join member on member.user_id = promoted.id
       limit 1
       on conflict (id) do update
       set app_onboarding_completed_at = coalesce(
         instance_bootstrap.app_onboarding_completed_at,
         excluded.app_onboarding_completed_at
       )`,
      [this.requireUser(alias).accountEmail],
    );
    await this.page.reload();
  }

  async expectNoBillingNavigation(alias: string): Promise<void> {
    await this.requireUser(alias).expectNoBillingNavigation();
  }

  async expectBillingPageUnavailable(alias: string): Promise<void> {
    await this.requireUser(alias).expectBillingPageUnavailable();
  }

  async returnToProjects(alias: string): Promise<void> {
    await this.requireUser(alias).returnToProjects();
  }

  async expectBillingWebhookUnavailable(): Promise<void> {
    const response = await this.requests.post(`${this.primary.origin}/api/billing/webhook`, {
      headers: { "content-type": "application/json" },
      data: Buffer.from("{}"),
    });
    // On a self-hosted instance the billing routes are never registered, so the webhook 404s
    // as if it did not exist rather than mimicking any particular not-found body.
    expect(response.status()).toBe(404);
  }

  async expectPublicBillingPlansUnavailableWhenUnconfigured(): Promise<void> {
    const response = await this.requests.get(`${this.primary.origin}/api/billing/plans`);
    // Unconfigured means no billing surface at all: the public catalog endpoint 404s rather
    // than serving an empty list, so self-hosted instances expose nothing billing-shaped.
    expect(response.status()).toBe(404);
  }

  async visitPublicBillingPlans(origin?: string): Promise<void> {
    await this.page.goto(`${origin ?? this.primary.origin}/api/billing/plans`);
  }

  /**
   * Starts a second, billing-configured application and walks the plan catalog mirror through
   * three states. First: the public endpoint serves the one purchasable plan and withholds the
   * internal free entitlement record, which is in the same Stripe catalog. Second: a Stripe
   * dashboard typo (invalid `ent_seats_max`) delivered as a real HMAC-signed `product.updated`
   * is rejected by the sync, logged loudly, and leaves the previously synced row serving. Third:
   * a product that loses its `paseo_plan` tag is deactivated by the reconciled snapshot, so the
   * catalog stops offering it rather than leaving a removed plan selectable — and what is left is
   * an empty offer, never the free record promoted into one. Re-tagging restores it, because the
   * mirror is a reconciled snapshot rather than a one-way delete.
   */
  async proveStripePlanCatalogMirror(): Promise<string> {
    const application = await this.startApplication({ databaseProfile: "fresh", billing: true });
    await this.expectPublicBillingPlans(application, FIXTURE_BILLING_PLAN_EXPECTATIONS);

    await application.setBillingProduct({
      id: "prod_fixture_hosted",
      name: "Paseo Hub",
      active: true,
      metadata: {
        paseo_plan: "true",
        paseo_plan_slug: "hosted",
        ent_seats_max: "not-a-number",
        ent_can_invite: "true",
        ent_executions_monthly_limit: "unlimited",
      },
      marketingFeatures: [],
    });
    await this.deliverBillingWebhook(application, "product.updated", "prod_fixture_hosted");

    await expect
      .poll(() => application.logs())
      .toContain("billing.catalog.product.validate failed");
    await this.expectPublicBillingPlans(application, FIXTURE_BILLING_PLAN_EXPECTATIONS);

    await application.setBillingProduct({
      id: "prod_fixture_hosted",
      name: "Paseo Hub",
      active: true,
      metadata: { paseo_plan: "false" },
      marketingFeatures: [],
    });
    await this.deliverBillingWebhook(application, "product.updated", "prod_fixture_hosted");
    // Nothing left to sell. The free record is still mirrored for entitlement stamping, so an
    // empty offer here is also the proof that it never gets promoted into one.
    await this.expectPublicBillingPlans(application, []);

    // Re-tagging in Stripe brings the plan back: the mirror is a reconciled snapshot, not a
    // one-way delete.
    await application.setBillingProduct(FIXTURE_BILLING_PRODUCTS[1]!);
    await this.deliverBillingWebhook(application, "product.updated", "prod_fixture_hosted");
    await this.expectPublicBillingPlans(application, FIXTURE_BILLING_PLAN_EXPECTATIONS);
    return application.origin;
  }

  private async expectPublicBillingPlans(
    application: BuiltApplication,
    expected: readonly PublicBillingPlanExpectation[],
  ): Promise<void> {
    const response = await this.requests.get(`${application.origin}/api/billing/plans`);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ plans: expected });
  }

  private async deliverBillingWebhook(
    application: BuiltApplication,
    eventType: string,
    objectId: string,
  ): Promise<void> {
    await this.postSignedBillingWebhook(application.origin, eventType, {
      id: objectId,
      object: "product",
    });
  }

  /**
   * Sign a Stripe webhook payload with the fixture secret and POST it — the same HMAC scheme
   * Stripe uses, so signature verification is exercised for real. No Stripe account, no network.
   */
  private async postSignedBillingWebhook(
    origin: string,
    eventType: string,
    object: Record<string, unknown>,
  ): Promise<void> {
    const payload = JSON.stringify({
      id: `evt_${randomUUID()}`,
      type: eventType,
      data: { object },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", STRIPE_WEBHOOK_SECRET)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    const response = await this.requests.post(`${origin}/api/billing/webhook`, {
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${timestamp},v1=${signature}`,
      },
      data: Buffer.from(payload),
    });
    expect(response.status()).toBe(200);
  }

  /**
   * Deliver the subscription webhook for an organization's fixture subscription. The billing
   * runtime re-reads live state through the fixture client and stamps — driven by the read, not
   * this payload — so a replay of the exact same signed event is idempotent.
   */
  async deliverSubscriptionWebhook(alias: string): Promise<void> {
    const organizationId = await this.organizationIdForAlias(alias);
    await this.postSignedBillingWebhook(this.primary.origin, "customer.subscription.created", {
      id: fixtureSubscriptionId(organizationId),
      object: "subscription",
    });
  }

  /**
   * Cancel the organization's subscription in the fixture (a portal cancellation) and deliver the
   * signed customer.subscription.deleted webhook. Reconciliation re-reads the canceled state and
   * stamps Free, so paid entitlements do not survive a cancellation.
   */
  async cancelSubscription(alias: string): Promise<void> {
    const organizationId = await this.organizationIdForAlias(alias);
    await this.primary.cancelSubscription(organizationId);
    await this.postSignedBillingWebhook(this.primary.origin, "customer.subscription.deleted", {
      id: fixtureSubscriptionId(organizationId),
      object: "subscription",
    });
  }

  /**
   * The seat quantity billing reported to Stripe for the organization's subscription — the proof
   * that a multi-seat paid organization is billed for its actual seats, not one. Polled because the
   * report is post-commit off the membership change.
   */
  async expectReportedSeatQuantity(alias: string, quantity: number): Promise<void> {
    const organizationId = await this.organizationIdForAlias(alias);
    await expect.poll(() => this.primary.reportedSeatQuantity(organizationId)).toBe(quantity);
  }

  async subscribeToPlan(alias: string, plan: string): Promise<void> {
    await this.requireUser(alias).subscribeToPlan(plan);
  }

  async openPlanDialog(alias: string): Promise<void> {
    await this.requireUser(alias).openPlanDialog();
  }

  async expectCardlessTrialOffer(alias: string): Promise<void> {
    await this.requireUser(alias).expectCardlessTrialOffer();
  }

  async choosePlan(alias: string, plan: string): Promise<void> {
    await this.requireUser(alias).choosePlan(plan);
  }

  async expectCurrentPlan(alias: string, plan: string): Promise<void> {
    await this.requireUser(alias).expectCurrentPlan(plan);
  }

  async expectActiveTrial(alias: string): Promise<void> {
    await this.requireUser(alias).expectActiveTrial();
  }

  async expectNoSubscription(alias: string): Promise<void> {
    await this.requireUser(alias).expectNoSubscription();
  }

  async expectNoSecondTrialOffer(alias: string): Promise<void> {
    await this.requireUser(alias).expectNoSecondTrialOffer();
  }

  async expectPlanPickerFitsPhone(alias: string): Promise<void> {
    await this.requireUser(alias).expectPlanPickerFitsPhone();
  }

  async expectInviteBlockedByPlan(alias: string, email: string): Promise<void> {
    await this.requireUser(alias).expectInviteBlockedByPlan(email);
  }

  async expectPendingInvitation(alias: string, email: string): Promise<void> {
    await this.requireUser(alias).expectPendingInvitation(email);
  }

  async expectPendingInvitationsRetained(alias: string, emails: readonly string[]): Promise<void> {
    await this.requireUser(alias).expectPendingInvitationsRetained(emails);
  }

  async expectOverLimitBanner(
    alias: string,
    expected: { used: number; limit: number },
  ): Promise<void> {
    await this.requireUser(alias).expectOverLimitBanner(expected);
  }

  async expectNoOverLimitBanner(alias: string): Promise<void> {
    await this.requireUser(alias).expectNoOverLimitBanner();
  }

  async expectEntitlementCells(
    alias: string,
    org: string,
    name: string,
    expected: { granted: string; override: string; effective: string },
  ): Promise<void> {
    await this.requireUser(alias).expectEntitlementCells(org, name, expected);
  }

  async clearSeatOverride(
    alias: string,
    input: { org: string; reason: string; expectedEffective: string },
  ): Promise<void> {
    await this.requireUser(alias).clearSeatOverride(input);
  }

  private async organizationIdForAlias(alias: string): Promise<string> {
    const rows = z.array(z.object({ id: z.string() })).parse(
      await this.queryDatabaseRows(
        this.primary,
        `select active_organization_id as id from session
         join "user" on "user".id = session.user_id
         where lower("user".email) = $1 and active_organization_id is not null
         order by session.updated_at desc limit 1`,
        [this.requireUser(alias).accountEmail],
      ),
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`no active organization for ${alias}`);
    return id;
  }

  async openSeatOverrideEditor(
    alias: string,
    input: { org: string; max: number; reason: string },
  ): Promise<void> {
    await this.requireUser(alias).openSeatOverrideEditor(input);
  }

  async saveSeatOverride(alias: string, expectedSeats: number): Promise<void> {
    await this.requireUser(alias).saveSeatOverride(expectedSeats);
  }

  async openMeterOverrideEditor(
    alias: string,
    input: { org: string; limit: number; reason: string },
  ): Promise<void> {
    await this.requireUser(alias).openMeterOverrideEditor(input);
  }

  async saveMeterOverride(alias: string, expectedLimit: number): Promise<void> {
    await this.requireUser(alias).saveMeterOverride(expectedLimit);
  }

  async expectMeterUsage(alias: string, expected: { used: number; limit: number }): Promise<void> {
    await this.requireUser(alias).expectMeterUsage(expected);
  }

  async expectInviteRefusedBySeatLimit(
    alias: string,
    email: string,
    expected: { limit: number; current: number },
  ): Promise<void> {
    await this.requireUser(alias).expectInviteRefusedBySeatLimit(email, expected);
  }

  async expectEntitlementsAudit(
    alias: string,
    expected: { org: string; actor: string; reason: string },
  ): Promise<void> {
    await this.requireUser(alias).expectEntitlementsAudit(expected);
  }

  async expectMemberConnections(alias: string): Promise<void> {
    await this.requireUser(alias).expectMemberConnections();
  }

  async connectGitHub(alias: string): Promise<void> {
    await this.requireUser(alias).connectGitHub();
  }

  async connectDiscord(alias: string): Promise<void> {
    await this.requireUser(alias).connectDiscord();
  }

  async expectConnectedProviders(
    alias: string,
    expected: { github: string; installationId: string; discord: string; guildId: string },
  ): Promise<void> {
    await this.requireUser(alias).expectConnectedProviders(expected);
  }

  async expectMemberConnectedProviders(
    alias: string,
    expected: { github: string; installationId: string; discord: string; guildId: string },
  ): Promise<void> {
    await this.requireUser(alias).expectMemberConnectedProviders(expected);
  }

  async disconnectProviders(alias: string): Promise<void> {
    await this.requireUser(alias).disconnectProviders();
  }

  async proveConnectionDisconnectLocksOrganizationSwitch(
    alias: string,
    destinationOrganization: string,
  ): Promise<void> {
    await this.requireUser(alias).proveConnectionDisconnectLocksOrganizationSwitch(
      destinationOrganization,
    );
  }

  async proveTenantProviderDispatch(alias: string): Promise<void> {
    await this.chooseOrganization(alias, "Acme");
    const acmeDaemon = await this.connectBrowserDaemon(alias, "Acme", "Acme dispatch daemon");
    await this.chooseOrganization(alias, "Orbit");
    const orbitDaemon = await this.connectBrowserDaemon(alias, "Orbit", "Orbit dispatch daemon");
    const organizations = z
      .array(z.object({ id: z.string(), name: z.string() }))
      .parse(
        await this.queryDatabaseRows(
          this.primary,
          `select id, name from organization where name in ('Acme', 'Orbit') order by name`,
          [],
        ),
      );
    const acmeId = z.string().parse(organizations.find(({ name }) => name === "Acme")?.id);
    const orbitId = z.string().parse(organizations.find(({ name }) => name === "Orbit")?.id);
    await this.queryDatabase(
      this.primary,
      `update daemons set slug = 'shared-dispatch' where id = any($1::uuid[])`,
      [[acmeDaemon.daemonId, orbitDaemon.daemonId]],
    );
    await Promise.all([
      this.installTenantProviderConfiguration(acmeId, 42, "acme/widgets", "100"),
      this.installTenantProviderConfiguration(orbitId, 84, "orbit/widgets", "200"),
    ]);

    await this.deliverGitHub("acme-github", 42, "acme/widgets", "alice");
    await this.deliverDiscord("301", "100", "800");
    await this.deliverGitHub("orbit-github", 84, "orbit/widgets", "alice");
    await this.deliverDiscord("302", "200", "800");

    const dispatchesSchema = z.array(
      z.object({
        delivery_id: z.string(),
        trigger_organization_id: z.string(),
        config_organization_id: z.string(),
        machine_organization_id: z.string(),
        daemon_id: z.string(),
        daemon_slug: z.literal("shared-dispatch"),
        execution_id: z.string().uuid(),
      }),
    );
    const dispatches = await retryUntil(
      async () =>
        dispatchesSchema.parse(
          await this.queryDatabaseRows(
            this.primary,
            `select r.delivery_id,
                    r.organization_id as trigger_organization_id,
                    c.organization_id as config_organization_id,
                    m.org_id as machine_organization_id,
                    d.id::text as daemon_id,
                    d.slug as daemon_slug,
                    e.id::text as execution_id
             from provider_event_receipts r
             join trigger_runs run on run.provider_event_receipt_id = r.id
             join workflow_step_runs step on step.trigger_run_id = run.id
             join agent_executions e on e.workflow_step_run_id = step.id
             join project_configuration_revisions c on c.id = e.configuration_revision_id
             join machines m on m.id = e.machine_id
             join daemons d on d.machine_id = m.id
             where r.delivery_id = any($1::text[])
             order by r.delivery_id`,
            [["acme-github", "discord-301", "orbit-github", "discord-302"]],
          ),
        ),
      (rows) => rows.length === 4,
    );
    expect(dispatches).toEqual([
      dispatchEvidence("acme-github", acmeId, acmeDaemon.daemonId),
      dispatchEvidence("discord-301", acmeId, acmeDaemon.daemonId),
      dispatchEvidence("discord-302", orbitId, orbitDaemon.daemonId),
      dispatchEvidence("orbit-github", orbitId, orbitDaemon.daemonId),
    ]);
    await Promise.all([acmeDaemon.close(), orbitDaemon.close()]);
    await this.chooseOrganization(alias, "Acme");
  }

  async proveDisconnectedProvidersDrop(): Promise<void> {
    await this.deliverGitHub(
      "acme-github-after-disconnect",
      42,
      "acme/widgets",
      "after-disconnect",
    );
    await this.deliverDiscord("303", "100", "800");
    const dropped = z
      .array(
        z.object({
          delivery_id: z.string(),
          organization_id: z.string(),
          dropped_reason: z.string(),
          executions: z.number(),
        }),
      )
      .parse(
        await this.queryDatabaseRows(
          this.primary,
          `select r.delivery_id, r.organization_id, r.dropped_reason,
                  count(run.id)::integer as executions
           from provider_event_receipts r
           left join trigger_runs run on run.provider_event_receipt_id = r.id
           where r.delivery_id = any($1::text[])
           group by r.id
           order by r.delivery_id`,
          [["acme-github-after-disconnect", "discord-303"]],
        ),
      );
    expect(dropped).toEqual([]);
  }

  async expectMemberConnectionMutationDenied(alias: string): Promise<void> {
    await this.requireUser(alias).expectMemberConnectionMutationDenied();
  }

  async proveProviderNotConfigured(account: Account): Promise<void> {
    const application = await this.startApplication({
      databaseProfile: "fresh",
      providerConnections: false,
    });
    const context = await this.browser.newContext();
    try {
      const user = new HubUser(application.origin, context, await context.newPage());
      await user.signUp(account);
      await user.createOrganization("Unconfigured");
      await user.expectNotConfiguredConnections();
    } finally {
      await context.close();
    }
  }

  async proveManualConfigurationWithoutGitHub(account: Account, rawYaml: string): Promise<void> {
    const application = await this.startApplication({
      databaseProfile: "fresh",
      providerScenario: "discord-only",
    });
    const context = await this.browser.newContext();
    try {
      const page = await context.newPage();
      const user = new HubUser(application.origin, context, page);
      const navigation = new ProjectNavigation(page);
      const configuration = new ProjectConfiguration(page);
      await user.signUp(account);
      await user.createOrganization("Discord only");
      await this.seedDaemonForEmail(application, account.email, "editor-daemon");
      await navigation.openProject("Default");
      await navigation.openProjectSection("Configuration");
      await configuration.saveManualConfiguration(rawYaml);
      await configuration.expectActiveRevision(1);
      await page.waitForLoadState("networkidle");
      expect(application.logs()).not.toContain("github_repositories_unavailable");
    } finally {
      await context.close();
    }
  }

  async proveGitHubApprovalRequired(account: Account): Promise<void> {
    const application = await this.startApplication({
      databaseProfile: "fresh",
      githubApprovalRequired: true,
    });
    const context = await this.browser.newContext();
    try {
      const user = new HubUser(application.origin, context, await context.newPage());
      await user.signUp(account);
      await user.createOrganization("Approval");
      await user.expectGitHubApprovalRequired();
    } finally {
      await context.close();
    }
  }

  async proveConnectionStateBoundaries(account: Account): Promise<void> {
    const application = await this.startApplication({ databaseProfile: "fresh" });
    const context = await this.browser.newContext();
    try {
      const user = new HubUser(application.origin, context, await context.newPage());
      await user.signUp(account);
      await user.createOrganization("State boundaries");
      await user.expectForgedConnectionStateRejected();
      const expired = await user.beginProviderConnection("github");
      await this.queryDatabase(
        application,
        `update organization_connection_attempts
         set expires_at = clock_timestamp() - interval '1 millisecond'`,
        [],
      );
      await user.expectConnectionReturnUnavailable(expired);
      const replayed = await user.beginProviderConnection("github");
      await user.expectConnectionReturnConnected(replayed, "GitHub connected.");
      await user.expectConnectionReturnUnavailable(replayed);
    } finally {
      await context.close();
    }
  }

  async proveProviderConnectionConflicts(account: Account): Promise<void> {
    const application = await this.startApplication({
      databaseProfile: "fresh",
      providerScenario: "conflict",
    });
    const context = await this.browser.newContext();
    try {
      const user = new HubUser(application.origin, context, await context.newPage());
      await user.signUp(account);
      await user.createOrganization("Conflict Acme");
      await user.connectGitHub();
      await user.connectDiscord();
      await user.createAnotherOrganization("Conflict Orbit");
      await user.expectGitHubConnectionConflict();
      await user.expectDiscordConnectionConflict();
    } finally {
      await context.close();
    }
  }

  async proveStaleConnectionScopeReplacement(
    account: Account,
    replacement: Account,
  ): Promise<void> {
    const application = await this.startApplication({ databaseProfile: "fresh" });
    const context = await this.browser.newContext();
    try {
      const user = new HubUser(application.origin, context, await context.newPage());
      await user.signUp(account);
      await user.createOrganization("Stale Acme");
      const staleGitHub = await user.beginProviderConnection("github");
      await user.createAnotherOrganization("Stale Orbit");
      await user.expectConnectionReturnConnectedForOrganization(
        staleGitHub,
        "GitHub connected.",
        "Stale Acme",
      );
      await user.chooseOrganization("Stale Orbit");
      await user.expectNoProviderIdentity("acme-inc");

      const staleDiscord = await user.beginProviderConnection("discord");
      await user.signOut();
      await user.signUp(replacement);
      await user.createOrganization("Replacement");
      await user.expectUntrustedConnectionReturnUnavailable(staleDiscord);
      await user.expectNoProviderIdentity("Acme Guild");
    } finally {
      await context.close();
    }
  }

  async proveProviderStartLocksAccountContext(account: Account): Promise<void> {
    const application = await this.startApplication({ databaseProfile: "fresh" });
    const context = await this.browser.newContext();
    try {
      const user = new HubUser(application.origin, context, await context.newPage());
      await user.signUp(account);
      await user.createOrganization("Redirect Acme");
      await user.createAnotherOrganization("Redirect Orbit");
      await user.chooseOrganization("Redirect Acme");
      await user.expectProviderStartLocksAccountContext("github", "Redirect Orbit");
    } finally {
      await context.close();
    }
  }

  async seedSuspendedGitHubConnection(organizationName: string): Promise<void> {
    await this.queryDatabase(
      this.primary,
      `insert into github_connections
         (organization_id, installation_id, slug, account_id, account_login, account_type, status)
       select id, 42, 'github-suspended-inc', '420', 'suspended-inc', 'Organization', 'suspended'
       from organization where name = $1`,
      [organizationName],
    );
  }

  async expectSuspendedGitHubConnection(alias: string): Promise<void> {
    await this.requireUser(alias).expectSuspendedGitHubConnection();
  }

  async navigateToConnectionsFromMobileSidebar(alias: string): Promise<void> {
    await this.requireUser(alias).navigateToConnectionsFromMobileSidebar();
  }

  async copyInvitationAndExpectFeedback(
    alias: string,
    email: string,
    invitationLink: string,
  ): Promise<void> {
    await this.requireUser(alias).copyInvitationAndExpectFeedback(email, invitationLink);
  }

  async expectTeamDestructiveConfirmations(
    alias: string,
    memberName: string,
    invitationEmail: string,
  ): Promise<void> {
    await this.requireUser(alias).expectTeamDestructiveConfirmations(memberName, invitationEmail);
  }

  async createAnotherOrganization(alias: string, name: string): Promise<void> {
    await this.requireUser(alias).createAnotherOrganization(name);
  }

  async chooseOrganization(alias: string, name: string): Promise<void> {
    await this.requireUser(alias).chooseOrganization(name);
  }

  async rejectOrganizationSwitchAndInvitation(
    alias: string,
    organization: string,
    email: string,
  ): Promise<void> {
    await this.requireUser(alias).rejectOrganizationSwitchAndInvitation(organization, email);
  }

  async proveInvitationLocksOrganizationSwitch(
    alias: string,
    organization: string,
    email: string,
  ): Promise<void> {
    await this.requireUser(alias).proveInvitationLocksOrganizationSwitch(organization, email);
  }

  async inviteMember(alias: string, email: string, role: "admin" | "member"): Promise<string> {
    return this.requireUser(alias).invite(email, role);
  }

  async inviteMembers(alias: string, emails: readonly string[]): Promise<void> {
    for (const email of emails) {
      await this.requireUser(alias).invite(email, "member");
    }
  }

  async openInvitation(alias: string, link: string): Promise<void> {
    const user = await this.user(alias);
    await user.openInvitation(link);
  }

  async acceptInvitation(alias: string): Promise<void> {
    await this.requireUser(alias).acceptInvitation();
  }

  async joinInvitationAs(alias: string, account: Account, link: string): Promise<void> {
    await this.openInvitation(alias, link);
    await this.requireUser(alias).signUpForInvitation(account);
    await this.requireUser(alias).acceptInvitationWithSignOutLocked();
  }

  async joinInvitation(alias: string, link: string): Promise<void> {
    await this.requireUser(alias).openInvitation(link);
    await this.requireUser(alias).acceptInvitation();
  }

  async addNewMember(ownerAlias: string, memberAlias: string, account: Account): Promise<void> {
    const invitation = await this.inviteMember(ownerAlias, account.email, "member");
    await this.joinInvitationAs(memberAlias, account, invitation);
  }

  async addExistingMember(ownerAlias: string, memberAlias: string, email: string): Promise<void> {
    const invitation = await this.inviteMember(ownerAlias, email, "member");
    await this.joinInvitation(memberAlias, invitation);
  }

  async proveInvitationSurvivesSessionExpiry(
    ownerAlias: string,
    owner: Account,
    inviteeAlias: string,
    invitee: Account,
    organization: string,
  ): Promise<void> {
    await this.signUpAs(ownerAlias, owner);
    await this.createOrganization(ownerAlias, organization);
    const invitation = await this.inviteMember(ownerAlias, invitee.email, "member");
    await this.openInvitation(inviteeAlias, invitation);
    const user = this.requireUser(inviteeAlias);
    await user.signUpForInvitation(invitee);
    await this.expireSession(inviteeAlias);
    await user.acceptInvitationAfterSessionExpiry(invitee, invitation, organization);
  }

  async startDaemonRegistration(alias: string): Promise<void> {
    this.sourcePaseo ??= await this.startSourcePaseo();
    const credential = `paseo_cli_${randomUUID().replaceAll("-", "").slice(0, 12)}_${randomUUID().replaceAll("-", "")}`;
    const prefix = credential.slice(0, "paseo_cli_".length + 12);
    await this.queryDatabase(
      this.primary,
      `insert into organization_cli_credentials
         (id, organization_id, prefix, verifier, created_by_user_id)
       select $1, session.active_organization_id, $2, $3, "user".id
       from session join "user" on "user".id = session.user_id
       where lower("user".email) = $4 and session.active_organization_id is not null
         and session.expires_at > now()`,
      [
        randomUUID(),
        prefix,
        createHash("sha256").update(credential).digest("base64url"),
        this.requireUser(alias).accountEmail,
      ],
    );
    this.hubCredentials.set(alias, credential);
  }

  async approveDaemon(alias: string, displayName: string): Promise<string> {
    const credential = this.requireHubCredential(alias);
    const result = await this.requireSourcePaseo().connectWithCredential(
      this.primary.origin,
      credential,
    );
    const daemonId = z.string().uuid().parse(result["daemonId"]);
    await this.queryDatabase(this.primary, "update daemons set slug = $2 where id = $1", [
      daemonId,
      slugify(displayName, "daemon"),
    ]);
    await expect
      .poll(async () => {
        const rows = await this.queryDatabaseRows(
          this.primary,
          "select presence from daemons where id = $1",
          [daemonId],
        );
        return z.array(z.object({ presence: z.string() })).parse(rows)[0]?.presence;
      })
      .toBe("connected");
    return daemonId;
  }

  async expectDaemon(
    alias: string,
    displayName: string,
    daemonId: string,
    state: "Connected" | "Offline" | "Revoked",
  ): Promise<void> {
    await this.requireUser(alias).expectDaemon(displayName, daemonId, state);
  }

  async renameDaemon(alias: string, currentName: string, displayName: string): Promise<void> {
    await this.requireUser(alias).renameDaemon(currentName, displayName);
  }

  async revokeDaemon(alias: string, displayName: string): Promise<void> {
    await this.requireUser(alias).revokeDaemon(displayName);
    const source = this.requireSourcePaseo();
    await source.waitForRelationshipState("revoked");
    expect(await source.reconnectWithRevokedCredential()).toBe(403);
    await source.restart();
    await source.waitForRelationshipState("revoked");
  }

  async proveDaemonIsolation(
    alias: string,
    owningOrganization: string,
    foreignOrganization: string,
    displayName: string,
  ): Promise<void> {
    await this.createAnotherOrganization(alias, foreignOrganization);
    await this.requireUser(alias).expectDaemonAbsent(displayName);
    await this.chooseOrganization(alias, owningOrganization);
  }

  async expectDaemonReadOnly(alias: string, displayName: string): Promise<void> {
    await this.requireUser(alias).expectDaemonReadOnly(displayName);
  }

  async navigateToDaemonsFromMobileSidebar(alias: string): Promise<void> {
    await this.requireUser(alias).navigateToDaemonsFromMobileSidebar();
  }

  async proveDaemonAccessBoundaries(
    ownerAlias: string,
    memberAlias: string,
    memberAccount: Account,
    displayName: string,
  ): Promise<void> {
    await this.proveDaemonIsolation(ownerAlias, "Acme", "Orbit", displayName);
    await this.addNewMember(ownerAlias, memberAlias, memberAccount);
    await this.expectDaemonReadOnly(memberAlias, displayName);
  }

  async proveDaemonBrowserIdentityBoundary(
    alias: string,
    daemonReplacement: Account,
    approvalReplacement: Account,
    displayName: string,
  ): Promise<void> {
    const user = this.requireUser(alias);
    const daemonId = await this.seedDaemon(alias, displayName);
    await user.expectDaemon(displayName, daemonId, "Offline");
    await user.createAnotherOrganizationWithoutDisclosure("Orbit", displayName);
    await user.expectDaemonAbsent(displayName);
    await user.chooseOrganization("Acme");
    await user.expectDaemon(displayName, daemonId, "Offline");
    await user.replaceDaemonAccountWithoutDisclosure(daemonReplacement, "Replacement", displayName);
    const replacementDaemonId = await this.seedDaemon(alias, "replacement-studio");
    await user.expectDaemon("replacement-studio", replacementDaemonId, "Offline");
    await user.replaceDaemonAccountWithoutDisclosure(
      approvalReplacement,
      "Final organization",
      "replacement-studio",
    );
    await user.returnToProjects();
    const finalDaemonId = await this.seedDaemon(alias, "final-studio");
    await user.expectDaemon("final-studio", finalDaemonId, "Offline");
    await this.expireSession(alias);
    await user.attemptStaleRename("final-studio", "leaked-studio");
  }

  async proveDaemonCommandLocksAccountContext(alias: string): Promise<void> {
    const user = this.requireUser(alias);
    await this.chooseOrganization(alias, "Acme");

    const renameDaemonId = await this.seedDaemon(alias, "rename-pending-studio");
    await user.expectDaemon("rename-pending-studio", renameDaemonId, "Offline");
    await user.expectRenameDaemonLocksAccountContext(
      "rename-pending-studio",
      "renamed-pending-studio",
      "Orbit",
    );

    const revokeDaemonId = await this.seedDaemon(alias, "revoke-pending-studio");
    await user.expectDaemon("revoke-pending-studio", revokeDaemonId, "Offline");
    await user.expectRevokeDaemonLocksAccountContext(
      "revoke-pending-studio",
      revokeDaemonId,
      "Orbit",
    );
  }

  async proveDaemonRenameConflict(alias: string): Promise<void> {
    await this.seedDaemon(alias, "reserved-studio");
    await this.seedDaemon(alias, "rename-source-studio");
    await this.requireUser(alias).expectDaemonRenameConflict(
      "rename-source-studio",
      "reserved-studio",
    );
  }

  async approveCliLogin(alias: string): Promise<void> {
    const request = await this.startRegistrationRequest("CLI login");
    const user = this.requireUser(alias);
    await user.openCliLoginApproval(request.verificationUrl, "Acme");
    await user.approveCliLogin();
    await this.queryDatabase(
      this.primary,
      "update cli_authorizations set next_poll_at = now() where status = 'approved'",
      [],
    );
    const poll = await this.requests.post(`${this.primary.origin}/api/v1/cli-authorizations/poll`, {
      data: { deviceCode: request.deviceCode },
    });
    const credential = z
      .object({ status: z.literal("authorized"), credential: z.string() })
      .parse(await poll.json()).credential;
    const projects = await this.requests.get(`${this.primary.origin}/api/v1/projects`, {
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(projects.status()).toBe(200);
    const replay = await this.requests.post(
      `${this.primary.origin}/api/v1/cli-authorizations/poll`,
      { data: { deviceCode: request.deviceCode } },
    );
    expect(await replay.json()).toEqual(expect.objectContaining({ status: "disclosed" }));
    this.expectRegistrationSecretsAbsentFromLogs(request.deviceCode);
  }

  async denyCliLogin(alias: string): Promise<void> {
    const request = await this.startRegistrationRequest("CLI login");
    await this.requireUser(alias).openCliLoginApproval(request.verificationUrl, "Acme");
    await this.requireUser(alias).denyCliLogin();
    const poll = await this.requests.post(`${this.primary.origin}/api/v1/cli-authorizations/poll`, {
      data: { deviceCode: request.deviceCode },
    });
    expect(await poll.json()).toEqual(expect.objectContaining({ status: "denied" }));
    this.expectRegistrationSecretsAbsentFromLogs(request.deviceCode);
    await this.requireUser(alias).expectCliLoginUnavailable(request.verificationUrl);
  }

  async expireCliLogin(alias: string): Promise<void> {
    const request = await this.startRegistrationRequest("CLI login");
    await this.queryDatabase(
      this.primary,
      "update cli_authorizations set expires_at = now() - interval '1 minute'",
      [],
    );
    await this.requireUser(alias).expectCliLoginUnavailable(request.verificationUrl);
  }

  async establishOrganizationIsolation(journey: OrganizationIsolationJourney): Promise<void> {
    await this.signUpAs(journey.owner.alias, journey.owner.account);
    await this.createOrganization(journey.owner.alias, journey.first.name);
    await this.addNewMember(
      journey.owner.alias,
      journey.sharedMember.alias,
      journey.sharedMember.account,
    );
    await this.addNewMember(
      journey.owner.alias,
      journey.first.member.alias,
      journey.first.member.account,
    );
    await this.inviteMember(journey.owner.alias, journey.first.pendingInvitation, "member");
    await this.createAnotherOrganization(journey.owner.alias, journey.second.name);
    await this.addExistingMember(
      journey.owner.alias,
      journey.sharedMember.alias,
      journey.sharedMember.account.email,
    );
    await this.addNewMember(
      journey.owner.alias,
      journey.second.member.alias,
      journey.second.member.account,
    );
    await this.inviteMember(journey.owner.alias, journey.second.pendingInvitation, "member");
  }

  async expectActiveOrganization(alias: string, name: string): Promise<void> {
    await this.requireUser(alias).expectActiveOrganization(name);
  }

  async expectMemberBoundary(alias: string, organizationName: string): Promise<void> {
    await this.requireUser(alias).expectMemberBoundary(organizationName);
  }

  async changeMemberRole(
    actorAlias: string,
    memberName: string,
    role: "owner" | "admin" | "member",
  ): Promise<void> {
    await this.requireUser(actorAlias).changeMemberRole(memberName, role);
  }

  async proveAdminInvitation(alias: string, email: string): Promise<void> {
    await this.requireUser(alias).invite(email, "member");
  }

  async expectOrganizationTeam(alias: string, expected: TeamExpectation): Promise<void> {
    await this.requireUser(alias).expectTeam(expected);
  }

  async signOut(alias: string): Promise<void> {
    await this.requireUser(alias).signOut();
  }

  async establishLoadedTeam(
    alias: string,
    account: Account,
    organization: string,
    pendingInvitation: string,
  ): Promise<void> {
    await this.signUpAs(alias, account);
    await this.createOrganization(alias, organization);
    await this.inviteMember(alias, pendingInvitation, "member");
  }

  async expireSession(alias: string): Promise<void> {
    await this.queryDatabase(
      this.primary,
      `update session set expires_at = now() - interval '1 minute'
       from "user" where session.user_id = "user".id and lower("user".email) = $1`,
      [this.requireUser(alias).accountEmail],
    );
  }

  /** An enrolled daemon whose slug configurations can reference by name. */
  async seedDaemonSlug(alias: string, slug: string): Promise<string> {
    return this.seedDaemon(alias, slug);
  }

  /** A connected app precondition for trigger-editor journeys; OAuth itself has separate specs. */
  async seedSlackConnection(alias: string, slug: string, teamName: string): Promise<void> {
    await this.queryDatabase(
      this.primary,
      `insert into slack_connections
         (organization_id, team_id, slug, team_name, bot_user_id, bot_access_token, scopes,
          connected_by_user_id)
       select session.active_organization_id, $1, $2, $3, 'BROWSER_BOT', 'browser-token',
              '["app_mentions:read","chat:write"]'::jsonb, "user".id
       from session join "user" on "user".id = session.user_id
       where lower("user".email) = $4 and session.expires_at > now()`,
      [`browser-${randomUUID()}`, slug, teamName, this.requireUser(alias).accountEmail],
    );
  }

  /** A migrated workflow precondition for the compatibility lane in the trigger editor. */
  async seedLegacyTrigger(alias: string, name: string, yaml: string): Promise<void> {
    const triggerId = randomUUID();
    const revisionId = randomUUID();
    const [identity] = z
      .array(z.object({ organization_id: z.string(), user_id: z.string() }))
      .parse(
        await this.queryDatabaseRows(
          this.primary,
          `select member.organization_id, "user".id as user_id
           from "user" join member on member.user_id = "user".id
           where lower("user".email) = $1
           order by member.created_at
           limit 1`,
          [this.requireUser(alias).accountEmail],
        ),
      );
    expect(identity).toBeDefined();
    await this.queryDatabase(
      this.primary,
      `insert into organization_triggers
         (id, organization_id, name, enabled, format, runtime_project_id)
       values ($1, $2, $3, true, 'legacy_multistep', null)`,
      [triggerId, identity!.organization_id, name],
    );
    await this.queryDatabase(
      this.primary,
      `insert into organization_trigger_revisions
         (id, trigger_id, organization_id, version, yaml, normalized_configuration,
          content_hash, source_kind, source_evidence, created_by_user_id)
       values ($1, $2, $3, 1, $4, '{"environments":[],"triggers":[]}'::jsonb, $5,
               'manual', '{"conversionBlockers":["multiple steps require manual migration"]}'::jsonb,
               $6)`,
      [
        revisionId,
        triggerId,
        identity!.organization_id,
        yaml,
        `browser-${randomUUID()}`,
        identity!.user_id,
      ],
    );
    await this.queryDatabase(
      this.primary,
      `update organization_triggers set active_revision_id = $2 where id = $1`,
      [triggerId, revisionId],
    );
    const seeded = z
      .array(z.object({ name: z.string() }))
      .parse(
        await this.queryDatabaseRows(
          this.primary,
          `select name from organization_triggers where id = $1 and active_revision_id = $2`,
          [triggerId, revisionId],
        ),
      );
    expect(seeded).toEqual([{ name }]);
  }

  private async seedDaemon(alias: string, displayName: string): Promise<string> {
    return this.seedDaemonForEmail(this.primary, this.requireUser(alias).accountEmail, displayName);
  }

  private async seedDaemonForEmail(
    application: BuiltApplication,
    accountEmail: string,
    displayName: string,
  ): Promise<string> {
    const daemonId = randomUUID();
    const machineId = randomUUID();
    await this.queryDatabase(
      application,
      `insert into machines (id, org_id, source, status)
       select $1, session.active_organization_id,
              jsonb_build_object('kind', 'daemon', 'daemonId', $2::text), 'alive'
       from session join "user" on "user".id = session.user_id
       where lower("user".email) = $3 and session.expires_at > now()`,
      [machineId, daemonId, accountEmail],
    );
    await this.queryDatabase(
      application,
      `insert into daemons
         (id, idempotency_key, enrollment_verifier, slug, machine_id, organization_id, server_id,
          daemon_public_key, credential_verifier, scopes, status)
       values ($1, $2, $3, $4, $5, (select org_id from machines where id = $5),
               'browser-boundary', 'public-key',
               'credential-verifier', '["hub.execution.*"]'::jsonb, 'active')`,
      [daemonId, randomUUID(), randomUUID(), displayName, machineId],
    );
    return daemonId;
  }

  async revokeActiveMembership(alias: string): Promise<void> {
    await this.queryDatabase(
      this.primary,
      `delete from member using "user"
       where member.user_id = "user".id and lower("user".email) = $1
         and member.organization_id in (
           select active_organization_id from session
           where user_id = "user".id and active_organization_id is not null
         )`,
      [this.requireUser(alias).accountEmail],
    );
  }

  async attemptInvitationFromLoadedTeam(alias: string, email: string): Promise<void> {
    await this.requireUser(alias).attemptInvitation(email);
  }

  async expectSignedOutWithoutCachedTeam(alias: string, cachedValues: string[]): Promise<void> {
    await this.requireUser(alias).expectCachedTeamCleared("signedOut", cachedValues);
  }

  async expectOrganizationRequiredWithoutCachedTeam(
    alias: string,
    cachedValues: string[],
  ): Promise<void> {
    await this.requireUser(alias).expectCachedTeamCleared("organizationRequired", cachedValues);
  }

  private async user(alias: string): Promise<HubUser> {
    const existing = this.users.get(alias);
    if (existing !== undefined) return existing;
    let context: BrowserContext;
    let page: Page;
    if (this.users.size === 0) {
      context = this.page.context();
      page = this.page;
    } else {
      context = await this.browser.newContext();
      page = await context.newPage();
    }
    const user = new HubUser(this.primary.origin, context, page);
    this.users.set(alias, user);
    return user;
  }

  private requireUser(alias: string): HubUser {
    const user = this.users.get(alias);
    if (user === undefined) throw new Error(`unknown browser account: ${alias}`);
    return user;
  }

  private requireHubCredential(alias: string): string {
    const credential = this.hubCredentials.get(alias);
    if (credential === undefined) throw new Error(`no Hub credential for ${alias}`);
    return credential;
  }

  private requireSourcePaseo(): SourcePaseo {
    if (this.sourcePaseo === undefined) throw new Error("Source-built Paseo has not started");
    return this.sourcePaseo;
  }

  private expectRegistrationSecretsAbsentFromLogs(deviceCode: string): void {
    const credentialSecret = createHash("sha256")
      .update("paseo-cli-credential\0")
      .update(deviceCode)
      .digest("base64url");
    expect(this.primary.logs()).not.toContain(deviceCode);
    expect(this.primary.logs()).not.toContain(credentialSecret);
  }

  private async startRegistrationRequest(_displayName: string) {
    const response = await this.requests.post(`${this.primary.origin}/api/v1/cli-authorizations`, {
      data: {},
    });
    expect(response.status()).toBe(201);
    const request = z
      .object({
        deviceCode: z.string(),
        userCode: z.string(),
        verificationUriComplete: z.string().url(),
      })
      .parse(await response.json());
    return { ...request, verificationUrl: request.verificationUriComplete };
  }

  private async connectBrowserDaemon(
    _alias: string,
    organizationName: string,
    _displayName: string,
  ): Promise<ContractDaemon> {
    const enrollmentToken = randomUUID();
    const verifier = createHash("sha256").update(enrollmentToken).digest("base64url");
    await this.queryDatabase(
      this.primary,
      `insert into daemon_enrollment_tokens (id, verifier, organization_id, expires_at)
       select $1, $2, id, now() + interval '10 minutes' from organization where name = $3`,
      [randomUUID(), verifier, organizationName],
    );
    const daemon = new ContractDaemon(this.primary, this.requests);
    await daemon.enroll(enrollmentToken);
    await daemon.connect();
    return daemon;
  }

  private async installTenantProviderConfiguration(
    organizationId: string,
    repositoryId: number,
    repo: string,
    guildId: string,
  ): Promise<void> {
    const [discord] = z.array(z.object({ slug: z.string() })).parse(
      await this.queryDatabaseRows(
        this.primary,
        `select slug from discord_connections
         where organization_id = $1 and guild_id = $2`,
        [organizationId, guildId],
      ),
    );
    if (discord === undefined) throw new Error("Discord connection unavailable");
    await this.primary.installProviderDispatchFixture({
      organizationId,
      repositoryId,
      repository: repo,
      guildId,
      files: configurationBundleFixture(dump(providerDispatchConfiguration(repo, discord.slug))),
    });
  }

  private async deliverGitHub(
    deliveryId: string,
    installationId: number,
    repo: string,
    actor: string,
  ): Promise<void> {
    const payload = JSON.stringify(githubIssueCommentPayload(installationId, repo, actor));
    const signature =
      "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
    const response = await this.requests.post(`${this.primary.origin}/webhook`, {
      headers: {
        "content-type": "application/json",
        "x-github-delivery": deliveryId,
        "x-github-event": "issue_comment",
        "x-hub-signature-256": signature,
      },
      data: Buffer.from(payload),
    });
    expect(response.status()).toBe(200);
  }

  private deliverDiscord(messageId: string, guildId: string, authorId: string): Promise<void> {
    return this.primary.deliverDiscord({
      guildId,
      channelId: `${guildId}0`,
      messageId,
      authorId,
      authorUsername: authorId,
      content: "<@900> run tenant dispatch",
    });
  }

  private async queryDatabase(
    application: BuiltApplication,
    text: string,
    values: readonly unknown[],
  ): Promise<void> {
    await application.query(text, values);
  }

  private async queryDatabaseRows(
    application: BuiltApplication,
    text: string,
    values: readonly unknown[],
  ): Promise<unknown[]> {
    return await application.query(text, values);
  }

  private async verifyManualApplication(application: BuiltApplication): Promise<void> {
    await this.verifyExactContracts(application, manualFailureContracts(application.machineKey));
    await this.verifyLegacyCompletionCallbackAbsent(application);
    await this.verifyDocumentAndAssetContracts(application);
    await this.verifyAuthContracts(application);
    await this.verifyOrganizationPostOriginBoundary(application);
    await this.verifyHostileOriginBoundary(application);

    const enrollmentToken = await this.issueEnrollmentToken(application);
    const daemon = new ContractDaemon(application, this.requests);
    await daemon.enroll(enrollmentToken);
    await daemon.connect();
    const versionId = await this.installManualConfiguration(application, daemon.slug);
    const execution = await this.runManualExecution(application, versionId);
    await this.completeExecution(application, execution.executionId, daemon);
    await daemon.expectUnauthorizedRevocation();
    await daemon.revoke();
    await this.expectEnrollmentReplayDenied(application, enrollmentToken);
  }

  private async verifyWebhookApplication(application: BuiltApplication): Promise<void> {
    await this.verifyExactContracts(application, WEBHOOK_SOURCE_CONTRACTS);
    const payload = JSON.stringify({
      action: "created",
      installation: { id: 42 },
      repository: { full_name: "acme/widgets" },
    });
    const signature =
      "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
    await this.verifyExactContract(application, {
      name: "active webhook accepts a signed delivery",
      request: {
        path: "/webhook",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "built-contract-delivery",
          "x-github-event": "issue_comment",
          "x-hub-signature-256": signature,
        },
        body: payload,
      },
      expected: { status: 200, body: "OK", headers: { "content-type": TEXT_TYPE } },
    });
  }

  private async verifyExactContracts(
    application: BuiltApplication,
    contracts: readonly HttpContract[],
  ): Promise<void> {
    for (const contract of contracts) await this.verifyExactContract(application, contract);
  }

  private async verifyExactContract(
    application: BuiltApplication,
    contract: HttpContract,
  ): Promise<void> {
    const response = await this.requests.fetch(`${application.origin}${contract.request.path}`, {
      method: contract.request.method,
      ...(contract.request.headers === undefined ? {} : { headers: contract.request.headers }),
      ...(contract.request.body === undefined ? {} : { data: Buffer.from(contract.request.body) }),
    });
    expect(response.status(), contract.name).toBe(contract.expected.status);
    expect(await response.text(), contract.name).toBe(contract.expected.body);
    for (const [name, value] of Object.entries(contract.expected.headers)) {
      expect(response.headers()[name], contract.name).toBe(value);
    }
  }

  private async verifyDocumentAndAssetContracts(application: BuiltApplication): Promise<void> {
    const home = await this.requests.get(application.origin);
    expect(home.status()).toBe(200);
    expect(home.headers()["content-type"]).toBe(HTML_TYPE);
    const document = await home.text();
    // The server render precedes session resolution, so the shell it paints must not
    // claim either signed-in or signed-out.
    expect(document).toContain("Loading Paseo Hub");
    expect(document).not.toContain("Sign in to Paseo Hub");
    const assetPath = z.string().parse(document.match(/\/assets\/[A-Za-z0-9._-]+\.css/u)?.[0]);
    const asset = await this.requests.get(`${application.origin}${assetPath}`);
    expect(asset.status()).toBe(200);
    expect(asset.headers()["content-type"]).toBe("text/css; charset=utf-8");
    expect(asset.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect((await asset.body()).byteLength).toBeGreaterThan(0);
    await this.verifyExactContract(application, {
      name: "missing asset",
      request: { path: "/assets/missing.css", method: "GET" },
      expected: { status: 404, body: "Not Found", headers: { "content-type": TEXT_TYPE } },
    });
  }

  private async verifyAuthContracts(application: BuiltApplication): Promise<void> {
    await this.verifyExactContract(application, {
      name: "signed-out session",
      request: { path: "/api/auth/get-session", method: "GET" },
      expected: { status: 200, body: "null", headers: { "content-type": JSON_TYPE } },
    });
    const account = {
      name: "Contract Operator",
      email: "contract@example.com",
      password: "contract-password",
    };
    const signUp = await this.requests.post(`${application.origin}/api/auth/sign-up/email`, {
      data: account,
    });
    expect(signUp.status()).toBe(200);
    expect(signUp.headers()["content-type"]).toBe(JSON_TYPE);
    expect(signUp.headers()["set-cookie"]).toContain("better-auth.session_token=");
    expect(await signUp.json()).toEqual({
      token: expect.any(String),
      user: expect.objectContaining({ name: account.name, email: account.email }),
    });
    const session = await this.requests.get(`${application.origin}/api/auth/get-session`);
    expect(session.status()).toBe(200);
    expect(await session.json()).toEqual({
      session: expect.objectContaining({ token: expect.any(String), userId: expect.any(String) }),
      user: expect.objectContaining({ name: account.name, email: account.email }),
    });
    const rejected = await this.requests.post(`${application.origin}/api/auth/sign-in/email`, {
      headers: { origin: application.origin },
      data: { email: account.email, password: "wrong-password" },
    });
    expect(rejected.status()).toBe(401);
    expect(rejected.headers()["content-type"]).toBe(JSON_TYPE);
    expect(await rejected.json()).toEqual({
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "Invalid email or password",
    });
  }

  private async verifyOrganizationPostOriginBoundary(application: BuiltApplication): Promise<void> {
    const sameOrigin = { origin: application.origin, "sec-fetch-site": "same-origin" };
    const post = (path: string, data: unknown, headers: Record<string, string> = sameOrigin) =>
      this.requests.post(`${application.origin}${path}`, { headers, data });

    expect((await post("/api/auth/organization/create", {})).status()).toBe(404);

    const originFailures = [
      {
        name: "hostile origin",
        headers: { origin: HOSTILE_ORIGIN },
        error: { message: "Invalid origin", code: "INVALID_ORIGIN" },
      },
      {
        name: "missing origin",
        headers: {},
        error: { message: "Missing or null Origin", code: "MISSING_OR_NULL_ORIGIN" },
      },
      {
        name: "null origin",
        headers: { origin: "null" },
        error: { message: "Missing or null Origin", code: "MISSING_OR_NULL_ORIGIN" },
      },
      {
        name: "cross-site Fetch Metadata",
        headers: { origin: application.origin, "sec-fetch-site": "cross-site" },
        error: {
          message: "Cross-site navigation login blocked. This request appears to be a CSRF attack.",
          code: "CROSS_SITE_NAVIGATION_LOGIN_BLOCKED",
        },
      },
    ];
    for (const path of ORGANIZATION_POST_PATHS) {
      for (const boundary of originFailures) {
        const response = await post(path, {}, boundary.headers);
        expect(response.status(), `${boundary.name}: ${path}`).toBe(403);
        expect(await response.json(), `${boundary.name}: ${path}`).toEqual(boundary.error);
      }
    }
  }

  private async verifyHostileOriginBoundary(application: BuiltApplication): Promise<void> {
    await this.verifyExactContract(application, {
      name: "hostile origin cannot create an auth session",
      request: {
        path: "/api/auth/sign-up/email",
        method: "POST",
        headers: { "content-type": "application/json", origin: HOSTILE_ORIGIN },
        body: JSON.stringify({
          name: "Hostile Operator",
          email: "hostile@example.com",
          password: "hostile-password",
        }),
      },
      expected: {
        status: 403,
        body: '{"message":"Invalid origin","code":"INVALID_ORIGIN"}',
        headers: { "content-type": JSON_TYPE },
      },
    });
    await this.issueEnrollmentToken(application, {
      ...machineHeaders(application.machineKey),
      origin: HOSTILE_ORIGIN,
    });

    for (const contract of [
      {
        name: "Better Auth rejects a hostile cookie origin",
        headers: { "content-type": "application/json", origin: HOSTILE_ORIGIN },
        body: '{"message":"Invalid origin","code":"INVALID_ORIGIN"}',
      },
      {
        name: "Better Auth rejects a missing cookie origin",
        headers: { "content-type": "application/json" },
        body: '{"message":"Missing or null Origin","code":"MISSING_OR_NULL_ORIGIN"}',
      },
      {
        name: "Better Auth rejects a null cookie origin",
        headers: { "content-type": "application/json", origin: "null" },
        body: '{"message":"Missing or null Origin","code":"MISSING_OR_NULL_ORIGIN"}',
      },
    ]) {
      await this.verifyExactContract(application, {
        name: contract.name,
        request: {
          path: "/api/auth/sign-out",
          method: "POST",
          headers: contract.headers,
          body: "{}",
        },
        expected: { status: 403, body: contract.body, headers: { "content-type": JSON_TYPE } },
      });
    }
  }

  /**
   * What `paseo hub login` leaves behind on the operator's own machine: a daemon enrolled into
   * their organization and holding a live connection. The enrollment token is written straight
   * to the database because the CLI's own path through it is the Paseo repository's to prove.
   */
  private async enrollOperatorDaemon(application: BuiltApplication): Promise<string> {
    const enrollmentToken = randomUUID();
    await application.issueDaemonEnrollment(
      createHash("sha256").update(enrollmentToken).digest("base64url"),
    );
    const daemon = new ContractDaemon(application, this.requests);
    await daemon.enroll(enrollmentToken);
    await daemon.connect();
    return daemon.slug;
  }

  private async issueEnrollmentToken(
    application: BuiltApplication,
    headers: Record<string, string> = machineHeaders(application.machineKey),
  ): Promise<string> {
    const response = await this.requests.post(
      `${application.origin}/api/v1/daemons/enrollment-tokens`,
      { headers },
    );
    expect(response.status()).toBe(201);
    expect(response.headers()["content-type"]).toBe(JSON_TYPE);
    const body = z
      .object({ token: z.string().min(1), expiresAt: z.string().datetime() })
      .strict()
      .parse(await response.json());
    return body.token;
  }

  private async installManualConfiguration(
    application: BuiltApplication,
    daemonSlug: string,
  ): Promise<string> {
    const response = await this.requests.post(
      `${application.origin}/api/v1/configurations/install`,
      {
        headers: machineHeaders(application.machineKey),
        data: {
          projectSlug: "default",
          files: configurationBundleFixture(manualConfiguration(daemonSlug)),
        },
      },
    );
    expect(response.status()).toBe(201);
    expect(response.headers()["content-type"]).toBe(JSON_TYPE);
    const body = z
      .object({
        projectSlug: z.literal("default"),
        versionId: z.string().uuid(),
        version: z.literal(1),
        active: z.literal(true),
      })
      .strict()
      .parse(await response.json());
    return body.versionId;
  }

  private async runManualExecution(
    application: BuiltApplication,
    versionId: string,
  ): Promise<{ executionId: string }> {
    const response = await this.requests.post(`${application.origin}/api/v1/manual-runs`, {
      headers: machineHeaders(application.machineKey),
      data: {
        projectSlug: "default",
        expectedVersionId: versionId,
        trigger: "deploy",
        actor: "contract-operator",
        deliveryKey: "built-contract-run",
        input: { service: "api" },
      },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe(JSON_TYPE);
    const body = z
      .object({
        deliveryKey: z.literal("built-contract-run"),
        providerEventReceiptId: z.string().uuid(),
        triggerRunId: z.string().uuid(),
        configuredTriggerName: z.literal("deploy"),
        workflowStatus: z.literal("running"),
      })
      .strict()
      .parse(await response.json());
    const execution = await retryUntil(
      async () =>
        z.array(z.object({ id: z.string().uuid() })).parse(
          await this.queryDatabaseRows(
            application,
            `select execution.id
               from agent_executions execution
               join workflow_step_runs step on step.agent_execution_id = execution.id
               join trigger_runs run on run.id = step.trigger_run_id
               where run.provider_event_receipt_id = $1`,
            [body.providerEventReceiptId],
          ),
        ),
      (rows) => rows.length === 1,
    );
    return { executionId: execution[0]!.id };
  }

  private async completeExecution(
    application: BuiltApplication,
    executionId: string,
    daemon: ContractDaemon,
  ): Promise<void> {
    const capability = await daemon.executionCapability(executionId);
    const client = new McpClient({ name: "paseo-hub-browser-contract", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(capability.url), {
      requestInit: { headers: capability.headers },
    });
    try {
      // The SDK's getter is typed `string | undefined` while its Transport interface uses an
      // exact-optional `sessionId?: string`; the runtime class is the SDK's official transport.
      // @ts-expect-error upstream SDK exactOptionalPropertyTypes mismatch
      await client.connect(transport);
      const result = await client.callTool({ name: "finish_execution", arguments: {} });
      expect(result.isError).toBeUndefined();
      expect(result.content).toEqual([{ type: "text", text: "Execution finished" }]);
    } finally {
      await client.close();
    }
  }

  private async expectEnrollmentReplayDenied(
    application: BuiltApplication,
    enrollmentToken: string,
  ): Promise<void> {
    const response = await this.requests.post(`${application.origin}/api/daemons/enroll`, {
      headers: {
        authorization: `Bearer ${enrollmentToken}`,
        "content-type": "application/json",
      },
      data: daemonEnrollment(randomUUID(), randomUUID()),
    });
    expect(response.status()).toBe(401);
    expect(await response.text()).toBe('{"error":"invalid enrollment token"}');
    expect(response.headers()["content-type"]).toBe(JSON_TYPE);
  }

  private async verifyLegacyCompletionCallbackAbsent(application: BuiltApplication): Promise<void> {
    const response = await this.requests.post(
      `${application.origin}/agent-executions/00000000-0000-4000-8000-000000000000/done`,
    );
    expect(response.status(), "legacy execution completion callback is unavailable").toBe(404);
  }
}

class HubUser {
  private email: string | undefined;
  private readonly navigation: ProjectNavigation;

  constructor(
    private readonly origin: string,
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {
    this.navigation = new ProjectNavigation(page);
  }

  async signUp(account: Account): Promise<void> {
    this.email = account.email.toLowerCase();
    if (this.page.url() === "about:blank") await this.page.goto(this.origin);
    await this.submitSignUp(account);
    await expect(this.page.getByRole("heading", { name: "Choose an organization" })).toBeVisible();
  }

  async completeBootstrapJourney(
    account: Account,
    replacementPassword: string,
    organizationName: string,
  ): Promise<void> {
    await this.page.goto(this.origin);
    const signIn = this.page.getByRole("form", { name: "Sign in" });
    await signIn.getByLabel("Email").fill(account.email);
    await signIn.getByLabel("Password").fill(account.password);
    await signIn.getByRole("button", { name: "Sign in" }).click();
    await expect(this.page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await expectAccessible(this.page);

    const change = this.page.getByRole("form", { name: "Choose a new password" });
    await change.getByLabel("Current password").fill(account.password);
    await change
      .getByRole("textbox", { name: "New password", exact: true })
      .fill(replacementPassword);
    await change.getByLabel("Confirm new password").fill(replacementPassword);
    await change.getByRole("button", { name: "Save password" }).click();
    await this.skipAppSetup();
    await this.expectActiveOrganization(organizationName);
  }

  /**
   * A new instance operator meets app setup before the dashboard. Journeys that are not about
   * apps pass straight through it, which is exactly what the operator can do.
   */
  async skipAppSetup(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Set up your apps" })).toBeVisible();
    await this.page.getByRole("button", { name: "Do this later", exact: true }).click();
    // Apps are followed by the daemon handoff. A journey that is not about either walks through
    // both, exactly as the operator can, and lands on organization triggers.
    await expect(this.page.getByRole("heading", { name: "Connect a daemon" })).toBeVisible();
    await this.page.getByRole("button", { name: "Do this later", exact: true }).click();
    await expect(this.page.getByRole("heading", { name: "Triggers", exact: true })).toBeVisible();
  }

  async completeFirstRunJourney(
    account: Account,
    armAccountSetupFailure: () => Promise<void>,
  ): Promise<void> {
    await this.expectFirstRunWelcome();
    await this.openFirstRunSetupForm();
    await this.captureFirstRunForm("first-run-account.desktop");
    await this.expectFirstRunPasswordRefused(account);
    await this.expectFirstRunBackReturnsToWelcome();
    // The operator can finish on a phone without a pointer at all — and recover in place when
    // the server refuses the first attempt.
    await this.page.setViewportSize({ width: 390, height: 844 });
    await this.openFirstRunSetupForm();
    await this.captureFirstRunForm("first-run-account.mobile");
    await this.completeFirstRunClaimWithKeyboard(account, armAccountSetupFailure);
    await this.page.setViewportSize({ width: 1280, height: 800 });
    await expect(this.page.getByText(account.email, { exact: true })).toBeVisible();
    // Keyboard control survives both the mobile onboarding arrival and the resize: closing the
    // drawer restores its trigger, and that same control remains focused in the desktop header.
    await expect(
      this.page.getByRole("main").getByRole("button", { name: "Toggle Sidebar" }),
    ).toBeFocused();

    // Setup provisioned a working organization, not just a row: organization triggers render.
    await this.navigation.expectBreadcrumb(INTERACTIVE_ORGANIZATION_NAME, "Triggers");
    await this.returnToProjects();
    // The instance operator surface is the proof that this account owns the instance, not just
    // its organization: the console refuses anyone without the flag, server-side.
    await this.openOperatorConsole();
    await this.returnToProjects();

    await this.signOut();
    await this.page.goto(this.origin);
    await expect(this.page.getByRole("heading", { name: "Sign in to Paseo Hub" })).toBeVisible();
    await expect(this.page.getByRole("heading", { name: "Welcome to Paseo Hub" })).toHaveCount(0);
    await expectAccessible(this.page);

    // The chosen password is final — there is no temporary-password gate to pass through.
    const signIn = this.page.getByRole("form", { name: "Sign in" });
    await signIn.getByLabel("Email").fill(account.email);
    await signIn.getByLabel("Password").fill(account.password);
    await signIn.getByRole("button", { name: "Sign in" }).click();
    await expect(this.page.getByRole("heading", { name: "Triggers", exact: true })).toBeVisible();
    await this.expectActiveOrganization(INTERACTIVE_ORGANIZATION_NAME);
  }

  /** The welcome screen, first at phone width and then on the desktop layout it scales up to. */
  private async expectFirstRunWelcome(): Promise<void> {
    await this.page.setViewportSize({ width: 390, height: 844 });
    await this.page.goto(this.origin);
    const welcome = this.page.getByRole("heading", { name: "Welcome to Paseo Hub" });
    await expect(welcome).toBeVisible();
    await expect(welcome).toBeFocused();
    await expect(this.page.getByRole("button", { name: "Set up Paseo Hub" })).toBeInViewport();
    await expectAccessible(this.page);
    await this.page.setViewportSize({ width: 1280, height: 800 });
    await expect(welcome).toBeVisible();
  }

  async openFirstRunSetupForm(): Promise<void> {
    await this.page.goto(this.origin);
    const begin = this.page.getByRole("button", { name: "Set up Paseo Hub" });
    await expect(begin).toBeVisible();
    await this.page.keyboard.press("Tab");
    await expect(begin).toBeFocused();
    await this.page.keyboard.press("Enter");
    const form = this.page.getByRole("form", { name: "Create your account" });
    await expect(form).toBeVisible();
    await expect(form.getByLabel("Email")).toBeVisible();
    await expect(form.getByLabel("Password")).toBeVisible();
    await expect(form.getByLabel("Name", { exact: true })).toHaveCount(0);
    await expect(form.getByLabel("Organization name")).toHaveCount(0);
    // The card that replaced the screen takes focus; the next Tab reaches its first field.
    await expect(this.page.getByRole("heading", { name: "Create your account" })).toBeFocused();
    await expectAccessible(this.page);
  }

  private async captureFirstRunForm(name: string): Promise<void> {
    await this.page.screenshot({
      path: `${SHOTS}/${name}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }

  /** Leaving setup returns to the welcome card, and takes focus back with it. */
  private async expectFirstRunBackReturnsToWelcome(): Promise<void> {
    await this.page.getByRole("button", { name: "Back" }).click();
    const welcome = this.page.getByRole("heading", { name: "Welcome to Paseo Hub" });
    await expect(welcome).toBeVisible();
    await expect(welcome).toBeFocused();
  }

  /** A password below the instance minimum never reaches the server. */
  private async expectFirstRunPasswordRefused(account: Account): Promise<void> {
    await this.fillFirstRunSetupForm({ ...account, password: "short" });
    await expect(this.page.getByRole("form", { name: "Create your account" })).toBeVisible();
    await expect(this.page.getByRole("heading", { name: "Triggers", exact: true })).toHaveCount(0);
  }

  async completeFirstRunClaim(account: Account): Promise<void> {
    this.email = account.email.toLowerCase();
    await this.fillFirstRunSetupForm(account);
    await this.expectFirstRunDashboard();
  }

  /**
   * The account created from the keyboard only, with the server refusing the first attempt. The
   * failure is armed inside the built application, so the browser gets a real server answer: the
   * message is announced and focused, the form keeps what was typed, and submitting it again
   * succeeds without leaving the screen.
   */
  private async completeFirstRunClaimWithKeyboard(
    account: Account,
    armAccountSetupFailure: () => Promise<void>,
  ): Promise<void> {
    this.email = account.email.toLowerCase();
    const form = this.page.getByRole("form", { name: "Create your account" });
    for (const value of [account.email, account.password]) {
      await this.page.keyboard.press("Tab");
      await this.page.keyboard.type(value);
    }
    await expect(form.getByLabel("Password")).toBeFocused();

    await armAccountSetupFailure();
    await this.page.keyboard.press("Enter");
    const alert = this.page.getByRole("alert");
    await expect(alert).toContainText(
      "Hub couldn't finish the first account setup. Reload the page to confirm whether this instance has already been claimed.",
    );
    await expect(alert).toBeFocused();
    await expect(form.getByLabel("Email")).toHaveValue(account.email);
    await expect(form.getByLabel("Password")).toHaveValue(account.password);
    await expectAccessible(this.page);

    await form.getByRole("button", { name: "Create account" }).click();
    await this.expectFirstRunDashboard();
  }

  /** The dashboard the claim lands on. The signed-in identity lives in the desktop sidebar, so
   * the journey asserts it once it is back at desktop width. */
  private async expectFirstRunDashboard(): Promise<void> {
    await this.skipAppSetup();
    await this.expectActiveOrganization(INTERACTIVE_ORGANIZATION_NAME);
  }

  /**
   * A form that was opened before someone else created the first account. Submitting it lands on
   * the ordinary sign-in screen — no explanation of instance state, no conflict screen, and the
   * arriving card takes focus like any other.
   */
  async expectSetupFormFallsBackToSignIn(account: Account): Promise<void> {
    await this.fillFirstRunSetupForm(account);
    const signIn = this.page.getByRole("heading", { name: "Sign in to Paseo Hub" });
    await expect(signIn).toBeVisible();
    await expect(signIn).toBeFocused();
    await expect(this.page.getByRole("form", { name: "Sign in" })).toBeVisible();
    await expect(this.page.getByRole("button", { name: "Set up Paseo Hub" })).toHaveCount(0);
    await expect(this.page.getByRole("alert")).toHaveCount(0);
    await expectAccessible(this.page);
  }

  /** Creates the first operator and stops on whatever screen the claim lands on. */
  async claimInstance(account: Account): Promise<void> {
    this.email = account.email.toLowerCase();
    await this.page.goto(this.origin);
    await this.page.getByRole("button", { name: "Set up Paseo Hub" }).click();
    await this.fillFirstRunSetupForm(account);
  }

  private async fillFirstRunSetupForm(account: Account): Promise<void> {
    const form = this.page.getByRole("form", { name: "Create your account" });
    await form.getByLabel("Email").fill(account.email);
    await form.getByLabel("Password").fill(account.password);
    await form.getByRole("button", { name: "Create account" }).click();
  }

  async expectApiKeyLifecycle(): Promise<void> {
    await this.openOrganizationSection("API keys");
    await expect(this.page.getByRole("heading", { name: "API keys", exact: true })).toBeVisible();
    await expect(
      this.page.getByRole("link", { name: "API reference", exact: true }),
    ).toHaveAttribute("href", "https://paseo.sh/docs/hub/api");
    await expect(this.page.getByText("No API keys", { exact: true })).toBeVisible();
    await expectAccessible(this.page);

    await this.page.getByRole("button", { name: "Create API key" }).click();
    const dialog = this.page.getByRole("dialog");
    const form = dialog.getByRole("form", { name: "Create API key" });
    await form.getByLabel("Name").fill("Production deployer");
    await form.getByLabel("Install configuration").check();
    await form.getByLabel("Start runs").check();
    await form.getByRole("button", { name: "Create API key" }).click();

    await expect(dialog.getByRole("heading", { name: "Copy your API key" })).toBeVisible();
    await expectAccessible(this.page);
    const secret = dialog.getByLabel("Generated API key");
    const revealedSecret = await secret.inputValue();
    expect(revealedSecret).toMatch(/^paseo_pk_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/u);
    await expect(
      this.page.evaluate(async (key) => {
        const response = await fetch(`${window.location.origin}/api/v1/daemons/enrollment-tokens`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        return response.status;
      }, revealedSecret),
    ).resolves.toBe(403);
    await this.context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: this.origin,
    });
    await dialog.getByRole("button", { name: "Copy API key" }).click();
    await expect(dialog.getByRole("status")).toHaveText("API key copied.");
    await expect(this.page.evaluate(() => navigator.clipboard.readText())).resolves.toMatch(
      /^paseo_pk_/u,
    );
    await dialog.getByRole("button", { name: "Done" }).click();

    const row = this.page
      .getByRole("table", { name: "API keys" })
      .getByRole("row")
      .filter({ hasText: "Production deployer" });
    await expect(row).toContainText("Install configuration, Start runs");
    await expect(row).toContainText("Active");
    await row.getByRole("button", { name: "Actions for Production deployer" }).click();
    await this.page.getByRole("menuitem", { name: "Revoke" }).click();
    const confirmation = this.page.getByRole("alertdialog");
    await expect(
      confirmation.getByRole("heading", { name: "Revoke Production deployer?" }),
    ).toBeVisible();
    await confirmation.getByRole("button", { name: "Revoke key" }).click();
    await expect(row).toContainText("Revoked");
    await expect(row.getByRole("button", { name: "Actions for Production deployer" })).toHaveCount(
      0,
    );
    await expect(
      this.page.evaluate(async (key) => {
        const response = await fetch(`${window.location.origin}/api/v1/daemons/enrollment-tokens`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        return response.status;
      }, revealedSecret),
    ).resolves.toBe(401);
  }

  async createRunApiKey(): Promise<string> {
    await this.openOrganizationSection("API keys");
    await expect(this.page.getByRole("heading", { name: "API keys", exact: true })).toBeVisible();
    await this.page.getByRole("button", { name: "Create API key" }).click();
    const dialog = this.page.getByRole("dialog");
    const form = dialog.getByRole("form", { name: "Create API key" });
    await form.getByLabel("Name").fill("Phase Two runner");
    await form.getByLabel("Start runs").check();
    await form.getByRole("button", { name: "Create API key" }).click();
    await expect(dialog.getByRole("heading", { name: "Copy your API key" })).toBeVisible();
    const secret = await dialog.getByLabel("Generated API key").inputValue();
    await dialog.getByRole("button", { name: "Done" }).click();
    return secret;
  }

  async signUpForInvitation(account: Account): Promise<void> {
    this.email = account.email.toLowerCase();
    await this.submitInvitationSignUp(account);
    await expect(this.page.getByRole("button", { name: "Accept invitation" })).toBeVisible();
  }

  private async submitSignUp(account: Account): Promise<void> {
    await this.page.getByRole("button", { name: "Create an account" }).click();
    await this.fillSignUpForm(account);
  }

  private async submitInvitationSignUp(account: Account): Promise<void> {
    const form = this.page.getByRole("form", { name: "Create account" });
    await form.getByLabel("Name").fill(account.name);
    await form.getByLabel("Password").fill(account.password);
    await form.getByRole("button", { name: "Create account" }).click();
  }

  private async fillSignUpForm(account: Account): Promise<void> {
    const form = this.page.getByRole("form", { name: "Create account" });
    await form.getByLabel("Name").fill(account.name);
    await form.getByLabel("Email").fill(account.email);
    await form.getByLabel("Password").fill(account.password);
    await form.getByRole("button", { name: "Create account" }).click();
  }

  async proveAuthenticationPendingLocksMode(account: Account): Promise<void> {
    const serverFunctions = "**/_serverFn/**";
    let authRequests = 0;
    let responseCompleted = () => {};
    const completed = new Promise<void>((resolve) => {
      responseCompleted = resolve;
    });
    let releaseResponse = () => {};
    const released = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let responseDelivered = () => {};
    const delivered = new Promise<void>((resolve) => {
      responseDelivered = resolve;
    });
    await this.page.route(serverFunctions, async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !request.postData()?.includes(account.email)) {
        await route.continue();
        return;
      }
      authRequests += 1;
      const response = await route.fetch();
      responseCompleted();
      await released;
      await route.fulfill({ response });
      responseDelivered();
    });

    const form = this.page.getByRole("form", { name: "Sign in" });
    const toggle = this.page.getByRole("button", { name: "Create an account" });
    try {
      await form.getByLabel("Email").fill(account.email);
      await form.getByLabel("Password").fill(account.password);
      await form.getByRole("button", { name: "Sign in" }).click();
      await completed;

      await expect(toggle).toBeDisabled();
      await expect(form.getByLabel("Email")).toBeDisabled();
      await expect(form.getByLabel("Password")).toBeDisabled();
      await expect(form.getByRole("button", { name: "Sign in" })).toBeDisabled();
      await toggle.click({ force: true });
      await form.getByRole("button", { name: "Sign in" }).click({ force: true });
      await expect(this.page.getByRole("form", { name: "Create account" })).toHaveCount(0);
      expect(authRequests).toBe(1);
    } finally {
      releaseResponse();
      await delivered;
      await this.page.unroute(serverFunctions);
    }
  }

  async proveAuthenticationSettlementLocksMode(
    account: Account,
    organization: string,
  ): Promise<void> {
    let authRequests = 0;
    const pending = await this.holdAccountRefetchAfterSuccessfulAuth(account);
    const form = this.page.getByRole("form", { name: "Sign in" });
    const toggle = this.page.getByRole("button", { name: "Create an account" });
    try {
      await form.getByLabel("Email").fill(account.email);
      await form.getByLabel("Password").fill(account.password);
      const observeAuth = (request: Request) => {
        if (
          request.method() === "POST" &&
          request.url().includes("/_serverFn/") &&
          request.postData()?.includes(account.email)
        ) {
          authRequests += 1;
        }
      };
      this.page.on("request", observeAuth);
      try {
        await form.getByRole("button", { name: "Sign in" }).click();
        await pending.accountRefetchStarted();

        await expect(toggle).toBeDisabled();
        await expect(form.getByLabel("Email")).toBeDisabled();
        await expect(form.getByLabel("Password")).toBeDisabled();
        await expect(form.getByRole("button", { name: "Sign in" })).toBeDisabled();
        await toggle.click({ force: true });
        await form.getByRole("button", { name: "Sign in" }).click({ force: true });
        await expect(this.page.getByRole("form", { name: "Create account" })).toHaveCount(0);
        expect(authRequests).toBe(1);
      } finally {
        this.page.off("request", observeAuth);
      }
    } finally {
      await pending.release();
    }
    await expect(
      this.page
        .getByRole("heading", { name: "Choose an organization" })
        .or(this.page.locator("header").first().getByText(organization, { exact: true })),
    ).toBeVisible();
  }

  private async holdAccountRefetchAfterSuccessfulAuth(account: Account): Promise<{
    accountRefetchStarted(): Promise<void>;
    release(): Promise<void>;
  }> {
    const serverFunctions = "**/_serverFn/**";
    let authCompleted = false;
    let refetchReceived = () => {};
    const refetchStarted = new Promise<void>((resolve) => {
      refetchReceived = resolve;
    });
    let releaseRefetch = () => {};
    const released = new Promise<void>((resolve) => {
      releaseRefetch = resolve;
    });
    let refetchDelivered = () => {};
    const delivered = new Promise<void>((resolve) => {
      refetchDelivered = resolve;
    });
    let refetchIntercepted = false;
    await this.page.route(serverFunctions, async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.postData()?.includes(account.email)) {
        const response = await route.fetch();
        authCompleted = true;
        await route.fulfill({ response });
        return;
      }
      if (
        authCompleted &&
        request.method() === "GET" &&
        new URL(request.url()).searchParams.has("payload")
      ) {
        refetchIntercepted = true;
        refetchReceived();
        try {
          await released;
          await route.continue();
        } finally {
          refetchDelivered();
        }
        return;
      }
      await route.continue();
    });

    return {
      accountRefetchStarted: () => refetchStarted,
      release: async () => {
        releaseRefetch();
        if (refetchIntercepted) await delivered;
        await this.page.unroute(serverFunctions);
      },
    };
  }

  async createOrganization(name: string): Promise<void> {
    await this.submitOrganization(name);
    await this.expectActiveOrganization(name);
  }

  async rejectOrganizationGateCommand(name: string): Promise<void> {
    const serverFunctions = "**/_serverFn/**";
    let commandReceived = () => {};
    const received = new Promise<void>((resolve) => {
      commandReceived = resolve;
    });
    let releaseCommand = () => {};
    const released = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    await this.page.route(serverFunctions, async (route) => {
      if (route.request().postData()?.includes(name)) {
        commandReceived();
        await released;
        await route.abort();
        return;
      }
      await route.continue();
    });
    try {
      const submission = this.submitOrganization(name);
      await received;
      await expect(this.page.getByRole("button", { name: "Sign out" })).toBeDisabled();
      releaseCommand();
      await submission;
      await expect(
        this.page.getByRole("heading", { name: "Choose an organization" }),
      ).toBeVisible();
      await expect(this.page.getByRole("alert")).toHaveText(
        "Hub did not receive the account update. Check your connection, reload the current account state, and submit again.",
      );
    } finally {
      releaseCommand();
      await this.page.unroute(serverFunctions);
    }
  }

  async createAnotherOrganization(name: string): Promise<void> {
    const switcher = this.page.getByRole("button", { name: "Organization" });
    await switcher.click();
    await this.page.getByRole("menuitem", { name: "New organization" }).click();
    const form = this.page.getByRole("form", { name: "Create organization" });
    await expect(form).toBeVisible();
    await form.getByLabel("Organization name").fill(name);
    await form.getByRole("button", { name: "Create organization" }).click();
    await this.expectActiveOrganization(name);
  }

  async createAnotherOrganizationWithoutDisclosure(
    name: string,
    sensitiveText: string,
  ): Promise<void> {
    await this.createAnotherOrganization(name);
    await expect(this.page.getByText(sensitiveText, { exact: true })).toHaveCount(0);
    await this.expectCurrentDaemonAbsent(sensitiveText);
  }

  async replaceDaemonAccountWithoutDisclosure(
    account: Account,
    organizationName: string,
    sensitiveText: string,
  ): Promise<void> {
    await this.signOut();
    await this.signUp(account);
    await this.submitOrganization(organizationName);
    await this.expectActiveOrganization(organizationName);
    await expect(this.page.getByText(sensitiveText, { exact: true })).toHaveCount(0);
    await this.expectCurrentDaemonAbsent(sensitiveText);
  }

  async replaceApprovalAccountWithoutDisclosure(
    account: Account,
    organizationName: string,
    previousOrganizationName: string,
  ): Promise<void> {
    const verificationUrl = this.page.url();
    await this.signOut();
    await this.signUp(account);
    await this.submitOrganization(organizationName);
    await this.expectActiveOrganization(organizationName);
    await expect(this.page.getByText(previousOrganizationName, { exact: true })).toHaveCount(0);
    await this.page.goto(verificationUrl);
    const approval = this.page.getByRole("region", { name: "Approve daemon" });
    await expect(approval.getByText(organizationName, { exact: true })).toBeVisible();
    await expect(approval.getByText(previousOrganizationName, { exact: true })).toHaveCount(0);
  }

  async chooseOrganization(name: string): Promise<void> {
    const switcher = this.page.getByRole("button", { name: "Organization" });
    await switcher.click();
    const menu = this.page.getByRole("menu");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name, exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(switcher).toContainText(name);
    await expect(this.page).toHaveURL(/\/o\/[^/]+\/triggers$/u);
    await expect(this.page.getByRole("heading", { name: "Triggers", exact: true })).toBeVisible();
  }

  async returnToProjects(): Promise<void> {
    await this.page.goto(this.origin);
    await expect(this.page.getByRole("heading", { name: "Triggers", exact: true })).toBeVisible();
  }

  async rejectOrganizationSwitchAndInvitation(
    destinationOrganization: string,
    invitationEmail: string,
  ): Promise<void> {
    const serverFunctions = "**/_serverFn/**";
    const switcher = this.page.getByRole("button", { name: "Organization" });
    await this.page.route(serverFunctions, async (route) => {
      if (route.request().postData()?.includes('"organizationId"')) {
        await route.abort();
        return;
      }
      await route.continue();
    });
    try {
      await switcher.click();
      await this.page
        .getByRole("menu")
        .getByRole("menuitem", { name: destinationOrganization, exact: true })
        .click();
      await expect(this.page.getByRole("alert")).toHaveText(
        "Hub did not receive the account update. Check your connection, reload the current account state, and submit again.",
      );
      await expect(switcher).toContainText("Acme");
    } finally {
      await this.page.unroute(serverFunctions);
    }

    await this.openOrganizationSection("Team");
    await this.page.route(serverFunctions, async (route) => {
      if (route.request().postData()?.includes(invitationEmail)) {
        await route.abort();
        return;
      }
      await route.continue();
    });
    try {
      const form = await this.openInvitationForm();
      await form.getByLabel("Invitee email").fill(invitationEmail);
      await form.getByRole("button", { name: "Create invitation" }).click();
      await expect(this.page.getByRole("alert")).toHaveText(
        "Hub did not receive the account update. Check your connection, reload the current account state, and submit again.",
      );
      await expect(this.invitationRow(invitationEmail)).toHaveCount(0);
      await expect(switcher).toContainText("Acme");
    } finally {
      await this.page.unroute(serverFunctions);
    }
  }

  async proveInvitationLocksOrganizationSwitch(
    destinationOrganization: string,
    invitationEmail: string,
  ): Promise<void> {
    const serverFunctions = "**/_serverFn/**";
    let invitationReceived = () => {};
    const received = new Promise<void>((resolve) => {
      invitationReceived = resolve;
    });
    let releaseInvitation = () => {};
    const released = new Promise<void>((resolve) => {
      releaseInvitation = resolve;
    });
    let invitationDelivered = () => {};
    const delivered = new Promise<void>((resolve) => {
      invitationDelivered = resolve;
    });
    await this.page.route(serverFunctions, async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !request.postData()?.includes(invitationEmail)) {
        await route.continue();
        return;
      }
      invitationReceived();
      try {
        await released;
        await route.continue();
      } finally {
        invitationDelivered();
      }
    });

    const switcher = this.page.getByRole("button", { name: "Organization" });
    try {
      await this.openOrganizationSection("Team");
      const form = await this.openInvitationForm();
      await form.getByLabel("Invitee email").fill(invitationEmail);
      await form.getByRole("button", { name: "Create invitation" }).click();
      await received;

      await expect(this.page.getByRole("heading", { name: "Team" })).toBeVisible();
      await expect(this.page.getByRole("region", { name: "Loading account context" })).toHaveCount(
        0,
      );
      await expect(this.page.getByRole("button", { name: "Invite member" })).toBeDisabled();
      await switcher.click();
      const menu = this.page.getByRole("menu");
      await expect(menu).toBeVisible();
      await expect(
        menu.getByRole("menuitem", { name: destinationOrganization, exact: true }),
      ).toBeDisabled();
      await expect(menu.getByRole("menuitem", { name: "Acme", exact: true })).toBeDisabled();
      await this.page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    } finally {
      releaseInvitation();
      await delivered;
      await this.page.unroute(serverFunctions);
    }

    await expect(this.invitationRow(invitationEmail)).toBeVisible();
    await this.chooseOrganization(destinationOrganization);
    await expect(this.invitationRow(invitationEmail)).toHaveCount(0);
  }

  async expectOrganizationSwitchUnmountsOldPanel(
    destinationOrganization: string,
    oldDaemonName: string,
  ): Promise<void> {
    let selected = false;
    let refetchReceived = () => {};
    const refetchStarted = new Promise<void>((resolve) => {
      refetchReceived = resolve;
    });
    let releaseRefetch = () => {};
    const released = new Promise<void>((resolve) => {
      releaseRefetch = resolve;
    });
    const serverFunctions = "**/_serverFn/**";
    await this.page.route(serverFunctions, async (route) => {
      const request = route.request();
      if (
        selected &&
        request.method() === "GET" &&
        new URL(request.url()).searchParams.has("payload")
      ) {
        refetchReceived();
        await released;
        await route.continue();
        return;
      }
      await route.continue();
    });

    const switcher = this.page.getByRole("button", { name: "Organization" });
    try {
      await switcher.click();
      selected = true;
      await this.page
        .getByRole("menu")
        .getByRole("menuitem", { name: destinationOrganization, exact: true })
        .click();
      await refetchStarted;
      await expect(
        this.page.getByRole("region", { name: "Loading account context" }),
      ).toBeVisible();
      await expect(this.page.getByText(oldDaemonName, { exact: true })).toHaveCount(0);
      await expect(
        this.page.getByRole("button", { name: `Actions for ${oldDaemonName}` }),
      ).toHaveCount(0);
    } finally {
      releaseRefetch();
    }
    await expect(switcher).toContainText(destinationOrganization);
    await expect(this.page).toHaveURL(/\/o\/[^/]+\/triggers$/u);
    await expect(this.page.getByRole("heading", { name: "Triggers", exact: true })).toBeVisible();
    await expect(this.page.getByText(oldDaemonName, { exact: true })).toHaveCount(0);
    await this.page.unroute(serverFunctions);
  }

  async openCliLoginApproval(verificationUrl: string, organizationName: string): Promise<void> {
    await this.page.goto(verificationUrl);
    await expect(this.page.getByRole("heading", { name: "Approve CLI login" })).toBeVisible();
    await expect(
      this.page
        .getByRole("region", { name: "Approve CLI login" })
        .getByText(organizationName, { exact: true }),
    ).toBeVisible();
    await expect(this.page.getByText(/list projects.*enroll daemons.*manual runs/su)).toBeVisible();
  }

  async approveCliLogin(): Promise<void> {
    await this.page
      .getByRole("form", { name: "Approve CLI login" })
      .getByRole("button", { name: "Approve CLI login" })
      .click();
    await expect(this.page.getByRole("heading", { name: "CLI login approved" })).toBeVisible();
  }

  async denyCliLogin(): Promise<void> {
    await this.page
      .getByRole("form", { name: "Approve CLI login" })
      .getByRole("button", { name: "Deny" })
      .click();
    await expect(this.page.getByRole("heading", { name: "CLI login denied" })).toBeVisible();
  }

  async expectCliLoginUnavailable(verificationUrl: string): Promise<void> {
    await this.page.goto(verificationUrl);
    await expect(this.page.getByRole("alert")).toHaveText(
      /This CLI login request is unavailable or expired/u,
    );
  }

  async expectDaemon(
    displayName: string,
    daemonId: string,
    state: "Connected" | "Offline" | "Revoked",
  ): Promise<void> {
    await this.refreshOrganizationSection("Daemons");
    const daemon = this.daemonRow(displayName);
    await expect(daemon.getByText(displayName, { exact: true })).toBeVisible();
    await expect(daemon.getByText(daemonId.slice(0, 8), { exact: true })).toBeVisible();
    await expect(daemon.getByText(state, { exact: true })).toBeVisible();
    await expect(daemon.getByText(/\w{3} \d{1,2}, \d{4}/u).first()).toBeVisible();
  }

  private daemonRow(displayName: string): Locator {
    return this.page.getByRole("row").filter({ hasText: displayName });
  }

  private async openDaemonRename(displayName: string): Promise<Locator> {
    await this.daemonRow(displayName)
      .getByRole("button", { name: `Actions for ${displayName}` })
      .click();
    await this.page.getByRole("menuitem", { name: "Rename" }).click();
    const form = this.page.getByRole("form", { name: `Rename ${displayName}` });
    await expect(form).toBeVisible();
    return form;
  }

  async renameDaemon(currentName: string, displayName: string): Promise<void> {
    await this.openOrganizationSection("Daemons");
    const form = await this.openDaemonRename(currentName);
    const name = form.getByLabel("Daemon slug");
    await name.fill(displayName);
    await name.focus();
    await this.page.keyboard.press("Tab");
    await expect(form.getByRole("button", { name: "Rename" })).toBeFocused();
    let renamed = false;
    let refetchReceived = () => {};
    const refetchStarted = new Promise<void>((resolve) => {
      refetchReceived = resolve;
    });
    let releaseRefetch = () => {};
    const released = new Promise<void>((resolve) => {
      releaseRefetch = resolve;
    });
    const serverFunctions = "**/_serverFn/**";
    await this.page.route(serverFunctions, async (route) => {
      const request = route.request();
      if (request.postData()?.includes(displayName)) {
        const response = await route.fetch();
        renamed = true;
        await route.fulfill({ response });
        return;
      }
      if (renamed && request.method() === "GET") {
        refetchReceived();
        await released;
        await route.continue();
        return;
      }
      await route.continue();
    });
    try {
      await this.page.keyboard.press("Enter");
      await refetchStarted;
      await expect(form).toBeVisible();
    } finally {
      releaseRefetch();
    }
    await expect(form).toBeHidden();
    await this.page.keyboard.press("Escape");
    await expect(this.daemonRow(displayName).getByText(displayName, { exact: true })).toBeVisible();
    await this.page.unroute(serverFunctions);
  }

  async expectDaemonRenameConflict(currentName: string, reservedSlug: string): Promise<void> {
    await this.openOrganizationSection("Daemons");
    const form = await this.openDaemonRename(currentName);
    await form.getByLabel("Daemon slug").fill(reservedSlug);
    await form.getByRole("button", { name: "Rename" }).click();
    await expect(form.getByRole("alert")).toHaveText(
      `The daemon slug “${reservedSlug}” is already in use. Choose another slug.`,
    );
    await expect(form).toBeVisible();
  }

  async expectRenameDaemonLocksAccountContext(
    currentName: string,
    displayName: string,
    destinationOrganization: string,
  ): Promise<void> {
    await this.openOrganizationSection("Daemons");
    const form = await this.openDaemonRename(currentName);
    await form.getByLabel("Daemon slug").fill(displayName);
    const pending = await this.holdDaemonCommand(
      (request) => request.postData()?.includes(displayName) === true,
    );
    try {
      await form.getByRole("button", { name: "Rename" }).click();
      await pending.commandReceived();
      await expect(form).toBeVisible();
      await expect(form.getByLabel("Daemon slug")).toBeDisabled();
      await this.page.getByRole("button", { name: "Close" }).click();
      await expect(form).toBeHidden();
      await this.page.keyboard.press("Escape");
      await expect(
        this.daemonRow(currentName).getByText(currentName, { exact: true }),
      ).toBeVisible();
      await this.expectTenantControlsLocked(destinationOrganization);
    } finally {
      await pending.release();
    }
    await expect(form).toBeHidden();
    await expect(this.daemonRow(displayName).getByText(displayName, { exact: true })).toBeVisible();
    await this.chooseOrganization(destinationOrganization);
    await expect(this.page.getByText(displayName, { exact: true })).toHaveCount(0);
    await this.chooseOrganization("Acme");
  }

  async attemptStaleRename(currentName: string, displayName: string): Promise<void> {
    const form = await this.openDaemonRename(currentName);
    await form.getByLabel("Daemon slug").fill(displayName);
    await form.getByRole("button", { name: "Rename" }).click();
    await expect(this.page.getByRole("heading", { name: "Sign in to Paseo Hub" })).toBeVisible();
    await expect(this.page.getByText(currentName, { exact: true })).toHaveCount(0);
    await expect(this.page.getByText(displayName, { exact: true })).toHaveCount(0);
  }

  async revokeDaemon(displayName: string): Promise<void> {
    const trigger = this.daemonRow(displayName).getByRole("button", {
      name: `Actions for ${displayName}`,
    });
    await trigger.click();
    await this.page.getByRole("menuitem", { name: "Revoke" }).click();
    let dialog = this.page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: `Revoke ${displayName}?` })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await trigger.click();
    await this.page.getByRole("menuitem", { name: "Revoke" }).click();
    dialog = this.page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Revoke daemon" }).click();
    await expect(this.daemonRow(displayName).getByText("Revoked", { exact: true })).toBeVisible();
  }

  async expectRevokeDaemonLocksAccountContext(
    displayName: string,
    daemonId: string,
    destinationOrganization: string,
  ): Promise<void> {
    await this.openOrganizationSection("Daemons");
    const trigger = this.daemonRow(displayName).getByRole("button", {
      name: `Actions for ${displayName}`,
    });
    await trigger.click();
    await this.page.getByRole("menuitem", { name: "Revoke" }).click();
    const dialog = this.page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: `Revoke ${displayName}?` })).toBeVisible();
    const pending = await this.holdDaemonCommand(
      (request) => request.postData()?.includes(daemonId) === true,
    );
    try {
      await dialog.getByRole("button", { name: "Revoke daemon" }).click();
      await pending.commandReceived();
      await expect(
        this.daemonRow(displayName).getByText(displayName, { exact: true }),
      ).toBeVisible();
      await expect(dialog).toBeHidden();
      await this.expectTenantControlsLocked(destinationOrganization);
    } finally {
      await pending.release();
    }
    await expect(this.daemonRow(displayName).getByText("Revoked", { exact: true })).toBeVisible();
    await this.chooseOrganization(destinationOrganization);
    await expect(this.page.getByText(displayName, { exact: true })).toHaveCount(0);
    await this.chooseOrganization("Acme");
  }

  async expectDaemonAbsent(displayName: string): Promise<void> {
    await this.expectCurrentDaemonAbsent(displayName);
  }

  async expectDaemonReadOnly(displayName: string): Promise<void> {
    await this.openOrganizationSection("Daemons");
    const daemon = this.page.getByRole("row").filter({ hasText: displayName });
    await expect(daemon.getByText(displayName, { exact: true })).toBeVisible();
    await expect(daemon.getByRole("button", { name: `Actions for ${displayName}` })).toHaveCount(0);
  }

  private async expectTenantControlsLocked(destinationOrganization: string): Promise<void> {
    const switcher = this.page.getByRole("button", { name: "Organization" });
    await expect(this.page.getByRole("region", { name: "Loading account context" })).toHaveCount(0);
    await switcher.click();
    const organizationMenu = this.page.getByRole("menu");
    await expect(organizationMenu).toBeVisible();
    await expect(
      organizationMenu.getByRole("menuitem", { name: "Acme", exact: true }),
    ).toBeDisabled({ timeout: 1_000 });
    await expect(
      organizationMenu.getByRole("menuitem", { name: destinationOrganization, exact: true }),
    ).toBeDisabled({ timeout: 1_000 });
    await this.page.keyboard.press("Escape");
    await expect(organizationMenu).toBeHidden();

    await this.page.getByRole("button", { name: this.accountEmail }).click();
    const accountMenu = this.page.getByRole("menu");
    await expect(accountMenu).toBeVisible();
    await expect(accountMenu.getByRole("menuitem", { name: "Sign out" })).toBeDisabled({
      timeout: 1_000,
    });
    await this.page.keyboard.press("Escape");
    await expect(accountMenu).toBeHidden();
  }

  private async holdDaemonCommand(matches: (request: Request) => boolean): Promise<{
    commandReceived(): Promise<void>;
    release(): Promise<void>;
  }> {
    const routePattern = "**/_serverFn/**";
    let commandReceived = () => {};
    const received = new Promise<void>((resolve) => {
      commandReceived = resolve;
    });
    let releaseCommand = () => {};
    const released = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    let commandDelivered = () => {};
    const delivered = new Promise<void>((resolve) => {
      commandDelivered = resolve;
    });
    let commandIntercepted = false;
    await this.page.route(routePattern, async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !matches(request)) {
        await route.continue();
        return;
      }
      commandIntercepted = true;
      commandReceived();
      try {
        await released;
        await route.continue();
      } finally {
        commandDelivered();
      }
    });
    return {
      commandReceived: () => received,
      release: async () => {
        releaseCommand();
        if (commandIntercepted) await delivered;
        if (!this.page.isClosed()) await this.page.unroute(routePattern);
      },
    };
  }

  async navigateToDaemonsFromMobileSidebar(): Promise<void> {
    await this.page.goto(this.origin);
    const trigger = this.page.getByRole("button", { name: "Toggle Sidebar" });
    await trigger.focus();
    await this.page.keyboard.press("Enter");
    const sidebar = this.page.getByRole("dialog", { name: "Sidebar" });
    await expect(sidebar).toBeVisible();
    const daemons = sidebar.getByRole("link", { name: "Daemons", exact: true });
    await daemons.focus();
    await this.page.keyboard.press("Enter");
    await expect(this.page).toHaveURL(/\/o\/[^/]+\/daemons$/u);
    await expect(sidebar).toBeHidden();
    await expect(this.page.getByRole("heading", { name: "Daemons", exact: true })).toBeVisible();
    await expect(this.page.getByText("No daemons registered", { exact: true })).toBeVisible();
    const width = await this.page.getByRole("main").evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(width.document).toBeLessThanOrEqual(width.viewport);
  }

  async invite(email: string, role: "admin" | "member"): Promise<string> {
    await this.refreshOrganizationSection("Team");
    const form = await this.openInvitationForm();
    await form.getByLabel("Invitee email").fill(email);
    await this.chooseOption(form.getByRole("combobox", { name: "Role" }), roleLabel(role));
    await form.getByRole("button", { name: "Create invitation" }).click();
    await expect(form).toBeHidden();
    await this.context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: this.origin,
    });
    const actions = this.invitationRow(email).getByRole("button", { name: `Actions for ${email}` });
    await actions.click();
    await this.page.getByRole("menuitem", { name: "Copy link" }).click();
    await expect(this.page.getByRole("status")).toHaveText("Invitation link copied.");
    return z
      .string()
      .url()
      .parse(await this.page.evaluate(() => navigator.clipboard.readText()));
  }

  private async openInvitationForm(): Promise<Locator> {
    await this.page.getByRole("button", { name: "Invite member" }).click();
    const form = this.page.getByRole("form", { name: "Invite team member" });
    await expect(form).toBeVisible();
    return form;
  }

  private invitationRow(email: string): Locator {
    return this.page
      .getByRole("table", { name: "Pending invitations" })
      .getByRole("row")
      .filter({ hasText: email });
  }

  async copyInvitationAndExpectFeedback(email: string, invitationLink: string): Promise<void> {
    await this.context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: this.origin,
    });
    const invitation = this.invitationRow(email);
    await invitation.getByRole("button", { name: `Actions for ${email}` }).click();
    await this.page.getByRole("menuitem", { name: "Copy link" }).click();
    await expect(this.page.getByRole("status")).toHaveText("Invitation link copied.");
    expect(await this.page.evaluate(() => navigator.clipboard.readText())).toBe(invitationLink);
    await expectAccessible(this.page);
  }

  async openInvitation(link: string): Promise<void> {
    await this.page.goto(link);
  }

  async acceptInvitation(): Promise<void> {
    await this.page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(this.page.getByRole("heading", { name: "Triggers" })).toBeVisible();
  }

  async acceptInvitationWithSignOutLocked(): Promise<void> {
    const serverFunctions = "**/_serverFn/**";
    let acceptanceReceived = () => {};
    const received = new Promise<void>((resolve) => {
      acceptanceReceived = resolve;
    });
    let releaseAcceptance = () => {};
    const released = new Promise<void>((resolve) => {
      releaseAcceptance = resolve;
    });
    let acceptanceDelivered = () => {};
    const delivered = new Promise<void>((resolve) => {
      acceptanceDelivered = resolve;
    });
    await this.page.route(serverFunctions, async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !request.postData()?.includes('"invitationId"')) {
        await route.continue();
        return;
      }
      acceptanceReceived();
      try {
        await released;
        await route.continue();
      } finally {
        acceptanceDelivered();
      }
    });

    const accept = this.page.getByRole("button", { name: "Accept invitation" });
    const signOut = this.page.getByRole("button", { name: "Sign out" });
    try {
      await accept.click();
      await received;
      await expect(accept).toBeDisabled();
      await expect(signOut).toBeDisabled();
    } finally {
      releaseAcceptance();
      await delivered;
      await this.page.unroute(serverFunctions);
    }
    await expect(this.page.getByRole("heading", { name: "Triggers" })).toBeVisible();
  }

  async acceptInvitationAfterSessionExpiry(
    account: Account,
    invitation: string,
    organization: string,
  ): Promise<void> {
    const invitationUrl = new URL(invitation);
    await this.page.getByRole("button", { name: "Accept invitation" }).click();
    const signIn = this.page.getByRole("form", { name: "Sign in" });
    await expect(signIn).toBeVisible();
    await expect(this.page).toHaveURL(invitationUrl.toString());
    await expect(signIn.getByLabel("Email")).toHaveValue(account.email);
    await signIn.getByLabel("Password").fill(account.password);
    await signIn.getByRole("button", { name: "Sign in" }).click();
    await expect(this.page).toHaveURL(invitationUrl.toString());
    await expect(this.page.getByRole("button", { name: "Accept invitation" })).toBeVisible();
    await this.acceptInvitation();
    await this.expectActiveOrganization(organization);
  }

  async expectActiveOrganization(name: string): Promise<void> {
    const drawer = this.page.getByRole("dialog", { name: "Sidebar" });
    const mobile = (this.page.viewportSize()?.width ?? 1280) < 768;
    if (!mobile) {
      await expect(
        this.page.getByRole("button", { name: "Organization", exact: true }),
      ).toContainText(name);
      return;
    }
    const drawerWasOpen = await drawer.isVisible().catch(() => false);
    if (!drawerWasOpen) {
      const toggle = this.page.getByRole("main").getByRole("button", { name: "Toggle Sidebar" });
      await expect(toggle).toBeVisible();
      await toggle.click();
    }
    await expect(drawer.getByRole("button", { name: "Organization", exact: true })).toContainText(
      name,
    );
    if (!drawerWasOpen) {
      await this.page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
    }
  }

  async expectDesktopSidebarAndOrganizationMenu(): Promise<void> {
    await this.page.goto(this.origin);
    const identity = this.page.getByText(this.accountEmail, { exact: true });
    await expect(identity).toBeVisible();
    const organization = this.page.getByRole("button", { name: "Organization" });
    const account = this.page.getByRole("button", { name: this.accountEmail });

    await this.page.keyboard.press("Tab");
    await expect(organization).toBeFocused();
    await this.tabThroughOrganizationDestinations();
    await this.page.keyboard.press("Tab");
    await expect(account).toBeFocused();

    await expect(organization).toContainText("Owner");
    await organization.focus();
    await this.page.keyboard.press("Enter");
    const menu = this.page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "New organization" })).toBeVisible();
    await this.page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(organization).toBeFocused();

    await this.page.keyboard.press("Control+b");
    await expect(identity).toBeHidden();
    await expectAccessible(this.page);
    await this.page.keyboard.press("Control+b");
    await expect(identity).toBeVisible();
  }

  async createAdminInvitationWithKeyboard(email: string): Promise<void> {
    await this.openOrganizationSection("Team");
    await this.page.reload();
    const organization = this.page.getByRole("button", { name: "Organization" });
    const account = this.page.getByRole("button", { name: this.accountEmail });
    const invite = this.page.getByRole("button", { name: "Invite member" });
    await expect(invite).toBeVisible();

    await this.page.keyboard.press("Tab");
    await expect(organization).toBeFocused();
    await this.tabThroughOrganizationDestinations();
    await this.page.keyboard.press("Tab");
    await expect(account).toBeFocused();

    await invite.focus();
    await this.page.keyboard.press("Enter");
    const form = this.page.getByRole("form", { name: "Invite team member" });
    const inviteeEmail = form.getByLabel("Invitee email");
    const role = form.getByRole("combobox", { name: "Role" });
    await expect(form).toBeVisible();
    await expect(inviteeEmail).toBeFocused();
    await this.page.keyboard.type(email);
    await this.page.keyboard.press("Tab");
    await expect(role).toBeFocused();
    await this.page.keyboard.press("Enter");
    const listbox = this.page.getByRole("listbox");
    const member = listbox.getByRole("option", { name: "Member", exact: true });
    const admin = listbox.getByRole("option", { name: "Admin", exact: true });
    await expect(listbox).toBeVisible();
    await expect(member).toBeFocused();
    await this.page.keyboard.press("ArrowUp");
    await expect(admin).toBeFocused();
    await this.page.keyboard.press("Enter");
    await expect(listbox).toBeHidden();
    await expect(role).toBeFocused();
    await expect(role).toHaveText("Admin");
    await this.page.keyboard.press("Tab");
    const createInvitation = form.getByRole("button", { name: "Create invitation" });
    await expect(createInvitation).toBeFocused();
    await this.page.keyboard.press("Enter");
    await expect(form).toBeHidden();
    await expect(this.invitationRow(email).getByText("Admin", { exact: true })).toBeVisible();
  }

  async navigateToTeamFromMobileSidebar(): Promise<void> {
    await this.page.goto(this.origin);
    await expect(this.page.getByRole("heading", { name: "Triggers" })).toBeVisible();
    const trigger = this.page.getByRole("button", { name: "Toggle Sidebar" });
    await this.page.keyboard.press("Tab");
    await expect(trigger).toBeFocused();
    await this.page.keyboard.press("Enter");
    const sidebar = this.page.getByRole("dialog", { name: "Sidebar" });
    await expect(sidebar).toBeVisible();
    const organization = sidebar.getByRole("button", { name: "Organization" });
    const settings = sidebar.getByRole("link", { name: "Settings", exact: true });
    await expect(organization).toBeFocused();
    await expectAccessible(this.page);
    await this.page.keyboard.press("Escape");
    await expect(sidebar).toBeHidden();
    await expect(trigger).toBeFocused();
    await this.page.keyboard.press("Enter");
    await expect(sidebar).toBeVisible();
    await expect(organization).toBeFocused();
    // Forward through the destinations in their rendered order rather than relying on the
    // focus trap wrapping backwards: the drawer now ends on the account menu, not on Settings.
    for (const destination of ORGANIZATION_DESTINATIONS) {
      await this.page.keyboard.press("Tab");
      await expect(sidebar.getByRole("link", { name: destination, exact: true })).toBeFocused();
    }
    await expect(settings).toBeFocused();
    await this.page.keyboard.press("Enter");
    // Settings lands on Team, the one section every role can read.
    await expect(this.page).toHaveURL(/\/o\/[^/]+\/settings\/team$/u);
    await expect(sidebar).toBeHidden();
    await expect(this.page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
  }

  /** Tabs from the organization switcher through the sidebar's destinations, asserting order. */
  private async tabThroughOrganizationDestinations(): Promise<void> {
    for (const destination of ORGANIZATION_DESTINATIONS) {
      await this.page.keyboard.press("Tab");
      await expect(this.page.getByRole("link", { name: destination, exact: true })).toBeFocused();
    }
  }

  async navigateToConnectionsFromMobileSidebar(): Promise<void> {
    await this.page.goto(this.origin);
    const trigger = this.page.getByRole("button", { name: "Toggle Sidebar" });
    await trigger.click();
    const sidebar = this.page.getByRole("dialog", { name: "Sidebar" });
    await sidebar.getByRole("link", { name: "Connections", exact: true }).click();
    await expect(this.page).toHaveURL(/\/o\/[^/]+\/connections$/u);
    await expect(sidebar).toBeHidden();
    await this.expectConnectionContents();
  }

  async expectConnections(): Promise<void> {
    await this.expectConnectionShell();
    await expect(this.page.getByRole("button", { name: "Connect GitHub" })).toBeVisible();
    await expect(this.page.getByRole("button", { name: "Connect Discord" })).toBeVisible();
  }

  async expectMemberConnections(): Promise<void> {
    await this.expectConnectionShell();
    await expect(this.page.getByRole("button", { name: /Connect|Revoke/u })).toHaveCount(0);
  }

  async expectUsageUnlimitedDefaults(): Promise<void> {
    await this.openOrganizationSection("Usage");
    await expect(
      this.page.getByRole("heading", { name: "Usage", exact: true, level: 1 }),
    ).toBeVisible();
    const table = this.page.getByRole("table", { name: "Limits" });
    await expect(this.limitRow(table, "Seats")).toContainText("Unlimited");
    await expect(this.limitRow(table, "Members can invite")).toContainText("Allowed");
    await expectAccessible(this.page);
  }

  /** The Usage page is read-only for customers: no override affordance anywhere on it. */
  async expectUsageReadOnly(): Promise<void> {
    await this.openOrganizationSection("Usage");
    await expect(this.page.getByRole("button", { name: /Override/u })).toHaveCount(0);
    await expectAccessible(this.page);
  }

  /**
   * A non-operator is offered the instance nowhere. It is not in the sidebar body in any scope,
   * and the account menu it now enters through does not list it either.
   */
  async expectNoOperatorNav(): Promise<void> {
    await this.openOrganizationSection("Triggers");
    await expect(this.page.getByRole("navigation", { name: "Instance" })).toHaveCount(0);
    await expect(this.page.getByRole("link", { name: "Operator", exact: true })).toHaveCount(0);
    const menu = await this.navigation.openAccountMenu(this.accountEmail);
    await expect(menu.getByRole("menuitem", { name: "Instance administration" })).toHaveCount(0);
    await this.page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  }

  /** A non-operator reaching the operator route is refused server-side, not merely un-navigated to. */
  async expectOperatorRouteRefused(): Promise<void> {
    await this.page.goto(`${this.origin}/operator`);
    await expect(this.page.getByText("You don't have operator access.")).toBeVisible();
  }

  async openOperatorConsole(): Promise<void> {
    await this.navigation.openInstanceSection(this.accountEmail, "Operator");
    await expect(
      this.page.getByRole("heading", { name: "Operator", exact: true, level: 1 }),
    ).toBeVisible();
    // The heading renders immediately, before the organization list has loaded — wait for the
    // real picker (a combobox) rather than its loading skeleton, so this fails if the list never
    // arrives instead of racing ahead of it.
    await expect(this.page.getByRole("combobox", { name: "Manage organization" })).toBeVisible();
  }

  private limitRow(table: Locator, resource: string): Locator {
    return table
      .getByRole("row")
      .filter({ has: this.page.getByRole("cell", { name: resource, exact: true }) });
  }

  private entitlementRow(table: Locator, entitlement: string): Locator {
    return table
      .getByRole("row")
      .filter({ has: this.page.getByRole("cell", { name: entitlement, exact: true }) });
  }

  /** Navigate to the operator console and select one organization, leaving its entitlements table
   * loaded. Every operator override and audit read starts here. */
  private async openOperatorFor(org: string): Promise<void> {
    await this.openOperatorConsole();
    await this.chooseOption(this.page.getByRole("combobox", { name: "Manage organization" }), org);
    await expect(this.page.getByRole("table", { name: "Entitlements" })).toBeVisible();
  }

  async openSeatOverrideEditor(input: { org: string; max: number; reason: string }): Promise<void> {
    await this.openOperatorFor(input.org);
    const table = this.page.getByRole("table", { name: "Entitlements" });
    await this.entitlementRow(table, "Seats")
      .getByRole("button", { name: "Override seat limit" })
      .click();
    const dialog = this.page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Seat limit").fill(String(input.max));
    await dialog.getByLabel("Reason").fill(input.reason);
  }

  async saveSeatOverride(expectedSeats: number): Promise<void> {
    const dialog = this.page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Save override" }).click();
    await expect(dialog).toBeHidden();
    const table = this.page.getByRole("table", { name: "Entitlements" });
    await expect(this.entitlementRow(table, "Seats")).toContainText(String(expectedSeats));
    await expectAccessible(this.page);
  }

  async openMeterOverrideEditor(input: {
    org: string;
    limit: number;
    reason: string;
  }): Promise<void> {
    await this.openOperatorFor(input.org);
    const table = this.page.getByRole("table", { name: "Entitlements" });
    await this.entitlementRow(table, "Executions this month")
      .getByRole("button", { name: "Override executions this month" })
      .click();
    const dialog = this.page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Executions this month").fill(String(input.limit));
    await dialog.getByLabel("Reason").fill(input.reason);
  }

  async saveMeterOverride(expectedLimit: number): Promise<void> {
    const dialog = this.page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Save override" }).click();
    await expect(dialog).toBeHidden();
    const table = this.page.getByRole("table", { name: "Entitlements" });
    await expect(this.entitlementRow(table, "Executions this month")).toContainText(
      String(expectedLimit),
    );
    await expectAccessible(this.page);
  }

  async expectMeterUsage(expected: { used: number; limit: number }): Promise<void> {
    await this.openOrganizationSection("Usage");
    const table = this.page.getByRole("table", { name: "Limits" });
    await expect(this.limitRow(table, "Executions this month")).toContainText(
      `${expected.used}/${expected.limit}`,
    );
  }

  async expectInviteRefusedBySeatLimit(
    email: string,
    expected: { limit: number; current: number },
  ): Promise<void> {
    await this.refreshOrganizationSection("Team");
    const form = await this.openInvitationForm();
    await form.getByLabel("Invitee email").fill(email);
    await form.getByRole("button", { name: "Create invitation" }).click();
    await expect(form).toBeHidden();
    const alert = this.page.getByRole("alert");
    await expect(alert).toContainText("Seat limit reached");
    await expect(alert).toContainText(`${expected.current} of ${expected.limit} seats`);
    await expect(alert).toContainText("Usage page");
    await expect(this.invitationRow(email)).toHaveCount(0);
  }

  async expectEntitlementsAudit(expected: {
    org: string;
    actor: string;
    reason: string;
  }): Promise<void> {
    await this.openOperatorFor(expected.org);
    const auditRow = this.page
      .getByRole("table", { name: "Audit trail" })
      .getByRole("row")
      .filter({ hasText: expected.reason });
    await expect(auditRow).toContainText("Override");
    await expect(auditRow).toContainText(expected.actor);
    await expect(auditRow).toContainText(expected.reason);
    await expectAccessible(this.page);
  }

  async expectNoBillingNavigation(): Promise<void> {
    await this.openOrganizationSection("Triggers");
    await expect(this.page.getByRole("link", { name: "Billing", exact: true })).toHaveCount(0);
    await expect(this.page.getByRole("button", { name: "Billing", exact: true })).toHaveCount(0);
    await expectAccessible(this.page);
  }

  async expectBillingPageUnavailable(): Promise<void> {
    const organizationSlug = new URL(this.page.url()).pathname.split("/")[2];
    if (organizationSlug === undefined) throw new Error("organization slug is unavailable");
    const response = await this.page.goto(`${this.origin}/o/${organizationSlug}/settings/billing`);
    expect(response?.status()).toBe(404);
  }

  async openPlanDialog(): Promise<void> {
    await this.openOrganizationSection("Billing");
    await this.page.getByRole("button", { name: /^(Subscribe|Change plan)$/u }).click();
    await expect(this.page.getByRole("dialog")).toBeVisible();
  }

  async choosePlan(plan: string): Promise<void> {
    // Each plan's button carries the plan in its accessible name even when the visible label is
    // the short "Start free trial", so a plan is always addressable by name.
    await this.page
      .getByRole("dialog")
      .getByRole("button", {
        name: new RegExp(`^(Start free trial with|Subscribe to) ${plan}$`, "u"),
      })
      .click();
    await expect(
      this.page.getByRole("heading", { name: "Billing", exact: true, level: 1 }),
    ).toBeVisible();
  }

  async subscribeToPlan(plan: string): Promise<void> {
    await this.openPlanDialog();
    await this.choosePlan(plan);
  }

  async expectCurrentPlan(plan: string): Promise<void> {
    await this.openOrganizationSection("Billing");
    await this.page.reload();
    await expect(
      this.page.getByRole("heading", { name: "Billing", exact: true, level: 1 }),
    ).toBeVisible();
    await expect(this.planSection().getByText(plan, { exact: true })).toBeVisible();
    await expectAccessible(this.page);
  }

  /**
   * The billing page for an organization with nothing to bill: the fact, and the one thing to do
   * about it. Nothing dresses the zero-execution enforcement floor up as a tier the customer is
   * on, and nothing argues for the plan — that is what the picker is for.
   */
  async expectNoSubscription(): Promise<void> {
    await this.openOrganizationSection("Billing");
    await this.page.reload();
    const plan = this.planSection();
    await expect(plan.getByText("No subscription", { exact: true })).toBeVisible();
    await expect(plan.getByRole("button", { name: "Subscribe", exact: true })).toBeVisible();
    await expect(plan).not.toContainText("0 executions");
    await expect(plan.getByText("Free", { exact: true })).toHaveCount(0);
    await expect(plan.getByRole("button", { name: "Manage billing" })).toHaveCount(0);
    await expect(plan.getByRole("button", { name: "Choose a plan" })).toHaveCount(0);
    await expect(plan).not.toContainText("run workflows");
    await expectAccessible(this.page);
  }

  /** The picker offering the cardless trial, exactly: a badge, the offer, and the action. */
  async expectCardlessTrialOffer(): Promise<void> {
    await this.openPlanDialog();
    const dialog = this.page.getByRole("dialog");
    await expect(dialog).toContainText("14 days free · No card required");
    await expect(
      dialog.getByRole("button", { name: `Start free trial with ${HOSTED_PLAN_NAME}` }),
    ).toHaveText("Start free trial");
    await this.expectPickerShowsOnlyTheOffer(dialog);
    // Nothing frames or hedges the offer: no heading, no sales sentence, no post-trial footnote.
    await expect(dialog).not.toContainText("14 days free, then");
    await expect(dialog).not.toContainText("Nothing is charged");
    await expectAccessible(this.page);
  }

  /**
   * The picker only ever shows what Hub sells, and only what it takes to accept it. The internal
   * free entitlement record is in the same Stripe catalog, so its absence here is the visible half
   * of the public-catalog boundary. The interval switch is absent because the catalog prices one
   * interval, and there is no visible heading — the dialog's accessible name is enough.
   */
  private async expectPickerShowsOnlyTheOffer(dialog: Locator): Promise<void> {
    await expect(dialog.getByRole("heading", { level: 3 })).toHaveText([HOSTED_PLAN_NAME]);
    await expect(dialog).toContainText("€15");
    await expect(dialog).toContainText("per user / month");
    await expect(dialog).not.toContainText("0 executions");
    await expect(dialog).not.toContainText("Choose your plan");
    await expect(dialog).not.toContainText("Recommended");
    await expect(dialog.getByRole("group", { name: "Billing interval" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /^(Monthly|Annual)$/u })).toHaveCount(0);
    // A dialog still has to announce itself, so its title exists for assistive technology and
    // takes no space on screen.
    const title = dialog.getByRole("heading", { level: 2 });
    await expect(title).toHaveCount(1);
    expect((await title.boundingBox())?.height ?? 0).toBeLessThanOrEqual(1);
  }

  /** Scoped to the Plan section: a plan name could otherwise collide with a settings tab. */
  private planSection(): Locator {
    return this.page
      .locator("section")
      .filter({ has: this.page.getByRole("heading", { name: "Plan", exact: true }) });
  }

  async expectActiveTrial(): Promise<void> {
    await this.openOrganizationSection("Billing");
    await this.page.reload();
    const plan = this.planSection();
    await expect(plan.getByText(HOSTED_PLAN_NAME, { exact: true })).toBeVisible();
    await expect(plan.getByText("Trialing", { exact: true })).toBeVisible();
    await expect(plan.getByText(/^Trial ends /u)).toBeVisible();
    await expect(plan.getByRole("button", { name: "Manage billing" })).toBeVisible();
    // The card states what the trial entitles the organization to, unlabelled — the plan name
    // above it is the label.
    await expect(plan.getByRole("listitem")).toHaveText([
      "Unlimited daemons",
      "GitHub, Linear, Slack, and Discord triggers",
      "Versioned workflows and activity",
      "Bring your own agents and inference",
    ]);
    // One public offer means nothing to change to, so the picker has no entry point here.
    await expect(plan.getByRole("button", { name: "Change plan" })).toHaveCount(0);
    await expect(plan).not.toContainText("Stripe billing portal");
    await expectAccessible(this.page);
  }

  /**
   * A former subscriber is never promised a second free trial: the picker drops the cardless
   * offer and falls back to ordinary paid Checkout. Escape closes it, so the paywall is
   * dismissible from the keyboard alone.
   */
  async expectNoSecondTrialOffer(): Promise<void> {
    await this.openPlanDialog();
    const dialog = this.page.getByRole("dialog");
    await expect(dialog).not.toContainText("No card required");
    await expect(dialog.getByRole("button", { name: /^Start free trial/u })).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: `Subscribe to ${HOSTED_PLAN_NAME}` }),
    ).toHaveText("Subscribe");
    await this.expectPickerShowsOnlyTheOffer(dialog);
    await expectAccessible(this.page);
    await this.page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }

  /**
   * The picker at phone width: it never pushes the page sideways, and the plan's call to action
   * is reachable by scrolling the dialog rather than stranded below the fold.
   */
  async expectPlanPickerFitsPhone(): Promise<void> {
    await this.openPlanDialog();
    const viewport = this.page.viewportSize();
    expect(viewport).not.toBeNull();
    expect(
      await this.page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport!.width);
    const trial = this.page
      .getByRole("dialog")
      .getByRole("button", { name: `Start free trial with ${HOSTED_PLAN_NAME}` });
    await trial.scrollIntoViewIfNeeded();
    await expect(trial).toBeInViewport();
    await expectAccessible(this.page);
  }

  async expectInviteBlockedByPlan(email: string): Promise<void> {
    await this.refreshOrganizationSection("Team");
    const form = await this.openInvitationForm();
    await form.getByLabel("Invitee email").fill(email);
    await form.getByRole("button", { name: "Create invitation" }).click();
    await expect(form).toBeHidden();
    const alert = this.page.getByRole("alert");
    await expect(alert).toContainText("Inviting members isn't enabled");
    await expect(this.invitationRow(email)).toHaveCount(0);
    await expectAccessible(this.page);
  }

  async expectPendingInvitation(email: string): Promise<void> {
    await this.openOrganizationSection("Team");
    await expect(this.invitationRow(email)).toBeVisible();
  }

  /** Every seat is still present after a downgrade — grandfathering never deletes to fit. */
  async expectPendingInvitationsRetained(emails: readonly string[]): Promise<void> {
    await this.openOrganizationSection("Team");
    await this.page.reload();
    for (const email of emails) {
      await expect(this.invitationRow(email)).toBeVisible();
    }
  }

  /**
   * The over-limit banner a downgrade leaves behind. It lives on the customer Usage page (not
   * Billing), so it renders self-hosted too. Reload so the page re-reads the plan the webhook just
   * stamped — a server-side stamp does not invalidate the client query.
   */
  async expectOverLimitBanner(expected: { used: number; limit: number }): Promise<void> {
    await this.openOrganizationSection("Usage");
    await this.page.reload();
    const banner = this.page.getByRole("alert", { name: "Over limit" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(`You have ${expected.used} seats in use`);
    await expect(banner).toContainText(`your limit is ${expected.limit}`);
    await expectAccessible(this.page);
  }

  async expectNoOverLimitBanner(): Promise<void> {
    await this.openOrganizationSection("Usage");
    await this.page.reload();
    await expect(this.page.getByRole("alert", { name: "Over limit" })).toHaveCount(0);
  }

  /** Assert the granted / override / effective cells of one entitlement row after a re-stamp — on
   * the operator page, the only surface that shows the granted/override breakdown. */
  async expectEntitlementCells(
    org: string,
    name: string,
    expected: { granted: string; override: string; effective: string },
  ): Promise<void> {
    await this.openOperatorFor(org);
    const cells = this.entitlementRow(
      this.page.getByRole("table", { name: "Entitlements" }),
      name,
    ).getByRole("cell");
    await expect(cells.nth(1)).toHaveText(expected.granted);
    await expect(cells.nth(2)).toHaveText(expected.override);
    await expect(cells.nth(3)).toHaveText(expected.effective);
    await expectAccessible(this.page);
  }

  /** Reset the seat override back to the plan default from the operator override dialog. */
  async clearSeatOverride(input: {
    org: string;
    reason: string;
    expectedEffective: string;
  }): Promise<void> {
    await this.openOperatorFor(input.org);
    const table = this.page.getByRole("table", { name: "Entitlements" });
    await this.entitlementRow(table, "Seats")
      .getByRole("button", { name: "Override seat limit" })
      .click();
    const dialog = this.page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Reason").fill(input.reason);
    await dialog.getByRole("button", { name: "Reset to plan default" }).click();
    await expect(dialog).toBeHidden();
    const cells = this.entitlementRow(table, "Seats").getByRole("cell");
    await expect(cells.nth(2)).toHaveText("—");
    await expect(cells.nth(3)).toHaveText(input.expectedEffective);
    await expectAccessible(this.page);
  }

  private async expectConnectionShell(): Promise<void> {
    await this.openOrganizationSection("Connections");
    await this.expectConnectionContents();
  }

  private async expectConnectionContents(): Promise<void> {
    await expect(
      this.page.getByRole("heading", { name: "Connections", exact: true, level: 1 }),
    ).toBeVisible();
    await expect(this.page.getByText("No connections", { exact: true })).toBeVisible();
    await expect(this.page.getByText(/does not deploy a/u)).toHaveCount(0);
    const widths = await this.page.getByRole("main").evaluate((main) => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      main: main.scrollWidth,
      visible: main.clientWidth,
    }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport);
    expect(widths.main).toBeLessThanOrEqual(widths.visible);
    await expectAccessible(this.page);
  }

  async connectGitHub(): Promise<void> {
    await this.openOrganizationSection("Connections");
    const connectionsUrl = this.page.url();
    await this.page.getByRole("button", { name: "Connect GitHub" }).click();
    await expect(this.page).toHaveURL(connectionsUrl);
    await expect(this.page.getByRole("status")).toHaveText("GitHub connected.");
  }

  async connectDiscord(): Promise<void> {
    const connectionsUrl = this.page.url();
    await this.page.getByRole("button", { name: "Connect Discord" }).click();
    await expect(this.page).toHaveURL(connectionsUrl);
    await expect(this.page.getByRole("status")).toHaveText("Discord connected.");
  }

  async beginProviderConnection(provider: "github" | "discord"): Promise<string> {
    await this.openOrganizationSection("Connections");
    const connectionsUrl = this.page.url();
    const callback = `**/api/integrations/${provider}/**`;
    const name = provider === "github" ? "GitHub" : "Discord";
    let destination: string | undefined;
    await this.page.route(callback, (route) => {
      destination = route.request().url();
      void route.abort();
    });
    await this.page.getByRole("button", { name: `Connect ${name}` }).click();
    await expect.poll(() => destination).toBeDefined();
    await this.page.unroute(callback);
    await this.page.goto(connectionsUrl);
    await expect(this.page.getByRole("heading", { name: "Connections", level: 1 })).toBeVisible();
    return z.string().url().parse(destination);
  }

  async expectProviderStartLocksAccountContext(
    provider: "github" | "discord",
    destinationOrganization: string,
  ): Promise<void> {
    const pending = await this.holdProviderStartBeforeServer(provider);
    const name = provider === "github" ? "GitHub" : "Discord";
    const switcher = this.page.getByRole("button", { name: "Organization" });
    try {
      await this.openOrganizationSection("Connections");
      await this.page.getByRole("button", { name: `Connect ${name}` }).click();
      await pending.startReceived();

      await expect(this.page.getByRole("button", { name: `Connect ${name}` })).toBeDisabled();
      await switcher.click();
      const organizationMenu = this.page.getByRole("menu");
      await expect(organizationMenu).toBeVisible();
      await expect(
        organizationMenu.getByRole("menuitem", { name: "Redirect Acme", exact: true }),
      ).toBeDisabled();
      await expect(
        organizationMenu.getByRole("menuitem", { name: destinationOrganization, exact: true }),
      ).toBeDisabled();
      await this.page.keyboard.press("Escape");
      await expect(organizationMenu).toBeHidden();

      await this.page.getByRole("button", { name: this.accountEmail }).click();
      const accountMenu = this.page.getByRole("menu");
      await expect(accountMenu).toBeVisible();
      await expect(accountMenu.getByRole("menuitem", { name: "Sign out" })).toBeDisabled();
      await this.page.keyboard.press("Escape");
      await expect(accountMenu).toBeHidden();
    } finally {
      await pending.release();
    }
    await expect(this.page).toHaveURL(/\/o\/[^/]+\/connections$/u);
    await expect(this.page.getByRole("status")).toHaveText(`${name} connected.`);
    await this.chooseOrganization(destinationOrganization);
    await expect(this.page.getByText(`${name} connected.`)).toHaveCount(0);
  }

  private async holdProviderStartBeforeServer(provider: "github" | "discord"): Promise<{
    startReceived(): Promise<void>;
    release(): Promise<void>;
  }> {
    await this.openOrganizationSection("Connections");
    let startReceived = () => {};
    const received = new Promise<void>((resolve) => {
      startReceived = resolve;
    });
    let releaseStart = () => {};
    const released = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    let startDelivered = () => {};
    const delivered = new Promise<void>((resolve) => {
      startDelivered = resolve;
    });
    let startIntercepted = false;
    const routePattern = "**/*";
    await this.page.route(routePattern, async (route) => {
      const request = route.request();
      if (
        request.method() !== "POST" ||
        !request.postData()?.includes('"provider"') ||
        !request.postData()?.includes(`"${provider}"`)
      ) {
        await route.continue();
        return;
      }
      startIntercepted = true;
      startReceived();
      try {
        await released;
        await route.continue();
      } finally {
        startDelivered();
      }
    });
    return {
      startReceived: () => received,
      release: async () => {
        releaseStart();
        if (startIntercepted) await delivered;
        await this.page.unroute(routePattern);
      },
    };
  }

  async expectForgedConnectionStateRejected(): Promise<void> {
    const forged = new URL("/api/integrations/github/setup", this.origin);
    forged.searchParams.set("state", "forged-state");
    forged.searchParams.set("setup_action", "install");
    forged.searchParams.set("installation_id", "42");
    await this.expectUntrustedConnectionReturnUnavailable(forged.toString());
  }

  async expectGitHubConnectionConflict(): Promise<void> {
    await this.openOrganizationSection("Connections");
    const connectionsUrl = this.page.url();
    await this.page.getByRole("button", { name: "Connect GitHub" }).click();
    await expect(this.page).toHaveURL(connectionsUrl);
    await expect(this.page.getByRole("status")).toHaveText(
      "That provider account is already connected to another organization. Disconnect it there before trying again.",
    );
    await expect(this.page.getByText("No connections", { exact: true })).toBeVisible();
    await this.expectNoProviderIdentity("acme-inc");
  }

  async expectDiscordConnectionConflict(): Promise<void> {
    const connectionsUrl = this.page.url();
    await this.page.getByRole("button", { name: "Connect Discord" }).click();
    await expect(this.page).toHaveURL(connectionsUrl);
    await expect(this.page.getByRole("status")).toHaveText(
      "That provider account is already connected to another organization. Disconnect it there before trying again.",
    );
    await expect(this.page.getByText("No connections", { exact: true })).toBeVisible();
    await this.expectNoProviderIdentity("Acme Guild");
  }

  async expectConnectionReturnConnected(url: string, status: string): Promise<void> {
    const connectionsUrl = this.page.url();
    await this.page.goto(url);
    await expect(this.page).toHaveURL(connectionsUrl);
    await expect(this.page.getByRole("status")).toHaveText(status);
  }

  async expectConnectionReturnConnectedForOrganization(
    url: string,
    status: string,
    organization: string,
  ): Promise<void> {
    await this.page.goto(url);
    await expect(this.page).toHaveURL(/\/o\/[^/]+\/connections$/u);
    await expect(this.page.getByRole("button", { name: "Organization" })).toContainText(
      organization,
    );
    await expect(this.page.getByRole("status")).toHaveText(status);
  }

  async expectConnectionReturnUnavailable(url: string): Promise<void> {
    await this.expectUntrustedConnectionReturnUnavailable(url);
  }

  async expectUntrustedConnectionReturnUnavailable(url: string): Promise<void> {
    await this.page.goto(url);
    await expect(this.page).toHaveURL(/\/o\/[^/]+\/triggers$/u);
    await expect(this.page.getByRole("heading", { name: "Triggers", exact: true })).toBeVisible();
    await expect(this.page.getByRole("status")).toHaveText(
      "This connection link is invalid, expired, or already used. Restart the connection from this Hub.",
    );
  }

  async expectNoProviderIdentity(value: string): Promise<void> {
    await this.openOrganizationSection("Connections");
    await expect(this.page.getByText(value)).toHaveCount(0);
  }

  async expectConnectedProviders(expected: {
    github: string;
    installationId: string;
    discord: string;
    guildId: string;
  }): Promise<void> {
    await this.expectProviderDetails(expected);
    await expect(this.page.getByRole("button", { name: /^Actions for /u })).toHaveCount(2);
  }

  async expectMemberConnectedProviders(expected: {
    github: string;
    installationId: string;
    discord: string;
    guildId: string;
  }): Promise<void> {
    await this.expectProviderDetails(expected);
    await expect(this.page.getByRole("button", { name: /^Actions for /u })).toHaveCount(0);
  }

  private async expectProviderDetails(expected: {
    github: string;
    installationId: string;
    discord: string;
    guildId: string;
  }): Promise<void> {
    await this.openOrganizationSection("Connections");
    const connectionsUrl = this.page.url();
    const github = this.connectionRow("GitHub");
    const discord = this.connectionRow("Discord");
    await expect(github.getByRole("cell").first()).toContainText(expected.github);
    await expect(github.getByRole("cell").first()).toContainText(
      `installation ${expected.installationId}`,
    );
    await expect(discord.getByRole("cell").first()).toContainText(expected.discord);
    await expect(discord.getByRole("cell").first()).toContainText(`guild ${expected.guildId}`);
    await expect(this.page).toHaveURL(connectionsUrl);
    await expect(this.page.getByText(/ephemeral|state|code=/u)).toHaveCount(0);
    await expectAccessible(this.page);
  }

  async disconnectProviders(): Promise<void> {
    for (const provider of ["GitHub", "Discord"]) {
      const row = this.connectionRow(provider);
      await row.getByRole("button", { name: /^Actions for /u }).click();
      await this.page.getByRole("menuitem", { name: "Revoke" }).click();
      const dialog = this.page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Revoke connection" }).click();
      await expect(row).toHaveCount(0);
      await expect(this.page.getByRole("status")).toHaveText(`${provider} disconnected.`);
    }
  }

  async proveConnectionDisconnectLocksOrganizationSwitch(
    destinationOrganization: string,
  ): Promise<void> {
    const switcher = this.page.getByRole("button", { name: "Organization" });
    await this.openOrganizationSection("Connections");
    const github = this.connectionRow("GitHub");
    const trigger = github.getByRole("button", { name: /^Actions for /u });
    await expect(trigger).toBeVisible();
    const pending = await this.holdGitHubDisconnectStatusRefresh();
    try {
      await trigger.click();
      await this.page.getByRole("menuitem", { name: "Revoke" }).click();
      const dialog = this.page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Revoke connection" }).click();
      await pending.disconnectFinished();
      await pending.refreshStarted();

      await expect(this.page.getByRole("heading", { name: "Connections", level: 1 })).toBeVisible();
      await expect(this.page.getByRole("region", { name: "Loading account context" })).toHaveCount(
        0,
      );
      await trigger.click();
      await expect(this.page.getByRole("menuitem", { name: "Revoke" })).toBeDisabled();
      await this.page.keyboard.press("Escape");
      await switcher.click();
      const menu = this.page.getByRole("menu");
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Acme", exact: true })).toBeDisabled();
      await expect(
        menu.getByRole("menuitem", { name: destinationOrganization, exact: true }),
      ).toBeDisabled();
      await this.page.keyboard.press("Escape");
      await expect(menu).toBeHidden();

      await this.page.getByRole("button", { name: this.accountEmail }).click();
      const accountMenu = this.page.getByRole("menu");
      await expect(accountMenu).toBeVisible();
      await expect(accountMenu.getByRole("menuitem", { name: "Sign out" })).toBeDisabled();
      await this.page.keyboard.press("Escape");
      await expect(accountMenu).toBeHidden();
    } finally {
      await pending.release();
    }

    await expect(this.page.getByRole("status")).toHaveText("GitHub disconnected.");
    await expect(github).toHaveCount(0);
    await this.chooseOrganization(destinationOrganization);
    await this.openOrganizationSection("Connections");
    await expect(this.connectionRow("GitHub")).toBeVisible();
  }

  private async holdGitHubDisconnectStatusRefresh(): Promise<{
    disconnectFinished(): Promise<void>;
    refreshStarted(): Promise<void>;
    release(): Promise<void>;
  }> {
    const serverFunctions = "**/*";
    const disconnectFinished = this.page.waitForResponse((response) => {
      const request = response.request();
      return request.method() === "POST" && request.url().includes("/_serverFn");
    });
    let refreshReceived = () => {};
    const received = new Promise<void>((resolve) => {
      refreshReceived = resolve;
    });
    let releaseRefresh = () => {};
    const released = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshDelivered = () => {};
    const delivered = new Promise<void>((resolve) => {
      refreshDelivered = resolve;
    });
    let refreshIntercepted = false;
    await this.page.route(serverFunctions, async (route) => {
      const request = route.request();
      if (request.method() === "GET" && request.url().includes("/_serverFn")) {
        refreshIntercepted = true;
        refreshReceived();
        try {
          await released;
          await route.continue();
        } finally {
          refreshDelivered();
        }
        return;
      }
      await route.continue();
    });

    return {
      disconnectFinished: () => disconnectFinished.then(() => undefined),
      refreshStarted: () => received,
      release: async () => {
        releaseRefresh();
        if (refreshIntercepted) await delivered;
        await this.page.unroute(serverFunctions);
      },
    };
  }

  async expectMemberConnectionMutationDenied(): Promise<void> {
    await this.openOrganizationSection("Connections");
    await expect(this.page.getByRole("button", { name: /Connect|Revoke/u })).toHaveCount(0);
  }

  async expectNotConfiguredConnections(): Promise<void> {
    await this.openOrganizationSection("Connections");
    await expect(this.page.getByText("Not configured", { exact: true })).toHaveCount(4);
    await expect(this.page.getByRole("button", { name: /Connect|Revoke/u })).toHaveCount(0);
    await expectAccessible(this.page);
  }

  async expectGitHubApprovalRequired(): Promise<void> {
    await this.openOrganizationSection("Connections");
    await this.requestGitHubApproval();
    await this.requestGitHubApproval();
    await expect(this.page.getByText("No connections", { exact: true })).toBeVisible();
  }

  private async requestGitHubApproval(): Promise<void> {
    const connectionsUrl = this.page.url();
    const returned = this.page.waitForResponse((response) =>
      response.url().includes("/api/integrations/github/setup?"),
    );
    await this.page.getByRole("button", { name: "Connect GitHub" }).click();
    await returned;
    await expect(this.page).toHaveURL(connectionsUrl);
    await expect(this.page.getByRole("status")).toHaveText(
      "GitHub owner approval is required. Retry after approval.",
    );
  }

  async expectSuspendedGitHubConnection(): Promise<void> {
    await this.openOrganizationSection("Connections");
    const github = this.connectionRow("GitHub");
    await expect(github.getByText("Suspended", { exact: true })).toBeVisible();
    await expect(this.page.getByRole("button", { name: "Reconnect GitHub" })).toBeVisible();
    await github.getByRole("button", { name: /^Actions for /u }).click();
    await this.page.getByRole("menuitem", { name: "Revoke" }).click();
    const dialog = this.page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Revoke connection" }).click();
    await expect(github).toHaveCount(0);
    await expectAccessible(this.page);
  }

  async expectMobileTeamFitsViewport(): Promise<void> {
    await expect(this.page).toHaveURL(/\/o\/[^/]+\/settings\/team$/u);
    await expect(this.page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
    await expect(this.page.getByText("No pending invitations", { exact: true })).toBeVisible();
    const table = this.page.getByRole("table", { name: "Members" });
    const widths = await table.evaluate((element) => {
      const container = element.parentElement;
      if (container === null) throw new Error("members table container is missing");
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        containerWidth: container.clientWidth,
        containerScrollWidth: container.scrollWidth,
      };
    });
    expect(widths.documentWidth).toBeLessThanOrEqual(widths.viewportWidth);
    expect(widths.containerScrollWidth).toBeLessThanOrEqual(widths.containerWidth);
    await expectAccessible(this.page);
  }

  async expectTeamDestructiveConfirmations(
    memberName: string,
    invitationEmail: string,
  ): Promise<void> {
    await this.openOrganizationSection("Team");
    await this.expectMemberRemovalConfirmation(memberName);
    await this.expectInvitationCancellationConfirmation(invitationEmail);
  }

  private async expectMemberRemovalConfirmation(memberName: string): Promise<void> {
    const member = this.page.getByRole("row").filter({ hasText: memberName });
    const actions = member.getByRole("button", { name: `Actions for ${memberName}` });
    await actions.click();
    await this.page.getByRole("menuitem", { name: `Remove ${memberName}` }).click();
    const memberDialog = this.page.getByRole("alertdialog", {
      name: `Remove ${memberName}?`,
    });
    await expect(memberDialog).toBeVisible();
    await this.page.keyboard.press("Escape");
    await expect(memberDialog).toBeHidden();
    await expect(member).toBeVisible();
    await actions.click();
    await this.page.getByRole("menuitem", { name: `Remove ${memberName}` }).click();
    await memberDialog.getByRole("button", { name: `Remove ${memberName}` }).click();
    await expect(member).toHaveCount(0);
  }

  private async expectInvitationCancellationConfirmation(invitationEmail: string): Promise<void> {
    const invitation = this.invitationRow(invitationEmail);
    const actions = invitation.getByRole("button", { name: `Actions for ${invitationEmail}` });
    await actions.click();
    await this.page.getByRole("menuitem", { name: "Cancel invitation" }).click();
    const invitationDialog = this.page.getByRole("alertdialog", {
      name: `Cancel invitation for ${invitationEmail}?`,
    });
    await invitationDialog.getByRole("button", { name: "Keep invitation" }).click();
    await expect(invitationDialog).toBeHidden();
    await expect(invitation).toBeVisible();
    await actions.click();
    await this.page.getByRole("menuitem", { name: "Cancel invitation" }).click();
    await invitationDialog.getByRole("button", { name: "Cancel invitation" }).click();
    await expect(invitation).toHaveCount(0);
  }

  async expectMemberBoundary(organizationName: string): Promise<void> {
    await this.openOrganizationSection("Team");
    await this.expectActiveOrganization(organizationName);
    await expect(this.page.getByRole("button", { name: "Invite member" })).toHaveCount(0);
    await expect(this.page.getByRole("heading", { name: "Pending invitations" })).toHaveCount(0);
  }

  async changeMemberRole(memberName: string, role: "owner" | "admin" | "member"): Promise<void> {
    await this.refreshOrganizationSection("Team");
    const member = this.page.getByRole("row").filter({ hasText: memberName });
    await this.chooseOption(
      member.getByRole("combobox", { name: `Role for ${memberName}` }),
      roleLabel(role),
    );
    await expect(member.getByRole("combobox", { name: `Role for ${memberName}` })).toHaveText(
      roleLabel(role),
    );
  }

  async expectTeam(expected: TeamExpectation): Promise<void> {
    await this.refreshOrganizationSection("Team");
    const members = this.page.getByRole("table", { name: "Members" });
    for (const value of expected.membersPresent)
      await expect(members.getByText(value, { exact: true })).toBeVisible();
    for (const value of expected.membersAbsent)
      await expect(members.getByText(value, { exact: true })).toHaveCount(0);
    const invitations = this.page.getByRole("table", { name: "Pending invitations" });
    if (expected.invitationsPresent === undefined && expected.invitationsAbsent === undefined) {
      await expect(invitations).toHaveCount(0);
    }
    for (const email of expected.invitationsPresent ?? [])
      await expect(invitations.getByText(email, { exact: true })).toBeVisible();
    for (const email of expected.invitationsAbsent ?? [])
      await expect(this.page.getByText(email, { exact: true })).toHaveCount(0);
  }

  get accountEmail(): string {
    if (this.email === undefined) throw new Error("browser account has not signed up");
    return this.email;
  }

  async attemptInvitation(email: string): Promise<void> {
    const form = await this.openInvitationForm();
    await form.getByLabel("Invitee email").fill(email);
    await form.getByRole("button", { name: "Create invitation" }).click();
  }

  async expectCachedTeamCleared(
    destination: "signedOut" | "organizationRequired",
    cachedValues: string[],
  ): Promise<void> {
    if (destination === "signedOut") {
      await expect(this.page.getByRole("form", { name: "Sign in" })).toBeVisible();
    } else {
      await expect(
        this.page.getByRole("heading", { name: "Choose an organization" }),
      ).toBeVisible();
    }
    await expect(this.page).toHaveURL(/\/o\/[^/]+\/settings\/team$/u);
    await expect(this.page.getByRole("heading", { name: "Team" })).toHaveCount(0);
    for (const value of cachedValues) {
      await expect(this.page.getByText(value, { exact: true })).toHaveCount(0);
    }
  }

  async signOut(): Promise<void> {
    const account = this.page.getByRole("button", { name: this.accountEmail });
    if ((await account.count()) > 0) {
      await account.click();
      await this.page.getByRole("menuitem", { name: "Sign out" }).click();
    } else {
      await this.page.getByRole("button", { name: "Sign out" }).click();
    }
    await expect(this.page.getByRole("form", { name: "Sign in" })).toBeVisible();
    await expect
      .poll(async () =>
        (await this.context.cookies()).some(({ name }) => name.includes("session_token")),
      )
      .toBe(false);
  }

  private async expectCurrentDaemonAbsent(displayName: string): Promise<void> {
    await this.page.getByRole("link", { name: "Daemons", exact: true }).click();
    await expect(this.page).toHaveURL(/\/o\/[^/]+\/daemons$/u);
    await expect(this.page.getByRole("heading", { name: "Daemons" })).toBeVisible();
    await expect(this.page.getByRole("row").filter({ hasText: displayName })).toHaveCount(0);
  }

  private async submitOrganization(name: string): Promise<void> {
    await this.page.getByRole("button", { name: "Create an organization" }).click();
    const form = this.page.getByRole("form", { name: "Create organization" });
    await expect(form).toBeVisible();
    await form.getByLabel("Organization name").fill(name);
    await form.getByRole("button", { name: "Create organization" }).click();
  }

  /**
   * Reaches an organization surface by whichever route the information architecture puts it on:
   * Projects, Daemons, and Connections are sidebar entries, the administration sections are tabs
   * under Settings. Callers name the destination, not the path to it.
   */
  private async openOrganizationSection(
    name: OrganizationSection | OrganizationSettingsSection,
  ): Promise<void> {
    const settings = ORGANIZATION_SETTINGS_SECTIONS.includes(name as OrganizationSettingsSection);
    await this.returnToOrganizationScope();
    const mobile = await this.page
      .getByRole("button", { name: "Toggle Sidebar" })
      .isVisible()
      .catch(() => false);
    if (settings) {
      const section = name as OrganizationSettingsSection;
      if (mobile) await this.navigation.openMobileOrganizationSettings(section);
      else await this.navigation.openOrganizationSettings(section);
    } else {
      const section = name as OrganizationSection;
      if (mobile) await this.navigation.openMobileOrganizationSection(section);
      else await this.navigation.openOrganizationSection(section);
    }
    await expect(this.page.getByRole("heading", { name, exact: true, level: 1 })).toBeVisible();
  }

  /**
   * The sidebar body lists one scope's destinations, so organization destinations are not
   * reachable from inside a project or from the instance. Take whichever back row the scope
   * offers, exactly as a user would.
   */
  private async returnToOrganizationScope(): Promise<void> {
    const pathname = new URL(this.page.url()).pathname;
    const instance = INSTANCE_ROUTES.includes(pathname);
    if (!instance && !/\/projects\/[^/]+\//u.test(pathname)) return;
    const mobileSidebar = this.page.getByRole("button", { name: "Toggle Sidebar" });
    if (await mobileSidebar.isVisible().catch(() => false)) await mobileSidebar.click();
    if (instance) await this.navigation.leaveInstance();
    else await this.navigation.leaveProject();
    await expect(this.page.getByRole("heading", { name: "Triggers" })).toBeVisible();
  }

  private async refreshOrganizationSection(name: "Daemons" | "Connections" | "Team") {
    await this.openOrganizationSection("Triggers");
    await this.openOrganizationSection(name);
    await this.page.reload();
  }

  private connectionRow(provider: string): Locator {
    return this.page
      .getByRole("table", { name: "Connections" })
      .getByRole("row")
      .filter({ has: this.page.getByRole("cell", { name: provider, exact: true }) });
  }

  private async chooseOption(select: Locator, option: string): Promise<void> {
    await select.click();
    const listbox = this.page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    await listbox.getByRole("option", { name: option, exact: true }).click();
    await expect(listbox).toBeHidden();
    await expect(select).toHaveText(option);
  }
}

export interface AppSetupSession {
  application: BuiltApplication;
  page: Page;
  surface: AppSetupSurface;
  origin: string;
  openManagement(): Promise<void>;
  /** Reaches Apps the way an operator does after onboarding: through the account menu. */
  navigateToApps(): Promise<void>;
  returnFromProvider(
    provider: "github" | "slack" | "discord" | "linear",
    result: string,
  ): Promise<void>;
  /** A correctly-signed inbound delivery — the only thing that proves a webhook secret. */
  seedSignedDelivery(provider: "github" | "slack"): Promise<void>;
  prepareSlackSocketWorkflow(): Promise<void>;
  deliverSlackSocketMention(eventId: string): Promise<void>;
  slackSocketEvidence(eventId: string): Promise<{ receipts: number; runs: number }>;
  restart(): Promise<void>;
  /** Enrolls and connects a daemon into the operator's organization; answers with its slug. */
  connectDaemon(): Promise<string>;
  /** A second, ordinary account on the same instance. Never its operator. */
  openMember(member: Account): Promise<{ page: Page; close(): Promise<void> }>;
  close(): Promise<void>;
}

async function seedSignedDelivery(
  page: Page,
  origin: string,
  provider: "github" | "slack",
): Promise<void> {
  if (provider === "github") {
    const body = JSON.stringify({ installation: { id: 42 } });
    const signature = `sha256=${createHmac("sha256", "phase-zero-webhook-secret")
      .update(body)
      .digest("hex")}`;
    const response = await page.request.post(`${origin}/webhook`, {
      data: body,
      headers: {
        "content-type": "application/json",
        "x-github-delivery": `delivery-${randomUUID()}`,
        "x-github-event": "ping",
        "x-hub-signature-256": signature,
      },
    });
    expect(response.ok()).toBe(true);
    return;
  }

  const timestamp = String(Math.floor(Date.now() / 1_000));
  const body = JSON.stringify({
    type: "event_callback",
    team_id: "T-ACME",
    api_app_id: "browser-slack-app",
    event_id: `event-${randomUUID()}`,
    event_time: Number(timestamp),
    event: {
      type: "app_mention",
      user: "U1",
      channel: "C1",
      text: "<@B1> verify delivery",
      ts: `${timestamp}.000100`,
      event_ts: `${timestamp}.000100`,
    },
  });
  const signature = `v0=${createHmac("sha256", "phase-zero-slack-webhook-secret")
    .update("v0:")
    .update(timestamp)
    .update(":")
    .update(body)
    .digest("hex")}`;
  const response = await page.request.post(`${origin}/api/integrations/slack/events`, {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
  });
  expect(response.ok()).toBe(true);
}

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

function roleLabel(role: "owner" | "admin" | "member"): string {
  return role[0]!.toUpperCase() + role.slice(1);
}

class ContractDaemon {
  readonly daemonId = randomUUID();
  readonly slug: string;
  private readonly credential = randomUUID();
  private readonly executionCapabilities = new Map<string, ExecutionCapability>();
  private readonly executionCreateEvents = new Map<
    string,
    { promise: Promise<void>; resolve: () => void }
  >();
  private socket: WebSocket | undefined;
  private webSocketUrl = "";

  constructor(
    private readonly application: BuiltApplication,
    private readonly requests: APIRequestContext,
    friendlyName?: string,
  ) {
    const fallback = `daemon-${this.daemonId.slice(0, 8)}`;
    this.slug = friendlyName === undefined ? fallback : slugify(friendlyName, fallback);
  }

  async enroll(token: string): Promise<void> {
    const response = await this.requests.post(`${this.application.origin}/api/daemons/enroll`, {
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      data: daemonEnrollment(this.daemonId, this.credential),
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe(JSON_TYPE);
    const body = z
      .object({
        daemonId: z.literal(this.daemonId),
        slug: z.literal(this.slug),
        scopes: z.tuple([z.literal("hub.execution.*")]),
        webSocketUrl: z.string().url(),
      })
      .strict()
      .parse(await response.json());
    this.webSocketUrl = body.webSocketUrl;
  }

  async connect(): Promise<void> {
    const socket = new WebSocket(this.webSocketUrl, {
      headers: {
        authorization: `Bearer ${this.credential}`,
        "x-paseo-daemon-id": this.daemonId,
      },
    });
    socket.on("message", (data) => this.acceptExecution(data));
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
  }

  async executionCapability(executionId: string): Promise<ExecutionCapability> {
    const capability = this.executionCapabilities.get(executionId);
    if (capability !== undefined) return capability;
    const existingEvent = this.executionCreateEvents.get(executionId);
    if (existingEvent !== undefined) {
      await existingEvent.promise;
    } else {
      let resolve!: () => void;
      const promise = new Promise<void>((fulfill) => {
        resolve = fulfill;
      });
      this.executionCreateEvents.set(executionId, { promise, resolve });
      await promise;
    }
    return z
      .object({ url: z.string().url(), headers: z.record(z.string(), z.string()) })
      .parse(this.executionCapabilities.get(executionId));
  }

  async expectUnauthorizedRevocation(): Promise<void> {
    const response = await this.requests.delete(
      `${this.application.origin}/api/daemons/${this.daemonId}`,
      { headers: { authorization: "Bearer wrong-credential" } },
    );
    expect(response.status()).toBe(401);
    expect(await response.text()).toBe('{"error":"unauthorized"}');
    expect(response.headers()["content-type"]).toBe(JSON_TYPE);
  }

  async revoke(): Promise<void> {
    const response = await this.requests.delete(
      `${this.application.origin}/api/daemons/${this.daemonId}`,
      { headers: { authorization: `Bearer ${this.credential}` } },
    );
    expect(response.status()).toBe(204);
    expect(await response.body()).toEqual(Buffer.alloc(0));
  }

  async close(): Promise<void> {
    this.socket?.close();
  }

  private acceptExecution(data: RawData): void {
    const envelope = ExecutionRequestSchema.safeParse(JSON.parse(readSocketData(data)));
    if (!envelope.success) return;
    const request = envelope.data.message;
    const capability = request.mcpServers?.["hub"];
    if (capability !== undefined) {
      this.executionCapabilities.set(request.executionId, capability);
    }
    this.executionCreateEvents.get(request.executionId)?.resolve();
    this.executionCreateEvents.delete(request.executionId);
    this.socket?.send(
      JSON.stringify({
        type: "session",
        message: {
          type: "hub.execution.agent.create.response",
          payload: {
            requestId: request.requestId,
            executionId: request.executionId,
            agentId: `agent-${request.executionId}`,
            agent: { id: `agent-${request.executionId}`, status: "running" },
            success: true,
            toolPolicyApplied: true,
            error: null,
          },
        },
      }),
    );
  }
}

type ExecutionCapability = { url: string; headers: Record<string, string> };

interface HttpContract {
  name: string;
  request: HttpRequest;
  expected: HttpResponse;
}

interface HttpRequest {
  path: string;
  method: "GET" | "POST" | "DELETE" | "PUT";
  headers?: Record<string, string>;
  body?: string;
}

interface HttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

const WEBHOOK_SECRET = "phase-zero-webhook-secret";
const SLACK_WEBHOOK_SECRET = "phase-zero-slack-webhook-secret";
// Must match e2e/app.ts's STRIPE_WEBHOOK_SECRET env value and browser-child.ts's fixture config.
const STRIPE_WEBHOOK_SECRET = "whsec_phase_zero_fixture_secret";

interface PublicBillingPlanExpectation {
  slug: string;
  name: string;
  marketingFeatures: readonly string[];
  prices: {
    monthly: { unitAmount: number; currency: string } | null;
    annual: { unitAmount: number; currency: string } | null;
  };
}

/**
 * What `/api/billing/plans` serves for the fixture catalog in `browser-billing.ts`: the one plan
 * Hub sells. The `free` product is in that catalog too — it carries the entitlement floor — but it
 * is not an offer, and billing withholds it from every public response.
 */
const FIXTURE_BILLING_PLAN_EXPECTATIONS: readonly PublicBillingPlanExpectation[] = [
  {
    slug: "hosted",
    name: "Paseo Hub",
    marketingFeatures: [
      "Unlimited daemons",
      "GitHub, Linear, Slack, and Discord triggers",
      "Versioned workflows and activity",
      "Bring your own agents and inference",
    ],
    prices: { monthly: { unitAmount: 1500, currency: "eur" }, annual: null },
  },
];
/** The one plan the fixture catalog — and the live Stripe catalog — publishes. */
const HOSTED_PLAN_NAME = "Paseo Hub";
const HOSTILE_ORIGIN = "https://hostile.invalid";
const JSON_TYPE = "application/json";
const PROBLEM_TYPE = "application/problem+json";
const ORGANIZATION_POST_PATHS = [
  "/api/auth/paseo/create-organization",
  "/api/auth/paseo/select-organization",
] as const;
const TEXT_TYPE = "text/plain;charset=UTF-8";
const HTML_TYPE = "text/html; charset=utf-8";

function manualFailureContracts(machineKey: string): readonly HttpContract[] {
  return [
    exact("health", "/health", "GET", 200, '{"ok":true}', JSON_TYPE),
    exact(
      "enrollment token requires machine authentication",
      "/api/v1/daemons/enrollment-tokens",
      "POST",
      401,
      problemBody(
        "phase-zero-contract",
        401,
        "unauthorized",
        "Authentication required",
        "Provide an active Paseo organization credential in the Authorization: Bearer header.",
      ),
      PROBLEM_TYPE,
      { "x-request-id": "phase-zero-contract" },
    ),
    exact(
      "daemon enrollment requires a token",
      "/api/daemons/enroll",
      "POST",
      401,
      '{"error":"unauthorized"}',
      JSON_TYPE,
    ),
    exact(
      "daemon revocation conceals missing daemons",
      "/api/daemons/00000000-0000-4000-8000-000000000000",
      "DELETE",
      401,
      '{"error":"unauthorized"}',
      JSON_TYPE,
    ),
    exact(
      "execution completion requires a token",
      "/agent-executions/00000000-0000-4000-8000-000000000000/mcp",
      "POST",
      401,
      '{"error":"unauthorized"}',
      JSON_TYPE,
    ),
    exact(
      "configuration install requires admin",
      "/api/v1/configurations/install",
      "POST",
      401,
      problemBody(
        "phase-zero-contract",
        401,
        "unauthorized",
        "Authentication required",
        "Provide an active Paseo organization credential in the Authorization: Bearer header.",
      ),
      PROBLEM_TYPE,
      { "x-request-id": "phase-zero-contract" },
    ),
    exact(
      "manual run requires admin",
      "/api/v1/manual-runs",
      "POST",
      401,
      problemBody(
        "phase-zero-contract",
        401,
        "unauthorized",
        "Authentication required",
        "Provide an active Paseo organization credential in the Authorization: Bearer header.",
      ),
      PROBLEM_TYPE,
      { "x-request-id": "phase-zero-contract" },
    ),
    exact(
      "obsolete test trigger is unavailable",
      "/test/trigger",
      "POST",
      404,
      "Not Found",
      TEXT_TYPE,
    ),
    exact("obsolete test smoke is unavailable", "/test/smoke", "POST", 404, "Not Found", TEXT_TYPE),
    exact("webhook requires a signature", "/webhook", "POST", 401, "Unauthorized", TEXT_TYPE),
    exact(
      "invalid configuration is not activated",
      "/api/v1/configurations/install",
      "POST",
      422,
      problemBody(
        "phase-zero-contract",
        422,
        "invalid_configuration_bundle",
        "Invalid configuration bundle",
        "Correct the canonical Hub bundle files and submit them again.",
        [{ path: [".paseo/hub.yml"], message: "invalid YAML: line 2, column 1" }],
      ),
      PROBLEM_TYPE,
      {
        ...machineHeaders(machineKey),
        "content-type": "application/json",
        "x-request-id": "phase-zero-contract",
      },
      JSON.stringify({
        projectSlug: "default",
        files: [{ path: ".paseo/hub.yml", content: "environments: [" }],
      }),
    ),
    exact(
      "unknown manual config is visible",
      "/api/v1/manual-runs",
      "POST",
      404,
      problemBody(
        "phase-zero-contract",
        404,
        "project_not_found",
        "Project not found",
        "No active project with that slug exists in the credential's organization.",
      ),
      PROBLEM_TYPE,
      {
        ...machineHeaders(machineKey),
        "content-type": "application/json",
        "x-request-id": "phase-zero-contract",
      },
      JSON.stringify({
        projectSlug: "missing",
        trigger: "deploy",
        actor: "contract-operator",
        deliveryKey: "missing",
        input: {},
      }),
    ),
  ];
}

const WEBHOOK_SOURCE_CONTRACTS: readonly HttpContract[] = [
  exact(
    "manual trigger is unavailable in webhook mode",
    "/test/trigger",
    "POST",
    404,
    "Not Found",
    TEXT_TYPE,
  ),
  exact(
    "manual smoke is unavailable in webhook mode",
    "/test/smoke",
    "POST",
    404,
    "Not Found",
    TEXT_TYPE,
  ),
  exact("webhook requires a signature", "/webhook", "POST", 401, "Unauthorized", TEXT_TYPE),
];

const ExecutionRequestSchema = z.object({
  type: z.literal("session"),
  message: z.object({
    type: z.literal("hub.execution.agent.create.request"),
    requestId: z.string(),
    executionId: z.string(),
    env: z.record(z.string(), z.string()).optional(),
    mcpServers: z
      .record(
        z.string(),
        z.object({
          type: z.literal("http"),
          url: z.string().url(),
          headers: z.record(z.string(), z.string()).default({}),
        }),
      )
      .optional(),
  }),
});

function exact(
  name: string,
  path: string,
  method: HttpRequest["method"],
  status: number,
  body: string,
  contentType: string,
  headers?: Record<string, string>,
  requestBody?: string,
): HttpContract {
  return {
    name,
    request: {
      path,
      method,
      ...(headers === undefined ? {} : { headers }),
      ...(requestBody === undefined ? {} : { body: requestBody }),
    },
    expected: { status, body, headers: { "content-type": contentType } },
  };
}

function problemBody(
  requestId: string,
  status: number,
  code: string,
  title: string,
  detail: string,
  issues?: readonly { path: readonly (string | number)[]; message: string }[],
): string {
  return JSON.stringify({
    type: `https://paseo.sh/problems/${code.replaceAll("_", "-")}`,
    title,
    status,
    detail,
    code,
    requestId,
    ...(issues === undefined ? {} : { issues }),
  });
}

function machineHeaders(machineKey: string): Record<string, string> {
  return { authorization: `Bearer ${machineKey}` };
}

function daemonEnrollment(daemonId: string, credential: string) {
  return {
    daemonId,
    idempotencyKey: randomUUID(),
    serverId: randomUUID(),
    daemonPublicKey: "built-contract-public-key",
    credentialVerifier: createHash("sha256").update(credential).digest("base64url"),
  };
}

function browserUnroutedSlackConfiguration(daemonSlug: string) {
  return {
    environments: [
      {
        name: "runner",
        kind: "daemon" as const,
        daemon: daemonSlug,
        cwd: "/workspace",
      },
    ],
    triggers: [
      {
        name: "slack-run",
        on: "slack.mention",
        max_runtime: "1h",
        filters: {
          workspace: "drop-reason-slack",
          channels: ["SAFE-CONFIG-CHANNEL"],
          from_users: ["SAFE-CONFIG-SENDER"],
        },
        steps: [
          {
            id: "work",
            environment: "runner",
            max_runtime: "10m",
            idle_timeout: "1m",
            agent: { provider: "test" },
            prompt: [{ text: "Handle Slack event" }],
          },
        ],
      },
    ],
  };
}

function providerDispatchConfiguration(repo: string, guildId: string) {
  return {
    environments: [
      {
        name: "shared",
        kind: "daemon" as const,
        daemon: "shared-dispatch",
        cwd: "/workspace",
      },
    ],
    triggers: [
      {
        name: "github-dispatch",
        on: "github.issue_comment",
        max_runtime: "1h",
        filters: { repo, from_users: ["alice"] },
        steps: [
          {
            id: "github-dispatch-step",
            environment: "shared",
            max_runtime: "30m",
            idle_timeout: "5m",
            agent: { provider: "opencode", mode: "full-access" },
            prompt: [{ text: "Handle GitHub tenant dispatch" }],
          },
        ],
      },
      {
        name: "discord-dispatch",
        on: "discord.mention",
        max_runtime: "1h",
        filters: { guild: guildId, from_users: ["800"] },
        steps: [
          {
            id: "discord-dispatch-step",
            environment: "shared",
            max_runtime: "30m",
            idle_timeout: "5m",
            agent: { provider: "opencode", mode: "full-access" },
            prompt: [{ text: "Handle Discord tenant dispatch" }],
          },
        ],
      },
    ],
  };
}

function githubIssueCommentPayload(installationId: number, repo: string, actor: string) {
  return {
    action: "created",
    sender: { login: actor },
    comment: { id: installationId, body: "@paseo run tenant dispatch", user: { login: actor } },
    issue: { number: installationId },
    repository: { id: installationId, full_name: repo },
    installation: { id: installationId },
  };
}

function dispatchEvidence(deliveryId: string, organizationId: string, daemonId: string) {
  return {
    delivery_id: deliveryId,
    trigger_organization_id: organizationId,
    config_organization_id: organizationId,
    machine_organization_id: organizationId,
    daemon_id: daemonId,
    daemon_slug: "shared-dispatch",
    execution_id: expect.any(String),
  };
}

function manualConfiguration(daemonSlug: string): string {
  return [
    "environments:",
    "  - name: production",
    "    kind: daemon",
    `    daemon: ${daemonSlug}`,
    "    cwd: /workspace",
    "triggers:",
    "  - name: deploy",
    "    on: manual.run",
    "    max_runtime: 1h",
    "    filters:",
    "      from_users: [contract-operator]",
    "    steps:",
    "      - id: deploy-step",
    "        environment: production",
    "        max_runtime: 30m",
    "        idle_timeout: 5m",
    "        agent:",
    "          provider: opencode",
    "          mode: full-access",
    '        prompt: [{ text: "Deploy the contract" }]',
  ].join("\n");
}

function readSocketData(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  return Buffer.from(data).toString();
}

function plainLogs(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/gu, "");
}

async function retryUntil<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15_000;
  let value = await read();
  while (!done(value)) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for durable provider dispatch");
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}
