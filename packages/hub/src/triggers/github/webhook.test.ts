import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "vitest";
import { DatabaseUnavailableError } from "../../db/errors.js";
import type { ProviderEventAcceptance } from "../../db/types.js";
import type { ExternalTrigger } from "../index.js";
import {
  createWebhookSource,
  type WebhookEndpoint,
  hashWebhookSignature,
  normalizeWebhookEvent,
  verifySignature,
} from "./webhook.js";

const SECRET = "test-secret";

describe("verifySignature", () => {
  it("returns true for a valid signature", () => {
    const payload = JSON.stringify(createWebhookPayload());
    const signature = createSignature(payload);

    assert.equal(verifySignature(SECRET, payload, signature), true);
  });

  it("returns false for a tampered payload", () => {
    const payload = JSON.stringify(createWebhookPayload());
    const signature = createSignature(payload);
    const tamperedPayload = JSON.stringify({
      ...createWebhookPayload(),
      action: "closed",
    });

    assert.equal(verifySignature(SECRET, tamperedPayload, signature), false);
  });
});

describe("hashWebhookSignature", () => {
  it("returns the same hash for the same GitHub signature", () => {
    const payload = JSON.stringify(createWebhookPayload());
    const signature = createSignature(payload);

    assert.equal(hashWebhookSignature(signature), hashWebhookSignature(signature));
  });
});

describe("normalizeWebhookEvent", () => {
  it("produces a normalized webhook event", () => {
    const before = Date.now();
    const body = createWebhookPayload();
    const event = normalizeWebhookEvent({
      body,
      deliveryId: "delivery-123",
      eventType: "issue_comment",
    });
    const after = Date.now();

    assert.notEqual(event, undefined);
    assert.equal(event!.id, "delivery-123");
    assert.equal(event!.type, "issue_comment");
    assert.equal(event!.repo, "acme/widgets");
    assert.equal(event!.repositoryId, 9001);
    assert.equal(event!.installationId, 42);
    assert.equal(event!.payload, body);

    const createdAtMs = Date.parse(event!.createdAt);
    assert.equal(Number.isNaN(createdAtMs), false);
    assert.equal(createdAtMs >= before, true);
    assert.equal(createdAtMs <= after, true);
  });

  it("returns undefined for events without repository", () => {
    const event = normalizeWebhookEvent({
      body: { action: "completed" },
      deliveryId: "ping-123",
      eventType: "ping",
    });

    assert.equal(event, undefined);
  });
});

describe("GitHub webhook", () => {
  it("requires an installation id after authenticating the signed body", async () => {
    const github = GitHubWebhook.fanout(undefined);
    assert.equal(await github.deliver("missing-installation", { action: "ping" }), 400);
  });

  it("durably drops an authentic unsupported delivery before dispatch", async () => {
    const dropped: string[] = [];
    const endpoint = createWebhookSource(SECRET, {
      ...webhookOptions(),
      accept: async (input) => {
        dropped.push(input.dropReason ?? "");
        return {
          status: "dropped",
          receiptId: input.deliveryId,
          reason: input.dropReason!,
        };
      },
    });
    const github = new GitHubWebhook(endpoint);
    assert.equal(
      await github.deliver("unsupported", { action: "ping", installation: { id: 42 } }),
      200,
    );
    assert.deepEqual(dropped, ["no_trigger_for_source"]);
  });

  it("records a durable outcome when a bound delivery has no handler", async () => {
    const dropped: string[] = [];
    const endpoint = createWebhookSource(SECRET, {
      ...webhookOptions(),
      accept: async (input) => {
        dropped.push(input.dropReason ?? "");
        return {
          status: "dropped",
          receiptId: input.deliveryId,
          reason: input.dropReason!,
        };
      },
    });

    assert.equal(await new GitHubWebhook(endpoint).deliver("no-handler"), 200);
    assert.deepEqual(dropped, ["configuration_unavailable"]);
  });

  it("syncs a configuration-source push even when runtime trigger routing drops it", async () => {
    const synchronized: Array<{
      installationId: number;
      repositoryId: number;
      deliveryId: string;
    }> = [];
    const acceptedDeliveries: Array<{ source: string; deliveryId: string }> = [];
    const endpoint = createWebhookSource(SECRET, {
      ...webhookOptions(),
      accept: async (input) => {
        acceptedDeliveries.push({ source: input.source, deliveryId: input.deliveryId });
        return {
          status: "dropped" as const,
          receiptId: "receipt-config-only",
          reason: "no_project_route",
        };
      },
      synchronizePush: async (input) => {
        synchronized.push({
          installationId: input.installationId,
          repositoryId: input.repositoryId,
          deliveryId: input.deliveryId,
        });
      },
    });

    assert.equal(
      await new GitHubWebhook(endpoint).deliver(
        "config-only-push",
        {
          ...createWebhookPayload(),
          ref: "refs/heads/main",
          after: "commit-config-only",
          sender: { login: "paseo" },
        },
        "push",
      ),
      200,
    );
    assert.deepEqual(synchronized, [
      { installationId: 42, repositoryId: 9001, deliveryId: "config-only-push" },
    ]);
    assert.deepEqual(acceptedDeliveries, [
      { source: "github.push", deliveryId: "config-only-push" },
    ]);
  });

  it("rejects declared and streamed oversized bodies before full buffering", async () => {
    const github = new OversizedGitHubWebhook(createWebhookSource(SECRET, webhookOptions()));

    assert.equal(await github.deliverDeclared(), 413);
    assert.deepEqual(await github.deliverStalled(), { status: 413, canceled: true });
  });

  it("returns a retryable failure when tenant resolution storage is unavailable", async () => {
    const endpoint = createWebhookSource(SECRET, {
      ...webhookOptions(),
      accept: () => Promise.reject(new DatabaseUnavailableError()),
    });
    const github = new GitHubWebhook(endpoint);
    assert.equal(await github.deliver("database-unavailable"), 503);
  });

  it("does not dispatch duplicate delivery ids", async () => {
    const github = await GitHubWebhook.recording("42");

    await github.deliver("delivery-123");
    await github.deliver("delivery-123");

    assert.deepEqual(github.receivedIds(), ["delivery-123"]);
  });

  it("fans out one delivery to independent consumers", async () => {
    const github = GitHubWebhook.fanout("42");
    await github.addConsumer("first");
    await github.addConsumer("second");

    assert.equal(await github.deliver("delivery-fanout"), 200);
    assert.deepEqual(github.receivedSources(), [
      "first:github.issue_comment",
      "second:github.issue_comment",
    ]);
  });
});

