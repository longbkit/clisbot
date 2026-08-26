// L4 auth.test probe: the bot/user identity facts, the user-token warning, and
// the failure mapping. Uses an injected fake WebClient so no network / dep is
// needed.

import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { probeSlackAuth, type WebClient } from "./web-api.js";

function fakeAuthClient(result: Record<string, unknown>): WebClient {
  return {
    auth: {
      async test() {
        return result as never;
      },
    },
    chat: {
      async postMessage() {
        return { ok: true };
      },
    },
  };
}

describe("probeSlackAuth", () => {
  it("maps a bot token's identity facts", async () => {
    const probe = await probeSlackAuth("xoxb-test", 2500, {
      accountId: "work",
      client: fakeAuthClient({
        ok: true,
        user_id: "U_BOT",
        bot_id: "B_BOT",
        team_id: "T1",
        api_app_id: "A1",
        user: "my-bot",
        team: "acme",
      }),
    });
    assert.ok(probe.ok);
    expect(probe.botUserId).toBe("U_BOT");
    expect(probe.botId).toBe("B_BOT");
    expect(probe.teamId).toBe("T1");
    expect(probe.apiAppId).toBe("A1");
    expect(probe.botName).toBe("my-bot");
    expect(probe.teamName).toBe("acme");
    expect(probe.warning).toBeUndefined();
  });

  it("warns when auth.test looks like a user token in the bot token slot", async () => {
    const probe = await probeSlackAuth("xoxp-user", 2500, {
      accountId: "work",
      client: fakeAuthClient({ ok: true, user_id: "U_USER", team_id: "T1" }),
    });
    assert.ok(probe.ok);
    expect(probe.botUserId).toBe("U_USER");
    expect(probe.botId).toBeUndefined();
    expect(probe.warning).toMatch(/user U_USER without bot_id/);
    expect(probe.warning).toMatch(/replace it with a Bot User OAuth Token/);
  });

  it("maps a failed auth.test to ok:false with the error", async () => {
    const probe = await probeSlackAuth("bad", 2500, {
      client: fakeAuthClient({ ok: false, error: "invalid_auth" }),
    });
    expect(probe.ok).toBe(false);
    expect(probe.error).toBe("invalid_auth");
  });

  it("maps a throwing auth.test to ok:false with the message", async () => {
    const probe = await probeSlackAuth("bad", 2500, {
      client: {
        auth: {
          test: async () => {
            throw new Error("network down");
          },
        },
        chat: {
          async postMessage() {
            return { ok: true };
          },
        },
      } as unknown as WebClient,
    });
    expect(probe.ok).toBe(false);
    expect(probe.error).toBe("network down");
  });
});
