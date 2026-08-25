import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createSlackBotClient } from "./client.js";

describe("Slack Web API client", () => {
  it("looks up an authored username with the workspace bot token", async () => {
    let request: { url: string; method: string | undefined } | undefined;
    const client = createSlackBotClient({
      tokenForWorkspace: () => Promise.resolve("xoxb-secret"),
      fetch: async (input, init) => {
        request = { url: requestUrl(input), method: init?.method };
        return Response.json({ ok: true, user: { name: "operator" } });
      },
    });

    assert.equal(
      await client.lookupUserName?.({ organizationId: "org-1", teamId: "T1", userId: "U1" }),
      "operator",
    );
    assert.deepEqual(request, {
      url: "https://slack.com/api/users.info",
      method: "POST",
    });
  });

  it("resolves the workspace token internally and checks Slack's ok field", async () => {
    const requests: Array<{ url: string; authorization: string | null; body: unknown }> = [];
    const authorities: Array<[string, string]> = [];
    const client = createSlackBotClient({
      tokenForWorkspace: (organizationId, teamId) => {
        authorities.push([organizationId, teamId]);
        return Promise.resolve(
          organizationId === "org-1" && teamId === "T1" ? "xoxb-secret" : undefined,
        );
      },
      fetch: async (input, init) => {
        requests.push({
          url: requestUrl(input),
          authorization: new Headers(init?.headers).get("authorization"),
          body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        });
        return Response.json({ ok: true });
      },
    });
    await client.sendMessage({
      organizationId: "org-1",
      teamId: "T1",
      channelId: "C1",
      threadTs: "1.1",
      content: "Hi",
    });
    assert.deepEqual(authorities, [["org-1", "T1"]]);
    assert.deepEqual(requests, [
      {
        url: "https://slack.com/api/chat.postMessage",
        authorization: "Bearer xoxb-secret",
        body: { channel: "C1", thread_ts: "1.1", text: "Hi" },
      },
    ]);

    const rejected = createSlackBotClient({
      tokenForWorkspace: () => Promise.resolve("xoxb-secret"),
      fetch: () => Promise.resolve(Response.json({ ok: false, error: "ratelimited" })),
    });
    await assert.rejects(
      () =>
        rejected.addReaction({
          organizationId: "org-1",
          teamId: "T1",
          channelId: "C1",
          messageTs: "1.1",
          name: "eyes",
        }),
      /Slack API ratelimited/u,
    );
  });

  it("fails closed without making a request when workspace ownership does not match", async () => {
    let fetches = 0;
    const client = createSlackBotClient({
      tokenForWorkspace: (organizationId, teamId) =>
        Promise.resolve(organizationId === "org-b" && teamId === "T1" ? "token-b" : undefined),
      fetch: () => {
        fetches += 1;
        return Promise.resolve(Response.json({ ok: true }));
      },
    });

    await assert.rejects(
      () =>
        client.removeReaction({
          organizationId: "org-a",
          teamId: "T1",
          channelId: "C1",
          messageTs: "1.1",
          name: "eyes",
        }),
      /not connected/u,
    );
    assert.equal(fetches, 0);
  });

  it("aborts a Slack API call that does not respond before its deadline", async () => {
    let requestSignal: AbortSignal | undefined;
    const client = createSlackBotClient({
      tokenForWorkspace: () => Promise.resolve("xoxb-secret"),
      requestTimeoutMs: 5,
      fetch: (_input, init) => {
        const signal = init?.signal;
        assert(signal instanceof AbortSignal);
        requestSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });

    await assert.rejects(
      () =>
        client.addReaction({
          organizationId: "org-1",
          teamId: "T1",
          channelId: "C1",
          messageTs: "1.1",
          name: "hourglass_flowing_sand",
        }),
      { name: "TimeoutError" },
    );
    assert.equal(requestSignal?.aborted, true);
  });

  it("hydrates the latest 50 preceding replies across Slack pagination, oldest first", async () => {
    const requests: Array<{ method: string; url: string; body: BodyInit | null | undefined }> = [];
    const messages = Array.from({ length: 455 }, (_, index) => {
      const sequence = index + 1;
      return {
        ts: `1700000000.${String(sequence).padStart(6, "0")}`,
        text: `reply-${sequence}`,
        ...(sequence === 455 ? { bot_id: "B455" } : { user: `U${sequence}` }),
      };
    });
    const pageSize = 100;
    const client = createSlackBotClient({
      tokenForWorkspace: () => Promise.resolve("xoxb-secret"),
      fetch: async (input, init) => {
        requests.push({
          method: init?.method ?? "GET",
          url: requestUrl(input),
          body: init?.body,
        });
        const cursor = new URL(requestUrl(input)).searchParams.get("cursor");
        const page = cursor === null ? 0 : Number(cursor.replace("page-", ""));
        const current = messages.slice(page * pageSize, (page + 1) * pageSize);
        return Response.json({
          ok: true,
          messages: current,
          response_metadata:
            (page + 1) * pageSize < messages.length
              ? { next_cursor: `page-${page + 1}` }
              : { next_cursor: "" },
        });
      },
    });

    const hydrated = await client.readThreadMessages?.({
      organizationId: "org-1",
      teamId: "T1",
      channelId: "C1",
      threadTs: "1700000000.000000",
      beforeTs: "1700000000.000456",
    });

    assert.equal(hydrated?.messages.length, 50);
    assert.equal(hydrated?.messages[0]?.content, "reply-406");
    assert.equal(hydrated?.messages.at(-1)?.content, "reply-455");
    assert.deepEqual(hydrated?.messages.at(-1)?.author, { id: "B455" });
    assert.equal(hydrated?.complete, true);
    assert.equal(requests.length, 5);
    assert.deepEqual(
      requests.map(({ method, body }) => ({ method, body })),
      Array.from({ length: 5 }, () => ({ method: "GET", body: undefined })),
    );
    const firstRequest = new URL(requests[0]!.url);
    assert.equal(firstRequest.searchParams.get("channel"), "C1");
    assert.equal(firstRequest.searchParams.get("ts"), "1700000000.000000");
    assert.equal(firstRequest.searchParams.get("latest"), "1700000000.000456");
    assert.equal(firstRequest.searchParams.get("inclusive"), "false");
    assert.equal(firstRequest.searchParams.get("limit"), "100");
    assert.deepEqual(
      requests.map(({ url }) => new URL(url).searchParams.get("cursor")),
      [null, "page-1", "page-2", "page-3", "page-4"],
    );
  });

  it("keeps earlier Slack replies when a later page is rate-limited", async () => {
    let requests = 0;
    const client = createSlackBotClient({
      tokenForWorkspace: () => Promise.resolve("xoxb-secret"),
      fetch: async () => {
        requests += 1;
        return requests === 1
          ? Response.json({
              ok: true,
              messages: [
                { ts: "1700000000.000001", text: "reply-1", user: "U1" },
                { ts: "1700000000.000002", text: "reply-2", user: "U2" },
              ],
              response_metadata: { next_cursor: "next-page" },
            })
          : Response.json({ ok: false, error: "ratelimited" });
      },
    });

    const hydrated = await client.readThreadMessages?.({
      organizationId: "org-1",
      teamId: "T1",
      channelId: "C1",
      threadTs: "1700000000.000000",
      beforeTs: "1700000000.000003",
    });

    assert.deepEqual(
      hydrated?.messages.map((message) => message.content),
      ["reply-1", "reply-2"],
    );
    assert.equal(hydrated?.complete, false);
    assert.equal(requests, 2);
  });

  it("keeps Slack file credentials and private URLs inside the client", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const client = createSlackBotClient({
      tokenForWorkspace: () => Promise.resolve("xoxb-secret"),
      fetch: async (input, init) => {
        requests.push({
          url: requestUrl(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        if (requestUrl(input).endsWith("files.info")) {
          return Response.json({
            ok: true,
            file: {
              id: "F1",
              url_private_download: "https://files.slack.com/files-pri/T1-F1/download/image.png",
            },
          });
        }
        return new Response("slack-image-bytes", {
          headers: { "content-type": "image/png", etag: '"file-1"' },
        });
      },
    });

    const response = await client.downloadAttachment?.({
      organizationId: "org-1",
      teamId: "T1",
      fileId: "F1",
    });

    assert.equal(await response?.text(), "slack-image-bytes");
    assert.deepEqual(requests, [
      { url: "https://slack.com/api/files.info", authorization: "Bearer xoxb-secret" },
      {
        url: "https://files.slack.com/files-pri/T1-F1/download/image.png",
        authorization: "Bearer xoxb-secret",
      },
    ]);
  });
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
}
