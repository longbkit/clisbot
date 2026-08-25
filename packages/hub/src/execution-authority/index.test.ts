import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { CompiledGitHubAuthority } from "../config/github-authority.js";
import type { CreateExecutionAuthorityOptions, ExecutionAuthorityClock } from "./index.js";
import { createExecutionAuthority as createProductionExecutionAuthority } from "./index.js";
import { createLogger } from "../logger.js";
import { assertOneFailure, FailureLogStream } from "../test-utils/failure-logs.js";

function createExecutionAuthority(
  options: Omit<CreateExecutionAuthorityOptions, "isExecutionActive"> &
    Partial<Pick<CreateExecutionAuthorityOptions, "isExecutionActive">>,
) {
  return createProductionExecutionAuthority({
    ...options,
    isExecutionActive: options.isExecutionActive ?? (async () => true),
  });
}

describe("Hub execution authority", () => {
  it.each(["discord", "slack", "github", "manual"] as const)(
    "resolves explicit connection templates for the %s trigger source without automatic GitHub authority",
    async (provider) => {
      const connectionRevocations: string[] = [];
      const authority = createExecutionAuthority({
        connectionsForProject: () => async (slug, value, context) => {
          await context?.registerToken?.(`${slug}-${value}`, async () => {
            connectionRevocations.push(`${slug}-${value}`);
          });
          return "resolved-secret";
        },
        githubAuthority: githubAuthorityFake(),
      });
      const authoredEnv = {
        SOME_TOKEN: "prefix-${{ paseo.connections.some-connection.token }}",
        SAME_TOKEN: "${{ paseo.connections.some-connection.token }}",
      };

      const launch = await authority.materialize({
        executionId: "execution-discord",
        projectId: "project-1",
        triggerContext: { provider },
        env: authoredEnv,
      });

      assert.deepEqual(launch.env, {
        SOME_TOKEN: "prefix-resolved-secret",
        SAME_TOKEN: "resolved-secret",
      });
      const launchEnv = launch.env as Record<string, string>;
      assert.equal(launchEnv["GH_TOKEN"], undefined);
      assert.equal(launchEnv["GIT_CONFIG_COUNT"], undefined);
      assert.deepEqual(authoredEnv, {
        SOME_TOKEN: "prefix-${{ paseo.connections.some-connection.token }}",
        SAME_TOKEN: "${{ paseo.connections.some-connection.token }}",
      });
      await authority.onExecutionTerminal("execution-discord");
      assert.deepEqual(connectionRevocations, ["some-connection-token"]);
    },
  );

  it("mints only explicit scoped GitHub authority and installs ordinary Git environment", async () => {
    const mint = githubAuthorityFake();
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      githubAuthority: mint,
    });
    const github: CompiledGitHubAuthority = {
      connection: "getpaseo-github",
      repositories: ["getpaseo/paseo", "getpaseo/hub"],
      permissions: { contents: "write", pull_requests: "write", issues: "read" },
      durationMs: 30 * 60 * 1000,
    };

    const launch = await authority.materialize({
      executionId: "execution-manual",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      github,
    });

    assert.deepEqual(mint.inputs, [
      {
        executionId: "execution-manual",
        projectId: "project-1",
        connectionSlug: "getpaseo-github",
        repositories: ["getpaseo/paseo", "getpaseo/hub"],
        permissions: { contents: "write", pull_requests: "write", issues: "read" },
      },
    ]);
    assert.deepEqual(launch.env, {
      GH_TOKEN: "scoped-token-1",
      GIT_CONFIG_COUNT: "5",
      GIT_CONFIG_KEY_0: "user.name",
      GIT_CONFIG_VALUE_0: "paseo[bot]",
      GIT_CONFIG_KEY_1: "user.email",
      GIT_CONFIG_VALUE_1: "9876+paseo[bot]@users.noreply.github.com",
      GIT_CONFIG_KEY_2: "url.https://github.com/.insteadOf",
      GIT_CONFIG_VALUE_2: "git@github.com:",
      GIT_CONFIG_KEY_3: "url.https://github.com/.insteadOf",
      GIT_CONFIG_VALUE_3: "ssh://git@github.com/",
      GIT_CONFIG_KEY_4: "credential.https://github.com.helper",
      GIT_CONFIG_VALUE_4: "!gh auth git-credential",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    });
  });

  it("defaults an omitted repository list to only the GitHub event repository", async () => {
    const mint = githubAuthorityFake();
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      githubAuthority: mint,
    });

    await authority.materialize({
      executionId: "execution-github",
      projectId: "project-1",
      triggerContext: {
        provider: "github",
        target: { repository: "getpaseo/paseo" },
      },
      github: {
        connection: "getpaseo-github",
        permissions: { contents: "read" },
        durationMs: 60 * 60 * 1000,
      },
    });

    assert.deepEqual(mint.inputs[0]?.repositories, ["getpaseo/paseo"]);
  });

  it("rejects an omitted repository list when no safe event repository exists", async () => {
    const mint = githubAuthorityFake();
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      githubAuthority: mint,
    });

    await assert.rejects(
      authority.materialize({
        executionId: "execution-manual-missing-repo",
        projectId: "project-1",
        triggerContext: { provider: "manual" },
        github: {
          connection: "getpaseo-github",
          permissions: { contents: "read" },
          durationMs: 60 * 60 * 1000,
        },
      }),
      /github\.repositories is required.*cannot safely expand/iu,
    );
    assert.deepEqual(mint.inputs, []);
  });

  it("revokes shorter leases at their deadline and every lease at terminal", async () => {
    const clock = new TestClock();
    const mint = githubAuthorityFake(() => clock.now());
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      githubAuthority: mint,
      clock,
    });
    const github = {
      connection: "getpaseo-github",
      repositories: ["getpaseo/paseo"],
      permissions: { contents: "read" },
      durationMs: 5 * 60 * 1000,
    } satisfies CompiledGitHubAuthority;

    await authority.materialize({
      executionId: "execution-short",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      github,
    });
    await clock.advance(4 * 60 * 1000);
    assert.deepEqual(mint.revoked, []);
    await clock.advance(60 * 1000);
    assert.deepEqual(mint.revoked, ["scoped-token-1"]);

    await authority.materialize({
      executionId: "execution-terminal",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      github,
    });
    await authority.onExecutionTerminal("execution-terminal");
    assert.deepEqual(mint.revoked, ["scoped-token-1", "scoped-token-2"]);
  });

  it("isolates per-step leases so terminal cleanup cannot revoke another step", async () => {
    const mint = githubAuthorityFake();
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      githubAuthority: mint,
    });
    const github = {
      connection: "getpaseo-github",
      repositories: ["getpaseo/paseo"],
      permissions: { contents: "read" },
      durationMs: 60 * 60 * 1000,
    } satisfies CompiledGitHubAuthority;

    await authority.materialize({
      executionId: "step-one-execution",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      github,
    });
    await authority.materialize({
      executionId: "step-two-execution",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      env: { CLASSIFIER_ONLY: "no-credential" },
    });
    await authority.onExecutionTerminal("step-two-execution");
    assert.deepEqual(mint.revoked, []);
    await authority.onExecutionTerminal("step-one-execution");
    assert.deepEqual(mint.revoked, ["scoped-token-1"]);
  });

  it("uses durable terminal state to reject stale post-terminal materialization", async () => {
    let mints = 0;
    let active = true;
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      githubAuthority: {
        ...githubAuthorityFake(),
        mint: async () => {
          mints += 1;
          return {
            token: "stale-token",
            expiresAt: Date.now() + 60 * 60 * 1000,
            botUserId: 1,
            botLogin: "paseo[bot]",
          };
        },
      },
      isExecutionActive: async () => active,
    });

    active = false;
    await authority.onExecutionTerminal("terminal-tombstone");

    await assert.rejects(
      authority.materialize({
        executionId: "terminal-tombstone",
        projectId: "project-1",
        triggerContext: { provider: "manual" },
        github: {
          connection: "getpaseo-github",
          repositories: ["getpaseo/paseo"],
          permissions: { contents: "read" },
          durationMs: 60 * 60 * 1000,
        },
      }),
      /terminal execution/iu,
    );
    assert.equal(mints, 0);
  });

  it("consults durable execution status immediately before returning a credential", async () => {
    let active = true;
    const revocations: string[] = [];
    const authority = createExecutionAuthority({
      connectionsForProject: () => async (_slug, _value, context) => {
        await context?.registerToken?.("durable-token", () => {
          revocations.push("durable-token");
        });
        active = false;
        return "resolved-secret";
      },
      isExecutionActive: async () => active,
    });

    await assert.rejects(
      authority.materialize({
        executionId: "durable-status-race",
        projectId: "project-1",
        triggerContext: { provider: "manual" },
        env: { TOKEN: "${{ paseo.connections.some-connection.token }}" },
      }),
      /terminal execution/iu,
    );
    assert.deepEqual(revocations, ["durable-token"]);
  });

  it("rejects and revokes when terminal begins during the final durable activity query", async () => {
    let activityQueries = 0;
    let finalQueryStarted!: () => void;
    const finalQueryObserved = new Promise<void>((resolve) => {
      finalQueryStarted = resolve;
    });
    let resolveFinalQuery!: (active: boolean) => void;
    const finalQuery = new Promise<boolean>((resolve) => {
      resolveFinalQuery = resolve;
    });
    const revocations: string[] = [];
    const authority = createExecutionAuthority({
      connectionsForProject: () => async (_slug, _value, context) => {
        await context?.registerToken?.("final-query-token", () => {
          revocations.push("final-query-token");
        });
        return "resolved-secret";
      },
      isExecutionActive: async () => {
        activityQueries += 1;
        if (activityQueries === 1) return true;
        finalQueryStarted();
        return finalQuery;
      },
    });

    const materialization = authority.materialize({
      executionId: "terminal-during-final-query",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      env: { TOKEN: "${{ paseo.connections.some-connection.token }}" },
    });
    await finalQueryObserved;
    const terminal = authority.onExecutionTerminal("terminal-during-final-query");
    resolveFinalQuery(true);

    await assert.rejects(materialization, /terminal execution/iu);
    await terminal;
    assert.deepEqual(revocations, ["final-query-token"]);
  });

  it("registers materialization before the initial durable activity query", async () => {
    let activityQueryStarted!: () => void;
    const activityQueryObserved = new Promise<void>((resolve) => {
      activityQueryStarted = resolve;
    });
    let resolveActivityQuery!: (active: boolean) => void;
    const activityQuery = new Promise<boolean>((resolve) => {
      resolveActivityQuery = resolve;
    });
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      isExecutionActive: async () => {
        activityQueryStarted();
        return activityQuery;
      },
    });

    const materialization = authority.materialize({
      executionId: "stop-during-initial-query",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      env: { VALUE: "literal" },
    });
    await activityQueryObserved;
    const stopping = authority.stop();
    let stopReturned = false;
    void stopping.then(() => {
      stopReturned = true;
      return undefined;
    });
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    assert.equal(stopReturned, false);

    resolveActivityQuery(true);
    await assert.rejects(materialization, /stopped/iu);
    await stopping;
  });

  it("does not return an explicit GitHub token after durable execution becomes terminal", async () => {
    let active = true;
    const revoked: string[] = [];
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      githubAuthority: {
        mint: async () => {
          active = false;
          return {
            token: "durable-github-token",
            expiresAt: Date.now() + 60 * 60 * 1000,
            botUserId: 1,
            botLogin: "paseo[bot]",
          };
        },
        revoke: async (token) => {
          revoked.push(token);
        },
      },
      isExecutionActive: async () => active,
    });

    await assert.rejects(
      authority.materialize({
        executionId: "durable-github-status-race",
        projectId: "project-1",
        triggerContext: { provider: "manual" },
        github: {
          connection: "getpaseo-github",
          repositories: ["getpaseo/paseo"],
          permissions: { contents: "read" },
          durationMs: 60 * 60 * 1000,
        },
      }),
      /terminal execution/iu,
    );
    assert.deepEqual(revoked, ["durable-github-token"]);
  });

  it("does not return a token when terminal cleanup races an in-flight mint", async () => {
    let mintStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      mintStarted = resolve;
    });
    let releaseMint!: (value: {
      token: string;
      expiresAt: number;
      botUserId: number;
      botLogin: string;
    }) => void;
    const mintResult = new Promise<{
      token: string;
      expiresAt: number;
      botUserId: number;
      botLogin: string;
    }>((resolve) => {
      releaseMint = resolve;
    });
    const revoked: string[] = [];
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      githubAuthority: {
        mint: async () => {
          mintStarted();
          return mintResult;
        },
        revoke: async (token) => {
          revoked.push(token);
        },
      },
    });
    const materialization = authority.materialize({
      executionId: "terminal-mint-race",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      github: {
        connection: "getpaseo-github",
        repositories: ["getpaseo/paseo"],
        permissions: { contents: "read" },
        durationMs: 60 * 60 * 1000,
      },
    });

    await started;
    const terminal = authority.onExecutionTerminal("terminal-mint-race");
    releaseMint({
      token: "race-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
      botUserId: 1,
      botLogin: "paseo[bot]",
    });
    await assert.rejects(materialization, /terminal execution/iu);
    await terminal;
    assert.deepEqual(revoked, ["race-token"]);
  });

  it("revokes held connection credentials before waiting for an unrelated hung GitHub mint", async () => {
    const revoked: string[] = [];
    let releaseMint!: () => void;
    const mintBlocked = new Promise<void>((resolve) => {
      releaseMint = resolve;
    });
    const authority = createExecutionAuthority({
      connectionsForProject: () => async (_slug, _value, context) => {
        await context?.registerToken?.("held-connection-token", () => {
          revoked.push("held-connection-token");
        });
        return "resolved-secret";
      },
      githubAuthority: {
        mint: async () => {
          await mintBlocked;
          return {
            token: "late-github-token",
            expiresAt: Date.now() + 60 * 60 * 1000,
            botUserId: 1,
            botLogin: "paseo[bot]",
          };
        },
        revoke: async (token) => {
          revoked.push(token);
        },
      },
      isExecutionActive: async () => true,
    });
    await authority.materialize({
      executionId: "terminal-ordering",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      env: { TOKEN: "${{ paseo.connections.some-connection.token }}" },
    });
    const hungMaterialization = authority.materialize({
      executionId: "terminal-ordering",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      github: {
        connection: "getpaseo-github",
        repositories: ["getpaseo/paseo"],
        permissions: { contents: "read" },
        durationMs: 60 * 60 * 1000,
      },
    });
    await Promise.resolve();

    const terminal = authority.onExecutionTerminal("terminal-ordering");
    await Promise.resolve();
    assert.deepEqual(revoked, ["held-connection-token"]);

    releaseMint();
    await assert.rejects(hungMaterialization, /terminal execution/iu);
    await terminal;
    assert.deepEqual(revoked, ["held-connection-token", "late-github-token"]);
  });

  it("revokes active leases when the authority owner stops", async () => {
    const mint = githubAuthorityFake();
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      githubAuthority: mint,
    });
    await authority.materialize({
      executionId: "graceful-stop",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      github: {
        connection: "getpaseo-github",
        repositories: ["getpaseo/paseo"],
        permissions: { contents: "read" },
        durationMs: 60 * 60 * 1000,
      },
    });

    await authority.stop();

    assert.deepEqual(mint.revoked, ["scoped-token-1"]);
    await assert.rejects(
      authority.materialize({
        executionId: "new-after-stop",
        projectId: "project-1",
        triggerContext: { provider: "manual" },
        env: { TOKEN: "literal" },
      }),
      /stopped/iu,
    );
  });

  it("keeps graceful shutdown pending until a transient revocation succeeds", async () => {
    const canary = "execution-authority-secret-75ad";
    const stream = new FailureLogStream();
    const clock = new TestClock();
    let attempts = 0;
    let firstAttempt!: () => void;
    const firstAttemptObserved = new Promise<void>((resolve) => {
      firstAttempt = resolve;
    });
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      githubAuthority: {
        mint: async () => ({
          token: "shutdown-retry-token",
          expiresAt: clock.now() + 60 * 60 * 1000,
          botUserId: 1,
          botLogin: "paseo[bot]",
        }),
        revoke: async () => {
          attempts += 1;
          if (attempts === 1) {
            firstAttempt();
            throw new Error(canary);
          }
        },
      },
      clock,
      logger: createLogger(stream),
    });
    await authority.materialize({
      executionId: "shutdown-retry",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      github: {
        connection: "getpaseo-github",
        repositories: ["getpaseo/paseo"],
        permissions: { contents: "read" },
        durationMs: 60 * 60 * 1000,
      },
    });

    const stopping = authority.stop();
    await firstAttemptObserved;
    await clock.waitForScheduledDelay(1_000);
    assert.equal(attempts, 1);
    let stopped = false;
    void stopping.then(() => {
      stopped = true;
      return undefined;
    });
    await Promise.resolve();
    assert.equal(stopped, false);

    await clock.advance(1_000);
    await stopping;
    assert.equal(attempts, 2);
    assertOneFailure(stream, {
      operation: "execution-authority.token.revoke",
      component: "execution-authority",
      failureKind: "upstreamUnavailable",
      canary,
    });
  });

  it("returns bounded token-free residual exposure when shutdown revocation keeps failing", async () => {
    const clock = new TestClock();
    let attempts = 0;
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      githubAuthority: {
        mint: async () => ({
          token: "must-not-appear-in-stop-evidence",
          expiresAt: clock.now() + 60 * 60 * 1000,
          botUserId: 1,
          botLogin: "paseo[bot]",
        }),
        revoke: async () => {
          attempts += 1;
          throw new Error("permanent upstream failure");
        },
      },
      clock,
      isExecutionActive: async () => true,
    });
    await authority.materialize({
      executionId: "bounded-shutdown",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      github: {
        connection: "getpaseo-github",
        repositories: ["getpaseo/paseo"],
        permissions: { contents: "read" },
        durationMs: 60 * 60 * 1000,
      },
    });

    let stopResult: Awaited<ReturnType<typeof authority.stop>> | undefined;
    void authority.stop().then((result) => {
      stopResult = result;
      return undefined;
    });
    await clock.waitForScheduledDelay(10_000);
    await clock.advance(10_000);
    for (let index = 0; index < 10; index += 1) await Promise.resolve();

    assert.notEqual(stopResult, undefined);
    assert.deepEqual(stopResult, {
      residualExposures: [
        {
          executionId: "bounded-shutdown",
          leaseCount: 1,
          pendingMaterializations: 0,
          earliestUpstreamExpiresAt: Date.parse("2026-08-01T01:00:00.000Z"),
        },
      ],
    });
    assert.equal(JSON.stringify(stopResult).includes("must-not-appear-in-stop-evidence"), false);
    assert.equal(clock.referencedTimerCount(), 0);
    assert.ok(attempts >= 1);
  });

  it("retains a failed deadline revocation and retries it through the clock seam", async () => {
    const clock = new TestClock();
    let attempts = 0;
    const revoked: string[] = [];
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      githubAuthority: {
        mint: async () => ({
          token: "retry-deadline-token",
          expiresAt: clock.now() + 60 * 60 * 1000,
          botUserId: 1,
          botLogin: "paseo[bot]",
        }),
        revoke: async (token) => {
          attempts += 1;
          if (attempts === 1) throw new Error("transient upstream failure");
          revoked.push(token);
        },
      },
      clock,
    });
    await authority.materialize({
      executionId: "retry-deadline",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      github: {
        connection: "getpaseo-github",
        repositories: ["getpaseo/paseo"],
        permissions: { contents: "read" },
        durationMs: 5 * 60 * 1000,
      },
    });

    await clock.advance(5 * 60 * 1000);
    assert.equal(attempts, 1);
    assert.deepEqual(revoked, []);
    await clock.advance(1_000);
    assert.equal(attempts, 2);
    assert.deepEqual(revoked, ["retry-deadline-token"]);
  });

  it("retains a failed terminal revocation and retries it through the clock seam", async () => {
    const clock = new TestClock();
    let attempts = 0;
    const revoked: string[] = [];
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      githubAuthority: {
        mint: async () => ({
          token: "retry-terminal-token",
          expiresAt: clock.now() + 60 * 60 * 1000,
          botUserId: 1,
          botLogin: "paseo[bot]",
        }),
        revoke: async (token) => {
          attempts += 1;
          if (attempts === 1) throw new Error("transient upstream failure");
          revoked.push(token);
        },
      },
      clock,
    });
    await authority.materialize({
      executionId: "retry-terminal",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      github: {
        connection: "getpaseo-github",
        repositories: ["getpaseo/paseo"],
        permissions: { contents: "read" },
        durationMs: 60 * 60 * 1000,
      },
    });

    await authority.onExecutionTerminal("retry-terminal");
    assert.equal(attempts, 1);
    assert.deepEqual(revoked, []);
    await clock.advance(1_000);
    assert.equal(attempts, 2);
    assert.deepEqual(revoked, ["retry-terminal-token"]);
  });

  it("bounds failed revocation retention at the upstream token expiry", async () => {
    const clock = new TestClock();
    let attempts = 0;
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      githubAuthority: {
        mint: async () => ({
          token: "upstream-expiry-token",
          expiresAt: clock.now() + 3_000,
          botUserId: 1,
          botLogin: "paseo[bot]",
        }),
        revoke: async () => {
          attempts += 1;
          throw new Error("upstream unavailable");
        },
      },
      clock,
    });
    await authority.materialize({
      executionId: "upstream-expiry",
      projectId: "project-1",
      triggerContext: { provider: "manual" },
      github: {
        connection: "getpaseo-github",
        repositories: ["getpaseo/paseo"],
        permissions: { contents: "read" },
        durationMs: 60 * 60 * 1000,
      },
    });

    await authority.onExecutionTerminal("upstream-expiry");
    assert.equal(attempts, 1);
    await clock.advance(1_000);
    assert.equal(attempts, 2);
    await clock.advance(2_000);
    assert.equal(attempts, 3);
    await clock.advance(10_000);
    assert.equal(attempts, 3);
  });

  it("does not retain empty terminal execution states", async () => {
    const inactive = new Set<string>();
    const authority = createExecutionAuthority({
      connectionsForProject: () => async () => "unused",
      isExecutionActive: async (executionId) => !inactive.has(executionId),
    });

    for (let index = 0; index < 250; index += 1) {
      const executionId = `completed-${index}`;
      inactive.add(executionId);
      await authority.onExecutionTerminal(executionId);
    }

    assert.deepEqual(authority.resourceCounts(), {
      executionStates: 0,
      leases: 0,
      pendingMaterializations: 0,
    });
    await assert.rejects(
      authority.materialize({
        executionId: "completed-249",
        projectId: "project-1",
        triggerContext: { provider: "manual" },
        env: { VALUE: "literal" },
      }),
      /terminal execution/iu,
    );
  });
});

