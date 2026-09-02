import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Locks } from "./runtime/locks/index.js";
import type { DatabaseRuntime, DrizzleHandle, TransactionHandle } from "./runtime/index.js";
import { slugify } from "../slug.js";
import {
  ConnectionAccessDeniedError,
  ConnectionAttemptUnavailableError,
  ConnectionConflictError,
} from "./errors.js";
import * as schema from "./schema.js";
import type { CredentialCipher } from "../credentials/credential-cipher.js";
import type {
  AdvanceGitHubConnectionAttemptInput,
  BindDiscordConnectionInput,
  BindGitHubConnectionInput,
  BindLinearConnectionInput,
  BindSlackConnectionInput,
  CompleteLinearProviderApplicationInput,
  CompleteSlackProviderApplicationInput,
  ConnectionAccountAccess,
  ConnectionAttemptPhase,
  ConnectionAttemptRecord,
  ConnectionProvider,
  ConnectionStartAuthority,
  DiscordConnectionRecord,
  GitHubConnectionRecord,
  LinearConnectionRecord,
  LinearConnectionRefreshOperation,
  ReadConnectionAttemptInput,
  SlackConnectionRecord,
  StartConnectionAttemptInput,
  UpdateLinearConnectionTokensInput,
} from "./types.js";

type HubDatabase = DrizzleHandle;
type HubTransaction = HubDatabase;
type AttemptRow = typeof schema.organizationConnectionAttempts.$inferSelect;

export class ConnectionRepository {
  private readonly database: HubDatabase;

  constructor(
    private readonly runtime: DatabaseRuntime,
    private readonly locks: Locks,
    private readonly credentialCipher: CredentialCipher,
  ) {
    this.database = runtime.drizzle();
  }

