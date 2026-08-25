import type { Message } from "discord.js";
import type { GitHubAuth } from "../../auth/github.js";
import type { DiscordGuildIdentity } from "../../providers/discord/client.js";
import type { DiscordConnectionClient } from "../../providers/discord/client.js";
import type {
  GitHubConnectionClient,
  GitHubInstallationIdentity,
} from "../../providers/github/client.js";
import type {
  GitHubCreatedReaction,
  GitHubReactionClient,
} from "../../triggers/github/provider.js";
import type { SlackBotClient } from "../../triggers/slack/client.js";
import { MemoryDiscordBotClient } from "../../triggers/discord/memory-bot.js";
import type { GitHubConfigurationProvider } from "../../configuration/github-sync.js";
import type { HubBundleFile } from "../../config/bundle.js";

const GITHUB_INSTALLATIONS: readonly GitHubInstallationIdentity[] = [
  {
    installationId: 42,
    accountId: "420",
    accountLogin: "acme-inc",
    accountType: "Organization",
    status: "active",
  },
  {
    installationId: 84,
    accountId: "840",
    accountLogin: "orbit-inc",
    accountType: "Organization",
    status: "active",
  },
];

const DISCORD_GUILDS: readonly DiscordGuildIdentity[] = [
  { guildId: "100", guildName: "Acme Guild" },
  { guildId: "200", guildName: "Orbit Guild" },
];

/**
 * How the fixture providers behave for one journey. One list, so adding a scenario is one edit
 * rather than an edit and a matching branch in the child process that reads it back.
 */
export const BROWSER_PROVIDER_SCENARIOS = [
  "connected",
  "approval",
  "conflict",
  "discord-verification-network",
  "discord-disallowed-intents",
  "discord-client-secret-rejected",
  "discord-rate-limited",
  "github-verification-internal",
  "slack-permission-missing",
  "not-configured",
  "discord-only",
  "slack-only",
] as const;

export type BrowserProviderScenario = (typeof BROWSER_PROVIDER_SCENARIOS)[number];

export function isBrowserProviderScenario(value: string): value is BrowserProviderScenario {
  return (BROWSER_PROVIDER_SCENARIOS as readonly string[]).includes(value);
}

export class BrowserGitHubAuth implements GitHubAuth {
  getInstallation() {
    return Promise.resolve(undefined);
  }

  getInstallationToken(installationId: number) {
    return Promise.resolve(`installation-token-${installationId}`);
  }

  mintInstallationToken(installationId: number) {
    return Promise.resolve(`installation-token-${installationId}`);
  }

