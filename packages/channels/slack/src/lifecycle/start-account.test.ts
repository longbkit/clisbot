// The boot `auth.test` probe: the Fusion budget, the single retry, and the
// loud log. Wave 5 lost the Slack account on a loaded host because the boot
// probe's budget was 2500 ms and a timeout was silent
// (docs/tests/channels/p0-live-scenarios.md "Environment notes"). The fake
// Web API here answers after 3 s — inside the new budget, outside the old one.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { slackWebClientStubForTest, type WebClient } from "../client/web-api.js";
import { probeSlackAuthAtStart, SLACK_START_PROBE_TIMEOUT_MS } from "./start-account.js";

/** A Web API whose `auth.test` answers after `delayMs`. */
function slowAuthClient(delayMs: number, result: Record<string, unknown>): WebClient {
  return {
    ...slackWebClientStubForTest(),
    auth: {
      async test() {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return result as never;
      },
    },
  } as WebClient;
}

function collectLog() {
  const errors: string[] = [];
  return { log: { error: (message: string) => void errors.push(message) }, errors };
}

const OK_AUTH = { ok: true, user_id: "U0BOT", bot_id: "B0BOT", team_id: "T0TEAM", user: "vai" };

describe("probeSlackAuthAtStart", () => {
  it("still starts the account when auth.test takes 3 s", async () => {
    const { log, errors } = collectLog();
    const probe = await probeSlackAuthAtStart("xoxb-test", {
      accountId: "work",
      log: log as never,
      client: slowAuthClient(3000, OK_AUTH),
    });
    assert.equal(probe.ok, true);
    assert.equal(probe.teamId, "T0TEAM");
    assert.deepEqual(errors, []);
  });

  // The same shape as the pre-fix failure, scaled down: an answer slower than
  // the budget times out, and a timeout carries `status: null` — the signal the
  // retry keys on. Run at 2500/3000 ms it would burn both attempts in wall
  // clock for no extra coverage.
  it("times out when the answer is slower than the budget", async () => {
    const probe = await probeSlackAuthAtStart("xoxb-test", {
      accountId: "work",
      timeoutMs: 250,
      client: slowAuthClient(300, OK_AUTH),
    });
    assert.equal(probe.ok, false);
    assert.equal(probe.status, null);
  });

  it("retries a timeout once and names the budget in an error log", async () => {
    const { log, errors } = collectLog();
    let attempts = 0;
    const client = {
      ...slackWebClientStubForTest(),
      auth: {
        async test() {
          attempts += 1;
          if (attempts === 1) await new Promise((resolve) => setTimeout(resolve, 200));
          return OK_AUTH as never;
        },
      },
    } as WebClient;
    const probe = await probeSlackAuthAtStart("xoxb-test", {
      accountId: "work",
      timeoutMs: 100,
      log: log as never,
      client,
    });
    assert.equal(attempts, 2);
    assert.equal(probe.ok, true);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /100ms start budget/u);
    assert.match(errors[0]!, /"work"/u);
  });

  it("logs both attempts when the host never answers", async () => {
    const { log, errors } = collectLog();
    const probe = await probeSlackAuthAtStart("xoxb-test", {
      accountId: "work",
      timeoutMs: 50,
      log: log as never,
      client: slowAuthClient(400, OK_AUTH),
    });
    assert.equal(probe.ok, false);
    assert.equal(errors.length, 2);
    assert.match(errors[1]!, /failed twice within the 50ms start budget/u);
    assert.match(errors[1]!, /will not start/u);
  });

  it("does not retry a token Slack itself rejected", async () => {
    let attempts = 0;
    const client = {
      ...slackWebClientStubForTest(),
      auth: {
        async test() {
          attempts += 1;
          return { ok: false, error: "invalid_auth" } as never;
        },
      },
    } as WebClient;
    const probe = await probeSlackAuthAtStart("xoxb-bad", { accountId: "work", client });
    assert.equal(attempts, 1);
    assert.equal(probe.ok, false);
    assert.equal(probe.error, "invalid_auth");
  });

  it("defaults to the 15 s boot budget", () => {
    assert.equal(SLACK_START_PROBE_TIMEOUT_MS, 15_000);
  });
});