class GitHubWebhook {
  private readonly deliveries: ExternalTrigger[] = [];

  constructor(private readonly endpoint: WebhookEndpoint) {}

  static fanout(allowedInstallations: string | undefined): GitHubWebhook {
    return new GitHubWebhook(createWebhook(allowedInstallations));
  }

  static async recording(allowedInstallations: string | undefined): Promise<GitHubWebhook> {
    const github = new GitHubWebhook(createWebhook(allowedInstallations));
    await github.endpoint.start(async (event) => {
      github.deliveries.push(event);
    });
    return github;
  }

  async addConsumer(name: string): Promise<void> {
    await this.endpoint.start(async (event) => {
      this.deliveries.push({ ...event, source: `${name}:${event.source}` });
    });
  }

  async deliver(
    deliveryId: string,
    payload: unknown = createWebhookPayload(),
    eventType = "issue_comment",
  ): Promise<number> {
    const body = JSON.stringify(payload);
    const response = await this.endpoint.handle(
      new Request("http://localhost/webhook", {
        method: "POST",
        headers: createHeaders(createSignature(body), deliveryId, eventType),
        body,
      }),
    );
    return response.status;
  }

  receivedIds(): string[] {
    return this.deliveries.map((delivery) => delivery.deliveryId);
  }

  receivedSources(): string[] {
    return this.deliveries.map((delivery) => delivery.source);
  }
}

class OversizedGitHubWebhook {
  private canceled = false;

  constructor(private readonly endpoint: WebhookEndpoint) {}

  async deliverDeclared(): Promise<number> {
    const response = await this.endpoint.handle(
      new Request("http://localhost/webhook", {
        method: "POST",
        headers: {
          ...Object.fromEntries(createHeaders("sha256=invalid", "declared")),
          "content-length": "1048577",
        },
        body: "{}",
      }),
    );
    return response.status;
  }

  async deliverStalled(): Promise<{ status: number; canceled: boolean }> {
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        chunks += 1;
        if (chunks <= 2) controller.enqueue(new Uint8Array(600_000));
      },
      cancel: () => {
        this.canceled = true;
      },
    });
    interface StreamingRequestInit extends RequestInit {
      duplex: "half";
    }
    const requestInit = {
      method: "POST",
      headers: createHeaders("sha256=invalid", "streamed"),
      body,
      duplex: "half",
    } satisfies StreamingRequestInit;
    const request = new Request("http://localhost/webhook", requestInit);
    const response = await this.endpoint.handle(request);
    return { status: response.status, canceled: this.canceled };
  }
}

function createWebhook(_allowedInstallations: string | undefined): WebhookEndpoint {
  const deliveries = new Set<string>();
  return createWebhookSource(
    SECRET,
    webhookOptions((input) => {
      if (deliveries.has(input.deliveryId)) {
        return Promise.resolve({
          status: "duplicate",
          triggerIds: [`trigger-${input.deliveryId}`],
          receiptId: input.deliveryId,
        });
      }
      deliveries.add(input.deliveryId);
      return Promise.resolve(accepted(input));
    }),
  );
}

function webhookOptions(
  accept: Parameters<typeof createWebhookSource>[1]["accept"] = (input) =>
    Promise.resolve(accepted(input)),
): Parameters<typeof createWebhookSource>[1] {
  return { accept, applyLifecycle: () => Promise.resolve() };
}

function accepted(input: {
  deliveryId: string;
  source: string;
  payload: unknown;
  receivedAt: Date;
}): ProviderEventAcceptance {
  return {
    status: "accepted",
    receiptId: `receipt-${input.deliveryId}`,
    events: [
      {
        providerEventReceiptId: `trigger-${input.deliveryId}`,
        organizationId: "org_1",
        projectId: "project-1",
        configurationRevisionId: "11111111-1111-4111-8111-111111111133",
        deliveryId: input.deliveryId,
        source: input.source,
        payload: input.payload,
        receivedAt: input.receivedAt,
        connectionId: "github-connection",
        resourceId: "9001",
      },
    ],
  };
}

function createWebhookPayload(options: { installationId?: number } = {}): {
  action: string;
  installation: { id: number };
  repository: { id: number; full_name: string };
} {
  return {
    action: "created",
    installation: {
      id: options.installationId ?? 42,
    },
    repository: {
      id: 9001,
      full_name: "acme/widgets",
    },
  };
}

function createSignature(payload: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(payload).digest("hex");
}

function createHeaders(
  signature: string,
  deliveryId: string,
  eventType = "issue_comment",
): Headers {
  return new Headers({
    "Content-Type": "application/json",
    "X-GitHub-Delivery": deliveryId,
    "X-GitHub-Event": eventType,
    "X-Hub-Signature-256": signature,
  });
}