  mintInstallationAccessToken(input: {
    installationId: number;
    accountLogin: string;
    repositories: readonly string[];
    permissions: Readonly<Record<string, "read" | "write" | "admin">>;
  }) {
    return Promise.resolve({
      token: `execution-token-${input.installationId}-${input.repositories.join(",")}`,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
  }

  getAppBotIdentity() {
    return Promise.resolve({ id: 12345, login: "paseo[bot]" });
  }

  revokeInstallationToken() {
    return Promise.resolve();
  }

  createInstallationOctokit() {
    return Promise.reject(new Error("unused by the browser harness"));
  }
}

export class BrowserGitHubConnections implements GitHubConnectionClient {
  private pendingAuthorization: GitHubInstallationIdentity | undefined;
  private nextInstallation = 0;

  constructor(
    private readonly publicBaseUrl: string,
    private readonly scenario: BrowserProviderScenario,
  ) {}

  setupUrl(state: string): string {
    const callback = new URL("/api/integrations/github/setup", this.publicBaseUrl);
    callback.searchParams.set("state", state);
    if (this.scenario === "approval") {
      callback.searchParams.set("setup_action", "request");
      return callback.toString();
    }
    const identity =
      this.scenario === "conflict"
        ? GITHUB_INSTALLATIONS[0]
        : GITHUB_INSTALLATIONS[this.nextInstallation++];
    if (identity === undefined) throw new Error("no deterministic GitHub installation remains");
    this.pendingAuthorization = identity;
    callback.searchParams.set("setup_action", "install");
    callback.searchParams.set("installation_id", String(identity.installationId));
    return callback.toString();
  }

  authorizationUrl(input: { state: string; challenge: string }): string {
    const identity = this.pendingAuthorization;
    if (identity === undefined) throw new Error("GitHub authorization has no verified setup");
    this.pendingAuthorization = undefined;
    const callback = new URL("/api/integrations/github/callback", this.publicBaseUrl);
    callback.searchParams.set("state", input.state);
    callback.searchParams.set("code", `github-${identity.installationId}`);
    return callback.toString();
  }

  verifyUserInstallation(input: {
    code: string;
    installationId: number;
  }): Promise<GitHubInstallationIdentity | undefined> {
    const expectedCode = `github-${input.installationId}`;
    return Promise.resolve(
      input.code === expectedCode ? this.installation(input.installationId) : undefined,
    );
  }

  getInstallation(installationId: number) {
    const identity = this.installation(installationId);
    return Promise.resolve(
      identity === undefined
        ? { status: "absent" as const }
        : { status: "present" as const, identity },
    );
  }

  private installation(installationId: number): GitHubInstallationIdentity | undefined {
    return GITHUB_INSTALLATIONS.find((identity) => identity.installationId === installationId);
  }
}

export class BrowserGitHubConfiguration implements GitHubConfigurationProvider {
  private readonly heads = new Map<number, string>();
  private readonly files = new Map<string, string>();

  listInstallationRepositories({ installationId }: { installationId: number }) {
    return Promise.resolve(
      installationId === 42
        ? [
            { repositoryId: 9001, fullName: "acme-inc/app", defaultBranch: "main" },
            { repositoryId: 9002, fullName: "acme-inc/docs", defaultBranch: "main" },
          ]
        : [{ repositoryId: 9101, fullName: "orbit-inc/app", defaultBranch: "main" }],
    );
  }

  readDefaultBranchHead(input: { repositoryId: number }) {
    const head = this.heads.get(input.repositoryId);
    if (head === undefined) throw new Error("browser repository has no branch head");
    return Promise.resolve(head);
  }

  readFileAtCommit(input: { repositoryId: number; commitSha: string; path: string }) {
    const content = this.files.get(`${input.repositoryId}:${input.commitSha}:${input.path}`);
    return Promise.resolve(content === undefined ? undefined : { kind: "file" as const, content });
  }

  listFilesAtCommit(input: { repositoryId: number; commitSha: string; prefix: string }) {
    const keyPrefix = `${input.repositoryId}:${input.commitSha}:`;
    return Promise.resolve(
      [...this.files.keys()]
        .filter((key) => key.startsWith(keyPrefix))
        .map((key) => key.slice(keyPrefix.length))
        .filter((path) => path === input.prefix || path.startsWith(`${input.prefix}/`))
        .map((path) => ({ path, kind: "file" as const })),
    );
  }

  setRevision(input: {
    repositoryId: number;
    commitSha: string;
    files?: readonly HubBundleFile[];
  }) {
    this.heads.set(input.repositoryId, input.commitSha);
    for (const file of input.files ?? []) {
      this.files.set(`${input.repositoryId}:${input.commitSha}:${file.path}`, file.content);
    }
  }
}

export class BrowserDiscordConnections implements DiscordConnectionClient {
  private readonly guilds = new Map(DISCORD_GUILDS.map((guild) => [guild.guildId, guild]));
  private nextGuild = 0;

  constructor(
    private readonly publicBaseUrl: string,
    private readonly scenario: BrowserProviderScenario,
  ) {}

  authorizationUrl(state: string): string {
    const guild =
      this.scenario === "conflict" ? DISCORD_GUILDS[0] : DISCORD_GUILDS[this.nextGuild++];
    if (guild === undefined) throw new Error("no deterministic Discord guild remains");
    const callback = new URL("/api/integrations/discord/callback", this.publicBaseUrl);
    callback.searchParams.set("state", state);
    callback.searchParams.set("code", `discord-${guild.guildId}`);
    return callback.toString();
  }

  verifyGuild(code: string): Promise<DiscordGuildIdentity | undefined> {
    return Promise.resolve(this.guilds.get(code.replace(/^discord-/u, "")));
  }

  leaveGuild(guildId: string): Promise<void> {
    this.guilds.delete(guildId);
    return Promise.resolve();
  }

  guildMembership(guildId: string) {
    return Promise.resolve(this.guilds.has(guildId) ? ("present" as const) : ("absent" as const));
  }
}

export interface BrowserDiscordEvent {
  guildId: string;
  channelId: string;
  messageId: string;
  authorId: string;
  authorUsername: string;
  content: string;
}

export class BrowserDiscordBot extends MemoryDiscordBotClient {
  constructor(private readonly scenario: BrowserProviderScenario = "connected") {
    super({ selfUserId: "900" });
  }

  override async start(): Promise<void> {
    if (this.scenario === "discord-disallowed-intents") {
      throw Object.assign(
        new Error("safe gateway failure", {
          cause: new Error("formatless-browser-gateway-cause-6ad1"),
        }),
        {
          name: "DiscordGatewayError",
          gatewayCloseCode: 4014,
          gatewayFailure: "disallowedIntents",
          code: "permissionMissing",
        },
      );
    }
    await super.start();
  }

  deliver(event: BrowserDiscordEvent): Promise<void> {
    const message: unknown = {
      guildId: event.guildId,
      channelId: event.channelId,
      channel: { isThread: () => false, parentId: null },
      id: event.messageId,
      content: event.content,
      mentions: {
        users: [{ id: this.getSelfUserId() }],
        roles: [],
      },
      author: { id: event.authorId, username: event.authorUsername, bot: false },
      createdAt: new Date(),
      attachments: new Map(),
      reference: null,
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return this.emitMessage(message as Message);
  }
}

export class BrowserSlackBot implements SlackBotClient {
  sendMessage(): Promise<void> {
    return Promise.resolve();
  }

  addReaction(): Promise<void> {
    return Promise.resolve();
  }

  removeReaction(): Promise<void> {
    return Promise.resolve();
  }
}

export class BrowserGitHubReactions implements GitHubReactionClient {
  private nextId = 1;

  createReaction(): Promise<GitHubCreatedReaction> {
    return Promise.resolve({ id: this.nextId++ });
  }

  deleteReaction(): Promise<void> {
    return Promise.resolve();
  }
}
