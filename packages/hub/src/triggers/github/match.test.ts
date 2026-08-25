import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { compileHubConfig } from "../../config/index.js";
import type { NormalizedGitHubEvent } from "../../auth/github-events.js";
import { matchTriggers, readGitHubInvocationMessage } from "./match.js";

describe("GitHub trigger matching", () => {
  it.each([
    ["actions", ["opened"]],
    ["item_types", ["issue"]],
    ["labels", []],
  ])("does not accept the unsupported or empty %s filter", (key, value) => {
    assert.throws(() => configFor({ from_users: ["boudra"], [key]: value }));
  });

  it.each([
    {
      acceptance: "1: issue_created accepts only opened issues",
      on: "github.issue_created",
      event: eventFor("issues", { action: "opened", issue: issue() }),
      expected: 1,
    },
    {
      acceptance: "1: issue_created rejects non-opened issues",
      on: "github.issue_created",
      event: eventFor("issues", { action: "closed", issue: issue() }),
      expected: 0,
    },
    {
      acceptance: "2: pull_request_created accepts only opened pull requests",
      on: "github.pull_request_created",
      event: eventFor("pull_request", { action: "opened", pull_request: pullRequest() }),
      expected: 1,
    },
    {
      acceptance: "2: pull_request_created rejects non-opened pull requests",
      on: "github.pull_request_created",
      event: eventFor("pull_request", { action: "closed", pull_request: pullRequest() }),
      expected: 0,
    },
    {
      acceptance: "3: created issue comments are separate from pull-request comments",
      on: "github.issue_comment_created",
      event: eventFor("issue_comment", { action: "created", issue: issue(), comment: comment() }),
      expected: 1,
    },
    {
      acceptance: "3: created pull-request comments are separate from issue comments",
      on: "github.pull_request_comment_created",
      event: eventFor("issue_comment", {
        action: "created",
        issue: { ...issue(), pull_request: {} },
        comment: comment(),
      }),
      expected: 1,
    },
    {
      acceptance: "3: semantic comments reject actions other than created",
      on: "github.issue_comment_created",
      event: eventFor("issue_comment", { action: "edited", issue: issue(), comment: comment() }),
      expected: 0,
    },
    {
      acceptance: "4: issue label_added matches its changed label case-insensitively",
      on: "github.issue_label_added",
      filters: { label: "READY-FOR-AGENT" },
      event: eventFor("issues", {
        action: "labeled",
        issue: issue(),
        label: { name: "ready-for-agent" },
      }),
      expected: 1,
    },
    {
      acceptance: "4: pull-request label_added matches its changed label",
      on: "github.pull_request_label_added",
      filters: { label: "ready-for-agent" },
      event: eventFor("pull_request", {
        action: "labeled",
        pull_request: pullRequest(),
        label: { name: "ready-for-agent" },
      }),
      expected: 1,
    },
    {
      acceptance: "5: labels requires every current issue label",
      on: "github.issue_created",
      filters: { labels: ["bug", "BACKEND"] },
      event: eventFor("issues", {
        action: "opened",
        issue: issue({ labels: [{ name: "Bug" }, { name: "backend" }] }),
      }),
      expected: 1,
    },
    {
      acceptance: "5: labels rejects a missing current pull-request label",
      on: "github.pull_request_created",
      filters: { labels: ["bug", "backend"] },
      event: eventFor("pull_request", {
        action: "opened",
        pull_request: pullRequest({ labels: [{ name: "bug" }] }),
      }),
      expected: 0,
    },
    {
      acceptance: "5: labels applies to issue comments",
      on: "github.issue_comment_created",
      filters: { labels: ["bug", "backend"] },
      event: eventFor("issue_comment", {
        action: "created",
        issue: issue({ labels: [{ name: "bug" }, { name: "backend" }] }),
        comment: comment(),
      }),
      expected: 1,
    },
    {
      acceptance: "6: repository, connection, sender, content, and label filters compose with AND",
      on: "github.issue_label_added",
      filters: {
        repo: "boudra/faro",
        connection: "github-main",
        contains: "body",
        from_users: ["boudra"],
        label: "ready-for-agent",
        labels: ["bug"],
      },
      connectionId: "11111111-1111-4111-8111-111111111111",
      event: eventFor("issues", {
        action: "labeled",
        issue: issue({ body: "body", labels: [{ name: "bug" }] }),
        label: { name: "ready-for-agent" },
      }),
      expected: 1,
    },
    {
      acceptance: "6: any failed composed filter rejects",
      on: "github.issue_label_added",
      filters: { contains: "different", label: "ready-for-agent" },
      event: eventFor("issues", {
        action: "labeled",
        issue: issue({ body: "body" }),
        label: { name: "ready-for-agent" },
      }),
      expected: 0,
    },
    {
      acceptance: "7: legacy issues retains its action-agnostic behavior",
      on: "github.issues",
      event: eventFor("issues", { action: "closed", issue: issue() }),
      expected: 1,
    },
    {
      acceptance: "7: legacy issue_comment retains its action-agnostic behavior",
      on: "github.issue_comment",
      event: eventFor("issue_comment", { action: "edited", issue: issue(), comment: comment() }),
      expected: 1,
    },
  ])("$acceptance", ({ on, filters, event, expected, connectionId }) => {
    const config = configFor({
      from_users: ["boudra"],
      ...filters,
      ...(connectionId === undefined ? {} : { connection: "github-main" }),
    });
    const trigger = config.triggers[0]!;
    const configured = {
      ...config,
      triggers: [
        {
          ...trigger,
          on,
          filters: { ...trigger.filters, ...(connectionId === undefined ? {} : { connectionId }) },
        },
      ],
    };
    assert.equal(matchTriggers(configured, event, connectionId).length, expected);
  });

  it.each([
    {
      name: "issues",
      event: eventFor("issues", {
        action: "closed",
        issue: issue({ title: "Issue title", body: "Issue body" }),
      }),
      text: "Issue title\nIssue body",
      anotherAction: "reopened",
    },
    {
      name: "issue comments",
      event: eventFor("issue_comment", {
        action: "edited",
        issue: issue(),
        comment: comment({ body: "Issue comment" }),
      }),
      text: "Issue comment",
      anotherAction: "deleted",
    },
    {
      name: "pull-request reviews",
      event: eventFor("pull_request_review", {
        action: "submitted",
        pull_request: pullRequest(),
        review: { body: "Review body", user: { login: "reviewer" } },
      }),
      text: "Review body",
      anotherAction: "edited",
    },
    {
      name: "pull-request review comments",
      event: eventFor("pull_request_review_comment", {
        action: "created",
        pull_request: pullRequest(),
        comment: comment({ body: "Review comment" }),
      }),
      text: "Review comment",
      anotherAction: "deleted",
    },
  ])(
    "keeps legacy $name actor, text, and action-agnostic matching",
    ({ event, text, anotherAction }) => {
      const config = configFor({ contains: text, from_users: ["boudra"] });
      const trigger = config.triggers[0]!;
      const configured = { ...config, triggers: [{ ...trigger, on: `github.${event.type}` }] };

      assert.equal(readGitHubInvocationMessage(event), text);
      assert.equal(matchTriggers(configured, event).length, 1);
      assert.equal(
        matchTriggers(configured, {
          ...event,
          payload: { ...event.payload, sender: { login: "someone-else" } },
        }).length,
        0,
      );
      assert.equal(
        matchTriggers(configured, {
          ...event,
          payload: { ...event.payload, action: anotherAction },
        }).length,
        1,
      );
    },
  );

  it("matches the compiled one-step trigger by repository, text, and actor", () => {
    const config = configFor({ repo: "boudra/faro", contains: "@paseo", from_users: ["boudra"] });
    const matches = matchTriggers(config, createEvent());

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.trigger.name, "github-comment");
  });

  it("matches pattern-less comments while preserving the provider allowlist", () => {
    const config = configFor({ repo: "boudra/faro", from_users: ["boudra"] });
    assert.equal(
      matchTriggers(
        config,
        createEvent({
          payload: {
            comment: { id: 123, body: "please explain", user: { login: "boudra" } },
            sender: { login: "boudra" },
          },
        }),
      ).length,
      1,
    );
    assert.deepEqual(
      matchTriggers(
        config,
        createEvent({
          payload: {
            comment: { id: 123, body: "please explain", user: { login: "stranger" } },
            sender: { login: "stranger" },
          },
        }),
      ),
      [],
    );
  });

  it("keeps repository and pattern filters literal", () => {
    const config = configFor({ repo: "boudra/faro", pattern: "@paseo", from_users: ["boudra"] });
    assert.equal(
      matchTriggers(
        config,
        createEvent({
          payload: {
            comment: { id: 123, body: "@paseo please explain", user: { login: "boudra" } },
            sender: { login: "boudra" },
          },
        }),
      ).length,
      1,
    );
    assert.deepEqual(matchTriggers(config, createEvent({ repo: "elsewhere/repo" })), []);
    assert.deepEqual(
      matchTriggers(
        config,
        createEvent({
          payload: {
            comment: { id: 123, body: "please explain", user: { login: "boudra" } },
            sender: { login: "boudra" },
          },
        }),
      ),
      [],
    );
  });

  it("applies the same security filters to pull-request review comments", () => {
    const config = compileHubConfig({
      environments: [{ name: "runner", kind: "daemon", daemon: "runner", cwd: "/repo" }],
      triggers: [
        {
          name: "review-comment",
          on: "github.pull_request_review_comment",
          max_runtime: "2h",
          filters: { repo: "boudra/faro", contains: "@paseo", from_users: ["boudra"] },
          steps: [
            {
              id: "reply",
              environment: "runner",
              max_runtime: "1h",
              idle_timeout: "5m",
              agent: { provider: "opencode", mode: "default" },
              prompt: [{ text: "Handle it" }],
            },
          ],
        },
      ],
    });
    const event: NormalizedGitHubEvent = {
      ...createEvent(),
      type: "pull_request_review_comment",
      payload: {
        comment: { id: 999, body: "@paseo review this", user: { login: "boudra" } },
        sender: { login: "boudra" },
        pull_request: { head: { ref: "topic" } },
      },
    };
    assert.equal(matchTriggers(config, event).length, 1);
  });
});