function githubAuthorityFake(now: () => number = Date.now) {
  const inputs: Array<{
    projectId: string;
    connectionSlug: string;
    repositories: readonly string[];
    permissions: Readonly<Record<string, "read" | "write" | "admin">>;
  }> = [];
  const revoked: string[] = [];
  let count = 0;
  return {
    inputs,
    revoked,
    async mint(input: (typeof inputs)[number]) {
      inputs.push(input);
      count += 1;
      return {
        token: `scoped-token-${count}`,
        expiresAt: now() + 60 * 60 * 1000,
        botUserId: 9876,
        botLogin: "paseo[bot]",
      };
    },
    async revoke(token: string) {
      revoked.push(token);
    },
  };
}

class TestClock implements ExecutionAuthorityClock {
  private current = Date.parse("2026-08-01T00:00:00.000Z");
  private nextId = 0;
  private timers = new Map<number, { at: number; callback: () => Promise<void>; ref: boolean }>();
  private scheduleWaiters = new Set<() => void>();

  now(): number {
    return this.current;
  }

  schedule(
    callback: () => Promise<void>,
    delayMs: number,
    options?: { ref?: boolean },
  ): () => void {
    const id = this.nextId++;
    this.timers.set(id, { at: this.current + delayMs, callback, ref: options?.ref === true });
    for (const resolve of this.scheduleWaiters) resolve();
    this.scheduleWaiters.clear();
    return () => this.timers.delete(id);
  }

  referencedTimerCount(): number {
    return [...this.timers.values()].filter((timer) => timer.ref).length;
  }

  async waitForScheduledDelay(delayMs: number): Promise<void> {
    const scheduledAt = this.current + delayMs;
    while (![...this.timers.values()].some((timer) => timer.at === scheduledAt)) {
      await new Promise<void>((resolve) => this.scheduleWaiters.add(resolve));
    }
  }

  async advance(delayMs: number): Promise<void> {
    this.current += delayMs;
    for (const [id, timer] of this.timers) {
      if (timer.at > this.current) continue;
      this.timers.delete(id);
      await timer.callback();
    }
  }
}