  async startAttempt(input: StartConnectionAttemptInput): Promise<void> {
    await this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      await lockStartAuthority(transaction, input.access);
      await transaction.delete(schema.organizationConnectionAttempts).where(orExpiredOrConsumed());
      await transaction.insert(schema.organizationConnectionAttempts).values({
        provider: input.provider,
        phase: initialConnectionAttemptPhase(input.provider),
        stateVerifier: input.stateVerifier,
        organizationId: input.access.organizationId,
        returnRoute: input.access.returnRoute,
        userId: input.access.userId,
        sessionId: input.access.sessionId,
        configurationVersion: input.configurationVersion,
        providerApplicationId: input.providerApplicationId,
        callbackOrigin: input.callbackOrigin,
        configurationEnvelope: this.credentialCipher.encrypt(
          connectionAttemptCredentialOwner(input),
          input.configurationSnapshot,
        ),
        expectedConfigurationVersion: input.expectedConfigurationVersion,
        activateConfiguration: input.activateConfiguration,
        expiresAt: sql`clock_timestamp() + (${input.lifetimeMinutes} * interval '1 minute')`,
      });
    });
  }

  async readAttempt(input: ReadConnectionAttemptInput): Promise<ConnectionAttemptRecord> {
    return this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      await lockAccountSession(transaction, input.access);
      const attempt = await lockAttempt(transaction, input);
      await lockStoredAuthority(transaction, attempt);
      return toAttempt(this.credentialCipher, attempt);
    });
  }

  async findAttemptConfiguration(stateVerifier: string): Promise<
    | {
        providerApplicationId: string;
        configurationVersion: number;
        callbackOrigin: string;
        configurationSnapshot: unknown;
        expectedConfigurationVersion: number | null;
        activateConfiguration: boolean;
      }
    | undefined
  > {
    const [attempt] = await this.database
      .select({
        configurationVersion: schema.organizationConnectionAttempts.configurationVersion,
        provider: schema.organizationConnectionAttempts.provider,
        providerApplicationId: schema.organizationConnectionAttempts.providerApplicationId,
        callbackOrigin: schema.organizationConnectionAttempts.callbackOrigin,
        configurationEnvelope: schema.organizationConnectionAttempts.configurationEnvelope,
        expectedConfigurationVersion:
          schema.organizationConnectionAttempts.expectedConfigurationVersion,
        activateConfiguration: schema.organizationConnectionAttempts.activateConfiguration,
      })
      .from(schema.organizationConnectionAttempts)
      .where(
        and(
          eq(schema.organizationConnectionAttempts.stateVerifier, stateVerifier),
          isNull(schema.organizationConnectionAttempts.consumedAt),
        ),
      )
      .limit(1);
    if (attempt === undefined || attempt.providerApplicationId === null) return undefined;
    return {
      providerApplicationId: attempt.providerApplicationId,
      configurationVersion: attempt.configurationVersion,
      callbackOrigin: attempt.callbackOrigin,
      configurationSnapshot: this.credentialCipher.decrypt(
        connectionAttemptCredentialOwner(attempt),
        attempt.configurationEnvelope,
      ),
      expectedConfigurationVersion: attempt.expectedConfigurationVersion,
      activateConfiguration: attempt.activateConfiguration,
    };
  }

  async consumeAttempt(input: ReadConnectionAttemptInput): Promise<void> {
    await this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      await lockAccountSession(transaction, input.access);
      const attempt = await lockAttempt(transaction, input);
      await lockStoredAuthority(transaction, attempt);
      await lockProviderApplication(
        this.locks,
        runtimeTransaction,
        attempt.provider,
        requireAttemptApplicationId(attempt),
      );
      await requireConsumableAttempt(transaction, attempt);
      await consumeLockedAttempt(transaction, attempt.id);
    });
  }

  async advanceGitHubAttempt(input: AdvanceGitHubConnectionAttemptInput): Promise<void> {
    await this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      await lockAccountSession(transaction, input.access);
      const attempt = await lockAttempt(transaction, input);
      await lockStoredAuthority(transaction, attempt);
      await lockProviderApplication(
        this.locks,
        runtimeTransaction,
        attempt.provider,
        requireAttemptApplicationId(attempt),
      );
      await requireCurrentAttempt(transaction, attempt);
      await transaction
        .update(schema.organizationConnectionAttempts)
        .set({
          phase: "github_user_authorization",
          stateVerifier: input.nextStateVerifier,
          candidateExternalId: String(input.installationId),
          pkceVerifier: input.pkceVerifier,
        })
        .where(eq(schema.organizationConnectionAttempts.id, attempt.id));
    });
  }

  async bindGitHub(input: BindGitHubConnectionInput): Promise<void> {
    await this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      await lockAccountSession(transaction, input.access);
      const attempt = await lockAttempt(transaction, input);
      await lockStoredAuthority(transaction, attempt);
      await lockProviderApplication(
        this.locks,
        runtimeTransaction,
        "github",
        input.providerApplicationId,
      );
      await requireCurrentAttempt(transaction, attempt, input.providerApplicationId);
      await lockExternal(this.locks, runtimeTransaction, "github", String(input.installationId));
      const [existing] = await transaction
        .select({
          id: schema.githubConnections.id,
          organizationId: schema.githubConnections.organizationId,
          slug: schema.githubConnections.slug,
        })
        .from(schema.githubConnections)
        .where(eq(schema.githubConnections.installationId, input.installationId))
        .for("update");
      if (existing !== undefined && existing.organizationId !== attempt.organizationId)
        throw new ConnectionConflictError();
      const [_connection] =
        existing === undefined
          ? await transaction
              .insert(schema.githubConnections)
              .values({
                organizationId: attempt.organizationId,
                installationId: input.installationId,
                providerApplicationId: input.providerApplicationId,
                slug: await uniqueConnectionSlug(
                  transaction,
                  attempt.organizationId,
                  "github",
                  input.accountLogin,
                ),
                accountId: input.accountId,
                accountLogin: input.accountLogin,
                accountType: input.accountType,
                status: input.status,
                connectedByUserId: attempt.userId,
                suspendedAt: input.status === "suspended" ? sql`clock_timestamp()` : null,
              })
              .returning({ id: schema.githubConnections.id })
          : await transaction
              .update(schema.githubConnections)
              .set({
                accountId: input.accountId,
                accountLogin: input.accountLogin,
                accountType: input.accountType,
                status: input.status,
                suspendedAt: input.status === "suspended" ? sql`clock_timestamp()` : null,
                updatedAt: sql`clock_timestamp()`,
              })
              .where(eq(schema.githubConnections.id, existing.id))
              .returning({ id: schema.githubConnections.id });
      await consumeLockedAttempt(transaction, attempt.id);
    });
  }

  async bindDiscord(input: BindDiscordConnectionInput): Promise<void> {
    await this.bindExclusive(input, "discord", input.guildId, async (transaction, attempt) => {
      const [_connection] = await transaction
        .insert(schema.discordConnections)
        .values({
          organizationId: attempt.organizationId,
          guildId: input.guildId,
          providerApplicationId: input.providerApplicationId,
          guildName: input.guildName,
          slug: await uniqueConnectionSlug(
            transaction,
            attempt.organizationId,
            "discord",
            input.guildName,
          ),
          connectedByUserId: attempt.userId,
        })
        .returning({ id: schema.discordConnections.id });
    });
  }

  async bindSlack(input: BindSlackConnectionInput): Promise<void> {
    await this.bindSlackTransition(input);
  }

  async completeSlackProviderApplication(
    input: CompleteSlackProviderApplicationInput,
  ): Promise<void> {
    await this.bindSlackTransition(input, input.providerConfiguration);
  }

  private async bindSlackTransition(
    input: BindSlackConnectionInput,
    providerConfiguration?: CompleteSlackProviderApplicationInput["providerConfiguration"],
  ): Promise<void> {
    await this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      await lockAccountSession(transaction, input.access);
      const attempt = await lockAttempt(transaction, input);
      await lockStoredAuthority(transaction, attempt);
      await lockProviderApplication(
        this.locks,
        runtimeTransaction,
        "slack",
        input.providerApplicationId,
      );
      if (providerConfiguration === undefined) {
        await requireCurrentAttempt(transaction, attempt, input.providerApplicationId);
      } else {
        await requireSlackActivationCandidate(
          transaction,
          attempt,
          input.providerApplicationId,
          providerConfiguration,
        );
      }
      await lockExternal(
        this.locks,
        runtimeTransaction,
        "slack",
        `${input.providerApplicationId}:${input.teamId}`,
      );
      const [existing] = await transaction
        .select({
          id: schema.slackConnections.id,
          organizationId: schema.slackConnections.organizationId,
        })
        .from(schema.slackConnections)
        .where(
          and(
            eq(schema.slackConnections.providerApplicationId, input.providerApplicationId),
            eq(schema.slackConnections.teamId, input.teamId),
          ),
        )
        .for("update");
      if (existing !== undefined && existing.organizationId !== attempt.organizationId) {
        throw new ConnectionConflictError();
      }
      if (existing === undefined) {
        await transaction.insert(schema.slackConnections).values({
          organizationId: attempt.organizationId,
          teamId: input.teamId,
          providerApplicationId: input.providerApplicationId,
          teamName: input.teamName,
          slug: await uniqueConnectionSlug(
            transaction,
            attempt.organizationId,
            "slack",
            input.teamName,
          ),
          botUserId: input.botUserId,
          credentialEnvelope: this.credentialCipher.encrypt(
            slackConnectionCredentialOwner(input.providerApplicationId, input.teamId),
            { botAccessToken: input.botAccessToken },
          ),
          scopes: input.scopes,
          connectedByUserId: attempt.userId,
        });
      } else {
        await transaction
          .update(schema.slackConnections)
          .set({
            teamName: input.teamName,
            providerApplicationId: input.providerApplicationId,
            botUserId: input.botUserId,
            credentialEnvelope: this.credentialCipher.encrypt(
              slackConnectionCredentialOwner(input.providerApplicationId, input.teamId),
              { botAccessToken: input.botAccessToken },
            ),
            scopes: input.scopes,
            connectedByUserId: attempt.userId,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(schema.slackConnections.id, existing.id));
      }
      if (providerConfiguration !== undefined) {
        const [stored] = await transaction
          .select({ version: schema.runtimeProviderConfiguration.version })
          .from(schema.runtimeProviderConfiguration)
          .where(
            and(
              eq(schema.runtimeProviderConfiguration.provider, "slack"),
              eq(
                schema.runtimeProviderConfiguration.providerApplicationId,
                input.providerApplicationId,
              ),
            ),
          )
          .for("update");
        if (stored?.version !== providerConfiguration.expectedVersion) {
          const error = new Error("provider configuration changed");
          error.name = "ProviderConfigurationConflictError";
          throw error;
        }
        if (stored === undefined) {
          await transaction.insert(schema.runtimeProviderConfiguration).values({
            provider: "slack",
            providerApplicationId: input.providerApplicationId,
            configurationEnvelope: this.credentialCipher.encrypt(
              providerApplicationCredentialOwner("slack", input.providerApplicationId),
              providerConfiguration.configuration,
            ),
            verifiedExternalIdentity: providerConfiguration.identity,
            version: 1,
            verifiedAt: sql`clock_timestamp()`,
            updatedAt: sql`clock_timestamp()`,
            updatedByUserId: providerConfiguration.updatedByUserId,
          });
        } else {
          await transaction
            .update(schema.runtimeProviderConfiguration)
            .set({
              configurationEnvelope: this.credentialCipher.encrypt(
                providerApplicationCredentialOwner("slack", input.providerApplicationId),
                providerConfiguration.configuration,
              ),
              verifiedExternalIdentity: providerConfiguration.identity,
              version: sql`${schema.runtimeProviderConfiguration.version} + 1`,
              verifiedAt: sql`clock_timestamp()`,
              updatedAt: sql`clock_timestamp()`,
              updatedByUserId: providerConfiguration.updatedByUserId,
            })
            .where(
              and(
                eq(schema.runtimeProviderConfiguration.provider, "slack"),
                eq(
                  schema.runtimeProviderConfiguration.providerApplicationId,
                  input.providerApplicationId,
                ),
              ),
            );
        }
        await writeProviderActivation(
          transaction,
          "slack",
          input.providerApplicationId,
          attempt.configurationVersion,
        );
      }
      await consumeLockedAttempt(transaction, attempt.id);
    });
  }

  async bindLinear(input: BindLinearConnectionInput): Promise<void> {
    await this.bindLinearTransition(input);
  }

  async completeLinearProviderApplication(
    input: CompleteLinearProviderApplicationInput,
  ): Promise<void> {
    await this.bindLinearTransition(input, input.providerConfiguration);
  }

  private async bindLinearTransition(
    input: BindLinearConnectionInput,
    providerConfiguration?: CompleteLinearProviderApplicationInput["providerConfiguration"],
  ): Promise<void> {
    await this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      await lockAccountSession(transaction, input.access);
      const attempt = await lockAttempt(transaction, input);
      await lockStoredAuthority(transaction, attempt);
      await lockProviderApplication(
        this.locks,
        runtimeTransaction,
        "linear",
        input.providerApplicationId,
      );
      if (providerConfiguration === undefined) {
        await requireCurrentAttempt(transaction, attempt, input.providerApplicationId);
      } else {
        await requireLinearActivationCandidate(
          transaction,
          attempt,
          input.providerApplicationId,
          providerConfiguration,
        );
      }
      await lockExternal(this.locks, runtimeTransaction, "linear", input.linearOrganizationId);
      const [existing] = await transaction
        .select({
          id: schema.linearConnections.id,
          organizationId: schema.linearConnections.organizationId,
        })
        .from(schema.linearConnections)
        .where(eq(schema.linearConnections.linearOrganizationId, input.linearOrganizationId))
        .for("update");
      if (existing !== undefined && existing.organizationId !== attempt.organizationId) {
        throw new ConnectionConflictError();
      }
      if (existing === undefined) {
        await transaction.insert(schema.linearConnections).values({
          organizationId: attempt.organizationId,
          providerApplicationId: input.providerApplicationId,
          linearOrganizationId: input.linearOrganizationId,
          linearOrganizationName: input.linearOrganizationName,
          slug: await uniqueConnectionSlug(
            transaction,
            attempt.organizationId,
            "linear",
            input.linearOrganizationName,
          ),
          appUserId: input.appUserId,
          credentialEnvelope: this.credentialCipher.encrypt(
            linearConnectionCredentialOwner(
              input.providerApplicationId,
              input.linearOrganizationId,
            ),
            {
              accessToken: input.accessToken,
              refreshToken: input.refreshToken ?? null,
            },
          ),
          refreshTokenAvailable: input.refreshToken !== undefined && input.refreshToken !== null,
          accessTokenExpiresAt: input.accessTokenExpiresAt ?? null,
          scopes: input.scopes,
          connectedByUserId: attempt.userId,
        });
      } else {
        await transaction
          .update(schema.linearConnections)
          .set({
            providerApplicationId: input.providerApplicationId,
            linearOrganizationName: input.linearOrganizationName,
            appUserId: input.appUserId,
            credentialEnvelope: this.credentialCipher.encrypt(
              linearConnectionCredentialOwner(
                input.providerApplicationId,
                input.linearOrganizationId,
              ),
              {
                accessToken: input.accessToken,
                refreshToken: input.refreshToken ?? null,
              },
            ),
            refreshTokenAvailable: input.refreshToken !== undefined && input.refreshToken !== null,
            accessTokenExpiresAt: input.accessTokenExpiresAt ?? null,
            scopes: input.scopes,
            connectedByUserId: attempt.userId,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(schema.linearConnections.id, existing.id));
      }
      if (providerConfiguration !== undefined) {
        const [stored] = await transaction
          .select({ version: schema.runtimeProviderConfiguration.version })
          .from(schema.runtimeProviderConfiguration)
          .where(
            and(
              eq(schema.runtimeProviderConfiguration.provider, "linear"),
              eq(
                schema.runtimeProviderConfiguration.providerApplicationId,
                input.providerApplicationId,
              ),
            ),
          )
          .for("update");
        if (stored?.version !== providerConfiguration.expectedVersion) {
          const error = new Error("provider configuration changed");
          error.name = "ProviderConfigurationConflictError";
          throw error;
        }
        if (stored === undefined) {
          await transaction.insert(schema.runtimeProviderConfiguration).values({
            provider: "linear",
            providerApplicationId: input.providerApplicationId,
            configurationEnvelope: this.credentialCipher.encrypt(
              providerApplicationCredentialOwner("linear", input.providerApplicationId),
              providerConfiguration.configuration,
            ),
            verifiedExternalIdentity: providerConfiguration.identity,
            version: 1,
            verifiedAt: sql`clock_timestamp()`,
            updatedAt: sql`clock_timestamp()`,
            updatedByUserId: providerConfiguration.updatedByUserId,
          });
        } else {
          await transaction
            .update(schema.runtimeProviderConfiguration)
            .set({
              configurationEnvelope: this.credentialCipher.encrypt(
                providerApplicationCredentialOwner("linear", input.providerApplicationId),
                providerConfiguration.configuration,
              ),
              verifiedExternalIdentity: providerConfiguration.identity,
              version: sql`${schema.runtimeProviderConfiguration.version} + 1`,
              verifiedAt: sql`clock_timestamp()`,
              updatedAt: sql`clock_timestamp()`,
              updatedByUserId: providerConfiguration.updatedByUserId,
            })
            .where(
              and(
                eq(schema.runtimeProviderConfiguration.provider, "linear"),
                eq(
                  schema.runtimeProviderConfiguration.providerApplicationId,
                  input.providerApplicationId,
                ),
              ),
            );
        }
        await writeProviderActivation(
          transaction,
          "linear",
          input.providerApplicationId,
          attempt.configurationVersion,
        );
      }
      await consumeLockedAttempt(transaction, attempt.id);
    });
  }

  async updateLinearTokens(input: UpdateLinearConnectionTokensInput): Promise<void> {
    await this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      const [row] = await transaction
        .select()
        .from(schema.linearConnections)
        .where(eq(schema.linearConnections.id, input.connectionId))
        .for("update");
      if (row === undefined || row.providerApplicationId === null) {
        throw new Error("Linear connection unavailable");
      }
      const current = linearConnection(this.credentialCipher, row);
      await transaction
        .update(schema.linearConnections)
        .set({
          credentialEnvelope: this.credentialCipher.encrypt(
            linearConnectionCredentialOwner(row.providerApplicationId, row.linearOrganizationId),
            {
              accessToken: input.accessToken,
              refreshToken:
                input.refreshToken === undefined ? current.refreshToken : input.refreshToken,
            },
          ),
          refreshTokenAvailable:
            input.refreshToken === undefined
              ? current.refreshToken !== null
              : input.refreshToken !== null,
          ...(input.accessTokenExpiresAt === undefined
            ? {}
            : { accessTokenExpiresAt: input.accessTokenExpiresAt }),
          ...(input.scopes === undefined ? {} : { scopes: input.scopes }),
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(schema.linearConnections.id, input.connectionId));
    });
  }

  async withLinearRefresh<T>(
    linearOrganizationId: string,
    operation: LinearConnectionRefreshOperation<T>,
  ): Promise<T> {
    return this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      // This is intentionally the same transaction-scoped identity lock as OAuth rebind. In
      // particular, do not use the session-lock API here: the re-read and write below must share
      // this transaction's client so waiters cannot starve the lock holder's pool query.
      await lockExternal(this.locks, runtimeTransaction, "linear", linearOrganizationId);
      const [row] = await transaction
        .select()
        .from(schema.linearConnections)
        .where(eq(schema.linearConnections.linearOrganizationId, linearOrganizationId))
        .for("update");
      const connection =
        row === undefined ? undefined : linearConnection(this.credentialCipher, row);
      return operation(connection, async (input) => {
        if (connection === undefined) throw new Error("Linear connection unavailable");
        await transaction
          .update(schema.linearConnections)
          .set({
            credentialEnvelope: this.credentialCipher.encrypt(
              linearConnectionCredentialOwner(
                connection.providerApplicationId!,
                connection.linearOrganizationId,
              ),
              {
                accessToken: input.accessToken,
                refreshToken:
                  input.refreshToken === undefined ? connection.refreshToken : input.refreshToken,
              },
            ),
            refreshTokenAvailable:
              input.refreshToken === undefined
                ? connection.refreshToken !== null
                : input.refreshToken !== null,
            ...(input.accessTokenExpiresAt === undefined
              ? {}
              : { accessTokenExpiresAt: input.accessTokenExpiresAt }),
            ...(input.scopes === undefined ? {} : { scopes: input.scopes }),
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(schema.linearConnections.id, connection.id));
      });
    });
  }

  private async bindExclusive(
    input: BindDiscordConnectionInput,
    provider: "discord" | "slack",
    externalId: string,
    insert: (transaction: HubTransaction, attempt: AttemptRow) => Promise<void>,
  ): Promise<void> {
    await this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      await lockAccountSession(transaction, input.access);
      const attempt = await lockAttempt(transaction, input);
      await lockStoredAuthority(transaction, attempt);
      await lockProviderApplication(
        this.locks,
        runtimeTransaction,
        provider,
        input.providerApplicationId,
      );
      await requireCurrentAttempt(transaction, attempt, input.providerApplicationId);
      await lockExternal(this.locks, runtimeTransaction, provider, externalId);
      const conflict =
        provider === "discord"
          ? await transaction
              .select({ id: schema.discordConnections.id })
              .from(schema.discordConnections)
              .where(eq(schema.discordConnections.guildId, externalId))
              .limit(1)
          : await transaction
              .select({ id: schema.slackConnections.id })
              .from(schema.slackConnections)
              .where(eq(schema.slackConnections.teamId, externalId))
              .limit(1);
      if (conflict.length > 0) throw new ConnectionConflictError();
      await insert(transaction, attempt);
      await consumeLockedAttempt(transaction, attempt.id);
    });
  }

  async findGitHub(installationId: number): Promise<GitHubConnectionRecord | undefined> {
    const [row] = await this.database
      .select()
      .from(schema.githubConnections)
      .where(eq(schema.githubConnections.installationId, installationId))
      .limit(1);
    return row === undefined ? undefined : githubConnection(row);
  }

  async removeGitHubByInstallationInTransaction(
    transaction: HubTransaction,
    installationId: number,
  ): Promise<void> {
    const [connection] = await transaction
      .select({ id: schema.githubConnections.id })
      .from(schema.githubConnections)
      .where(eq(schema.githubConnections.installationId, installationId))
      .for("update");
    if (connection === undefined) return;
    await clearGitHubConnectionReferences(transaction, connection.id);
    await transaction
      .delete(schema.githubConnections)
      .where(eq(schema.githubConnections.id, connection.id));
  }

  async disconnect(
    provider: ConnectionProvider,
    connectionId: string,
    access: ConnectionStartAuthority,
  ) {
    return this.runtime.transaction(async (runtimeTransaction) => {
      const transaction = runtimeTransaction.drizzle();
      await lockStartAuthority(transaction, access);
      if (provider === "github") {
        const [connection] = await transaction
          .select({ id: schema.githubConnections.id })
          .from(schema.githubConnections)
          .where(
            and(
              eq(schema.githubConnections.id, connectionId),
              eq(schema.githubConnections.organizationId, access.organizationId),
            ),
          )
          .for("update");
        if (connection === undefined) throw new ConnectionAccessDeniedError();
        await clearGitHubConnectionReferences(transaction, connectionId);
        await transaction
          .delete(schema.githubConnections)
          .where(eq(schema.githubConnections.id, connectionId));
        return { provider } as const;
      }
      if (provider === "discord") {
        const [connection] = await transaction
          .select({ guildId: schema.discordConnections.guildId })
          .from(schema.discordConnections)
          .where(
            and(
              eq(schema.discordConnections.id, connectionId),
              eq(schema.discordConnections.organizationId, access.organizationId),
            ),
          )
          .for("update");
        if (connection === undefined) throw new ConnectionAccessDeniedError();
        await transaction
          .delete(schema.projectTriggerRoutes)
          .where(eq(schema.projectTriggerRoutes.connectionId, connectionId));
        await transaction
          .delete(schema.discordConnections)
          .where(eq(schema.discordConnections.id, connectionId));
        return {
          provider,
          guildId: connection.guildId,
        } as const;
      }
      if (provider === "linear") {
        const [connection] = await transaction
          .select({
            linearOrganizationId: schema.linearConnections.linearOrganizationId,
            credentialEnvelope: schema.linearConnections.credentialEnvelope,
            providerApplicationId: schema.linearConnections.providerApplicationId,
          })
          .from(schema.linearConnections)
          .where(
            and(
              eq(schema.linearConnections.id, connectionId),
              eq(schema.linearConnections.organizationId, access.organizationId),
            ),
          )
          .for("update");
        if (connection === undefined) throw new ConnectionAccessDeniedError();
        await transaction
          .delete(schema.projectTriggerRoutes)
          .where(eq(schema.projectTriggerRoutes.connectionId, connectionId));
        await transaction
          .delete(schema.linearConnections)
          .where(eq(schema.linearConnections.id, connectionId));
        return {
          provider,
          linearOrganizationId: connection.linearOrganizationId,
          accessToken:
            connection.providerApplicationId === null
              ? undefined
              : requireLinearConnectionCredential(
                  this.credentialCipher.decrypt(
                    linearConnectionCredentialOwner(
                      connection.providerApplicationId,
                      connection.linearOrganizationId,
                    ),
                    connection.credentialEnvelope,
                  ),
                ).accessToken,
        } as const;
      }
      const [connection] = await transaction
        .select({
          teamId: schema.slackConnections.teamId,
          credentialEnvelope: schema.slackConnections.credentialEnvelope,
          providerApplicationId: schema.slackConnections.providerApplicationId,
        })
        .from(schema.slackConnections)
        .where(
          and(
            eq(schema.slackConnections.id, connectionId),
            eq(schema.slackConnections.organizationId, access.organizationId),
          ),
        )
        .for("update");
      if (connection === undefined) throw new ConnectionAccessDeniedError();
      await transaction
        .delete(schema.projectTriggerRoutes)
        .where(eq(schema.projectTriggerRoutes.connectionId, connectionId));
      await transaction
        .delete(schema.slackConnections)
        .where(eq(schema.slackConnections.id, connectionId));
      return {
        provider,
        teamId: connection.teamId,
        botAccessToken: requireSlackConnectionCredential(
          this.credentialCipher.decrypt(
            slackConnectionCredentialOwner(connection.providerApplicationId, connection.teamId),
            connection.credentialEnvelope,
          ),
        ).botAccessToken,
      } as const;
    });
  }

  async findDiscord(guildId: string): Promise<DiscordConnectionRecord | undefined> {
    const [row] = await this.database
      .select()
      .from(schema.discordConnections)
      .where(eq(schema.discordConnections.guildId, guildId))
      .limit(1);
    return row === undefined ? undefined : discordConnection(row);
  }

  async findDiscordForOrganization(
    organizationId: string,
    guildId: string,
  ): Promise<DiscordConnectionRecord | undefined> {
    const [row] = await this.database
      .select()
      .from(schema.discordConnections)
      .where(
        and(
          eq(schema.discordConnections.organizationId, organizationId),
          eq(schema.discordConnections.guildId, guildId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : discordConnection(row);
  }

  async findSlack(
    providerApplicationId: string,
    teamId: string,
  ): Promise<SlackConnectionRecord | undefined> {
    const [row] = await this.database
      .select()
      .from(schema.slackConnections)
      .where(
        and(
          eq(schema.slackConnections.providerApplicationId, providerApplicationId),
          eq(schema.slackConnections.teamId, teamId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : slackConnection(this.credentialCipher, row);
  }

  async findSlackForOrganization(
    organizationId: string,
    providerApplicationId: string,
    teamId: string,
  ): Promise<SlackConnectionRecord | undefined> {
    const [row] = await this.database
      .select()
      .from(schema.slackConnections)
      .where(
        and(
          eq(schema.slackConnections.organizationId, organizationId),
          eq(schema.slackConnections.providerApplicationId, providerApplicationId),
          eq(schema.slackConnections.teamId, teamId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : slackConnection(this.credentialCipher, row);
  }

  async findSlackByIdForOrganization(
    organizationId: string,
    connectionId: string,
  ): Promise<SlackConnectionRecord | undefined> {
    const [row] = await this.database
      .select()
      .from(schema.slackConnections)
      .where(
        and(
          eq(schema.slackConnections.organizationId, organizationId),
          eq(schema.slackConnections.id, connectionId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : slackConnection(this.credentialCipher, row);
  }

  async findLinear(linearOrganizationId: string): Promise<LinearConnectionRecord | undefined> {
    const [row] = await this.database
      .select()
      .from(schema.linearConnections)
      .where(eq(schema.linearConnections.linearOrganizationId, linearOrganizationId))
      .limit(1);
    return row === undefined ? undefined : linearConnection(this.credentialCipher, row);
  }

  async findLinearForOrganization(
    organizationId: string,
    linearOrganizationId: string,
  ): Promise<LinearConnectionRecord | undefined> {
    const [row] = await this.database
      .select()
      .from(schema.linearConnections)
      .where(
        and(
          eq(schema.linearConnections.organizationId, organizationId),
          eq(schema.linearConnections.linearOrganizationId, linearOrganizationId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : linearConnection(this.credentialCipher, row);
  }

  async removeDiscord(guildId: string): Promise<void> {
    await this.database
      .delete(schema.discordConnections)
      .where(eq(schema.discordConnections.guildId, guildId));
  }
}

async function clearGitHubConnectionReferences(
  transaction: HubTransaction,
  connectionId: string,
): Promise<void> {
  await transaction
    .update(schema.projectConfigurationSources)
    .set({
      kind: "manual",
      githubConnectionId: null,
      githubRepositoryId: null,
      githubRepositoryFullName: null,
      githubDefaultBranch: null,
      automaticDeploymentEnabled: false,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(eq(schema.projectConfigurationSources.githubConnectionId, connectionId));
  await transaction
    .delete(schema.projectTriggerRoutes)
    .where(eq(schema.projectTriggerRoutes.connectionId, connectionId));
  await transaction
    .update(schema.configurationSyncAttempts)
    .set({ githubConnectionId: null })
    .where(eq(schema.configurationSyncAttempts.githubConnectionId, connectionId));
}

function orExpiredOrConsumed() {
  return sql`${schema.organizationConnectionAttempts.expiresAt} <= clock_timestamp() or ${schema.organizationConnectionAttempts.consumedAt} is not null`;
}

async function lockAttempt(
  transaction: HubTransaction,
  input: ReadConnectionAttemptInput,
): Promise<AttemptRow> {
  const [attempt] = await transaction
    .select()
    .from(schema.organizationConnectionAttempts)
    .where(
      and(
        eq(schema.organizationConnectionAttempts.stateVerifier, input.stateVerifier),
        eq(schema.organizationConnectionAttempts.phase, input.phase),
        isNull(schema.organizationConnectionAttempts.consumedAt),
      ),
    )
    .for("update");
  if (
    attempt === undefined ||
    (await expiredAtDatabaseClock(transaction, attempt.expiresAt)) ||
    attempt.userId !== input.access.userId ||
    attempt.sessionId !== input.access.sessionId
  )
    throw new ConnectionAttemptUnavailableError();
  return attempt;
}

async function lockAccountSession(
  transaction: HubTransaction,
  access: ConnectionAccountAccess,
): Promise<void> {
  const [session] = await transaction
    .select({
      userId: schema.sessions.userId,
      expiresAt: schema.sessions.expiresAt,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, access.sessionId))
    .for("update");
  if (
    session?.userId !== access.userId ||
    (await expiredAtDatabaseClock(transaction, session.expiresAt))
  )
    throw new ConnectionAccessDeniedError();
}

async function lockStartAuthority(
  transaction: HubTransaction,
  access: ConnectionStartAuthority,
): Promise<void> {
  await lockAccountSession(transaction, access);
  const [membership] = await transaction
    .select({ role: schema.members.role })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.id, access.membershipId),
        eq(schema.members.userId, access.userId),
        eq(schema.members.organizationId, access.organizationId),
        inArray(schema.members.role, ["owner", "admin"]),
      ),
    )
    .for("update");
  if (membership === undefined) throw new ConnectionAccessDeniedError();
}

async function lockStoredAuthority(
  transaction: HubTransaction,
  attempt: AttemptRow,
): Promise<void> {
  const [membership] = await transaction
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.userId, attempt.userId),
        eq(schema.members.organizationId, attempt.organizationId),
        inArray(schema.members.role, ["owner", "admin"]),
      ),
    )
    .for("update");
  if (membership === undefined) throw new ConnectionAccessDeniedError();
}

async function expiredAtDatabaseClock(
  transaction: HubTransaction,
  expiresAt: Date,
): Promise<boolean> {
  const clock = await transaction.execute<{ expired: boolean }>(
    sql`select ${expiresAt}::timestamptz <= clock_timestamp() as expired`,
  );
  return clock.rows[0]?.expired ?? true;
}

async function lockExternal(
  locks: Locks,
  transaction: TransactionHandle,
  provider: ConnectionProvider,
  externalId: string,
): Promise<void> {
  await locks.withTxLock(
    transaction,
    JSON.stringify(["paseo-connection", provider, "external", externalId]),
  );
}

async function lockProviderApplication(
  locks: Locks,
  transaction: TransactionHandle,
  provider: ConnectionProvider,
  applicationId: string,
): Promise<void> {
  await locks.withTxLock(
    transaction,
    JSON.stringify(["provider-application", provider, applicationId]),
  );
}

async function requireCurrentAttempt(
  transaction: HubTransaction,
  attempt: AttemptRow,
  bindingApplicationId?: string,
): Promise<void> {
  const applicationId = attempt.providerApplicationId;
  if (
    applicationId === null ||
    (bindingApplicationId !== undefined && applicationId !== bindingApplicationId)
  ) {
    throw providerApplicationChanged();
  }
  const [activation] = await transaction
    .select({
      applicationId: schema.runtimeProviderActivations.providerApplicationId,
      configurationVersion: schema.runtimeProviderActivations.configurationVersion,
    })
    .from(schema.runtimeProviderActivations)
    .where(
      and(
        eq(schema.runtimeProviderActivations.provider, attempt.provider),
        eq(schema.runtimeProviderActivations.providerApplicationId, applicationId),
      ),
    )
    .for("update");
  if (
    activation?.applicationId !== applicationId ||
    activation?.configurationVersion !== attempt.configurationVersion
  ) {
    throw providerApplicationChanged();
  }
}

async function requireConsumableAttempt(
  transaction: HubTransaction,
  attempt: AttemptRow,
): Promise<void> {
  if (!attempt.activateConfiguration) {
    await requireCurrentAttempt(transaction, attempt);
    return;
  }
  if (attempt.provider !== "slack" && attempt.provider !== "linear") {
    throw providerApplicationChanged();
  }
  const provider = attempt.provider;
  const applicationId = requireAttemptApplicationId(attempt);
  const [stored] = await transaction
    .select({
      version: schema.runtimeProviderConfiguration.version,
      identity: schema.runtimeProviderConfiguration.verifiedExternalIdentity,
    })
    .from(schema.runtimeProviderConfiguration)
    .where(
      and(
        eq(schema.runtimeProviderConfiguration.provider, provider),
        eq(schema.runtimeProviderConfiguration.providerApplicationId, applicationId),
      ),
    )
    .for("update");
  const [activation] = await transaction
    .select({
      applicationId: schema.runtimeProviderActivations.providerApplicationId,
      configurationVersion: schema.runtimeProviderActivations.configurationVersion,
    })
    .from(schema.runtimeProviderActivations)
    .where(
      and(
        eq(schema.runtimeProviderActivations.provider, provider),
        eq(schema.runtimeProviderActivations.providerApplicationId, applicationId),
      ),
    )
    .for("update");
  if (stored?.version !== (attempt.expectedConfigurationVersion ?? undefined)) {
    throw providerApplicationChanged();
  }
  if (stored === undefined) {
    if (activation !== undefined) throw providerApplicationChanged();
    return;
  }
  if (
    activation?.applicationId !== externalIdentityId(stored.identity) ||
    activation?.configurationVersion !== stored.version
  ) {
    throw providerApplicationChanged();
  }
}

async function requireSlackActivationCandidate(
  transaction: HubTransaction,
  attempt: AttemptRow,
  bindingApplicationId: string,
  providerConfiguration: CompleteSlackProviderApplicationInput["providerConfiguration"],
): Promise<void> {
  await requireConsumableAttempt(transaction, attempt);
  if (
    attempt.providerApplicationId !== bindingApplicationId ||
    externalIdentityId(providerConfiguration.identity) !== bindingApplicationId ||
    attempt.configurationVersion !== (providerConfiguration.expectedVersion ?? 0) + 1
  ) {
    throw providerApplicationChanged();
  }
}

async function requireLinearActivationCandidate(
  transaction: HubTransaction,
  attempt: AttemptRow,
  bindingApplicationId: string,
  providerConfiguration: CompleteLinearProviderApplicationInput["providerConfiguration"],
): Promise<void> {
  await requireConsumableAttempt(transaction, attempt);
  if (
    attempt.providerApplicationId !== bindingApplicationId ||
    externalIdentityId(providerConfiguration.identity) !== bindingApplicationId ||
    attempt.configurationVersion !== (providerConfiguration.expectedVersion ?? 0) + 1
  ) {
    throw providerApplicationChanged();
  }
}

async function writeProviderActivation(
  transaction: HubTransaction,
  provider: ConnectionProvider,
  applicationId: string,
  configurationVersion: number,
): Promise<void> {
  await transaction
    .insert(schema.runtimeProviderActivations)
    .values({ provider, providerApplicationId: applicationId, configurationVersion })
    .onConflictDoUpdate({
      target: [
        schema.runtimeProviderActivations.provider,
        schema.runtimeProviderActivations.providerApplicationId,
      ],
      set: {
        configurationVersion,
        activatedAt: sql`clock_timestamp()`,
      },
    });
}

function requireAttemptApplicationId(attempt: AttemptRow): string {
  if (attempt.providerApplicationId === null) throw providerApplicationChanged();
  return attempt.providerApplicationId;
}

function externalIdentityId(value: unknown): string | undefined {
  return value !== null && typeof value === "object" && typeof Reflect.get(value, "id") === "string"
    ? String(Reflect.get(value, "id"))
    : undefined;
}

function providerApplicationChanged(): Error {
  const error = new Error("provider application changed");
  error.name = "ProviderApplicationChangedError";
  return error;
}

async function consumeLockedAttempt(transaction: HubTransaction, attemptId: string): Promise<void> {
  await transaction
    .update(schema.organizationConnectionAttempts)
    .set({ consumedAt: sql`clock_timestamp()`, pkceVerifier: null })
    .where(eq(schema.organizationConnectionAttempts.id, attemptId));
}

function initialConnectionAttemptPhase(provider: ConnectionProvider): ConnectionAttemptPhase {
  if (provider === "github") return "github_setup";
  if (provider === "discord") return "discord_authorization";
  return provider === "slack" ? "slack_authorization" : "linear_authorization";
}

function toAttempt(credentialCipher: CredentialCipher, row: AttemptRow): ConnectionAttemptRecord {
  if (row.providerApplicationId === null) throw new Error("connection attempt has no application");
  return {
    id: row.id,
    provider: row.provider,
    phase: row.phase,
    organizationId: row.organizationId,
    returnRoute: row.returnRoute,
    userId: row.userId,
    sessionId: row.sessionId,
    candidateExternalId: row.candidateExternalId,
    pkceVerifier: row.pkceVerifier,
    configurationVersion: row.configurationVersion,
    providerApplicationId: row.providerApplicationId,
    callbackOrigin: row.callbackOrigin,
    configurationSnapshot: credentialCipher.decrypt(
      connectionAttemptCredentialOwner(row),
      row.configurationEnvelope,
    ),
    expectedConfigurationVersion: row.expectedConfigurationVersion,
    activateConfiguration: row.activateConfiguration,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
  };
}

function githubConnection(
  row: typeof schema.githubConnections.$inferSelect,
): GitHubConnectionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    installationId: row.installationId,
    accountId: row.accountId,
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    status: row.status,
    providerApplicationId: row.providerApplicationId,
  };
}
function discordConnection(
  row: typeof schema.discordConnections.$inferSelect,
): DiscordConnectionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    guildId: row.guildId,
    guildName: row.guildName,
    providerApplicationId: row.providerApplicationId,
  };
}
function slackConnection(
  credentialCipher: CredentialCipher,
  row: typeof schema.slackConnections.$inferSelect,
): SlackConnectionRecord {
  const credentials = requireSlackConnectionCredential(
    credentialCipher.decrypt(
      slackConnectionCredentialOwner(row.providerApplicationId, row.teamId),
      row.credentialEnvelope,
    ),
  );

  return {
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    teamId: row.teamId,
    teamName: row.teamName,
    botUserId: row.botUserId,
    botAccessToken: credentials.botAccessToken,
    scopes: row.scopes,
    providerApplicationId: row.providerApplicationId,
  };
}

function requireSlackConnectionCredential(value: unknown): { botAccessToken: string } {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof Reflect.get(value, "botAccessToken") !== "string"
  ) {
    throw new Error("Slack connection credential envelope is malformed");
  }
  return { botAccessToken: String(Reflect.get(value, "botAccessToken")) };
}
function linearConnection(
  credentialCipher: CredentialCipher,
  row: typeof schema.linearConnections.$inferSelect,
): LinearConnectionRecord {
  if (row.providerApplicationId === null) throw new Error("Linear connection has no application");
  const credentials = requireLinearConnectionCredential(
    credentialCipher.decrypt(
      linearConnectionCredentialOwner(row.providerApplicationId, row.linearOrganizationId),
      row.credentialEnvelope,
    ),
  );

  return {
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    providerApplicationId: row.providerApplicationId,
    linearOrganizationId: row.linearOrganizationId,
    linearOrganizationName: row.linearOrganizationName,
    appUserId: row.appUserId,
    accessToken: credentials.accessToken,
    refreshToken: credentials.refreshToken,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    scopes: row.scopes,
  };
}

function requireLinearConnectionCredential(credentials: unknown): {
  accessToken: string;
  refreshToken: string | null;
} {
  const accessToken: unknown =
    credentials === null || typeof credentials !== "object"
      ? undefined
      : Reflect.get(credentials, "accessToken");
  const refreshToken: unknown =
    credentials === null || typeof credentials !== "object"
      ? undefined
      : Reflect.get(credentials, "refreshToken");
  if (
    typeof accessToken !== "string" ||
    (refreshToken !== null && typeof refreshToken !== "string")
  ) {
    throw new Error("Linear connection credential envelope is malformed");
  }
  return { accessToken, refreshToken };
}

function providerApplicationCredentialOwner(
  provider: ConnectionProvider,
  applicationId: string,
): string {
  return `provider-application:${provider}:${applicationId}`;
}

function connectionAttemptCredentialOwner(input: {
  provider: ConnectionProvider;
  providerApplicationId: string | null;
  configurationVersion: number;
}): string {
  if (input.providerApplicationId === null)
    throw new Error("connection attempt has no application");
  return `connection-attempt:${input.provider}:${input.providerApplicationId}:${input.configurationVersion}`;
}

function slackConnectionCredentialOwner(applicationId: string, teamId: string): string {
  return `slack-connection:${applicationId}:${teamId}`;
}

function linearConnectionCredentialOwner(
  applicationId: string,
  linearOrganizationId: string,
): string {
  return `linear-connection:${applicationId}:${linearOrganizationId}`;
}

async function uniqueConnectionSlug(
  transaction: HubTransaction,
  organizationId: string,
  provider: ConnectionProvider,
  identity: string,
): Promise<string> {
  const base = `${slugify(identity, "connection")}-${provider}`;
  const rows = await transaction.execute<{ slug: string }>(sql`
    select slug from (
      select slug from github_connections where organization_id = ${organizationId}
      union all
      select slug from slack_connections where organization_id = ${organizationId}
      union all
      select slug from discord_connections where organization_id = ${organizationId}
      union all
      select slug from linear_connections where organization_id = ${organizationId}
    ) slugs
    where slug = ${base} or slug like ${`${base}-%`}
    order by slug
  `);
  const used = new Set(rows.rows.map((row) => row.slug));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
