import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { ProviderVerificationError } from "../../provider-applications/index.js";
import { startSlackSocketFixture } from "../../test-utils/slack-socket-fixture.js";
import { SLACK_REQUIRED_BOT_SCOPES } from "./client.js";
import { createSlackSocketInstallationVerifier } from "./installation.js";

describe("Slack Socket setup verification", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => Promise.all(closers.splice(0).map((close) => close())));

  it("derives both identities and returns only after its real socket is closed", async () => {
    const slack = await startSlackSocketFixture();
    closers.push(() => slack.close());
    const verifier = createSlackSocketInstallationVerifier({
      apiBaseUrl: slack.apiBaseUrl,
      timeoutMs: 500,
    });

    assert.deepEqual(await verifier.verify("xapp-secret", "xoxb-secret"), {
      appId: "A123",
      teamId: "T1",
      teamName: "Acme",
      botUserId: "U1",
      botAccessToken: "xoxb-secret",
      scopes: [...SLACK_REQUIRED_BOT_SCOPES].sort(),
    });
    assert.deepEqual(slack.authorizations, [
      "Bearer xapp-secret",
      "Bearer xoxb-secret",
      "Bearer xoxb-secret",
    ]);
    assert.equal(slack.outstanding, 0);
  });

  it.each([429, 500])(
    "cancels an unfinished %s response without reading its canary",
    async (status) => {
      const slack = await startSlackSocketFixture(
        Array.from({ length: 4 }, () => ({ kind: "unfinished" as const, status })),
      );
      closers.push(() => slack.close());
      const verifier = createSlackSocketInstallationVerifier({
        apiBaseUrl: slack.apiBaseUrl,
        timeoutMs: 250,
      });

      for (let attempt = 0; attempt < 4; attempt += 1) {
        await assert.rejects(
          verifier.verify("xapp-secret", "xoxb-secret"),
          (error: unknown) =>
            error instanceof ProviderVerificationError &&
            error.reason === (status === 429 ? "rateLimited" : "upstreamUnavailable"),
        );
        await waitFor(() => slack.outstanding === 0);
      }
      assert.equal(slack.openCount, 4);
    },
  );

  it("terminates a peer that ignores close and a corrected attempt still succeeds", async () => {
    const slack = await startSlackSocketFixture([
      { kind: "socket", ignoreClose: true },
      { kind: "socket" },
    ]);
    closers.push(() => slack.close());
    const verifier = createSlackSocketInstallationVerifier({
      apiBaseUrl: slack.apiBaseUrl,
      timeoutMs: 200,
    });

    const first = await verifier.verify("xapp-secret", "xoxb-secret");
    assert.equal(first.appId, "A123");
    slack.resumePeers();
    await waitFor(() => slack.outstanding === 0);

    const second = await verifier.verify("xapp-secret", "xoxb-secret");
    assert.equal(second.teamId, "T1");
    await waitFor(() => slack.outstanding === 0);
    assert.equal(slack.openCount, 2);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