function configFor(filters: Record<string, unknown>) {
  return compileHubConfig({
    environments: [{ name: "runner", kind: "daemon", daemon: "runner", cwd: "/repo" }],
    triggers: [
      {
        name: "github-comment",
        on: "github.issue_comment",
        max_runtime: "2h",
        filters,
        steps: [
          {
            id: "reply",
            environment: "runner",
            max_runtime: "1h",
            idle_timeout: "5m",
            agent: { provider: "opencode", mode: "default" },
            prompt: [{ text: "Handle it" }],
          },
        ],
      },
    ],
  });
}

function issue(overrides: Record<string, unknown> = {}) {
  return { number: 12, title: "Title", body: "body", user: { login: "author" }, ...overrides };
}

function pullRequest(overrides: Record<string, unknown> = {}) {
  return {
    number: 12,
    title: "Title",
    body: "body",
    user: { login: "author" },
    head: { ref: "topic" },
    ...overrides,
  };
}

function comment(overrides: Record<string, unknown> = {}) {
  return { id: 123, body: "comment body", user: { login: "boudra" }, ...overrides };
}

function eventFor(type: string, payload: Record<string, unknown>): NormalizedGitHubEvent {
  return { ...createEvent(), type, payload: { ...payload, sender: { login: "boudra" } } };
}

function createEvent(
  options: {
    repo?: string;
    payload?: Record<string, unknown>;
  } = {},
): NormalizedGitHubEvent {
  return {
    id: "delivery-1",
    type: "issue_comment",
    repo: options.repo ?? "boudra/faro",
    repositoryId: 7,
    installationId: 42,
    payload: options.payload ?? {
      comment: { id: 123, body: "hi @paseo", user: { login: "boudra" } },
      sender: { login: "boudra" },
    },
    createdAt: "2026-05-19T00:00:00.000Z",
  };
}
