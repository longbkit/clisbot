import { describe, expect, it } from "vitest";
import { catalogFixtureEntry } from "./channel-catalog.fixture";
import {
  channelConnectionProblem,
  connectableChannelEntries,
  openChannelConnectionForm,
} from "./channel-connection-form";
import { CHANNEL_CATALOG_FIXTURE } from "./channel-catalog.fixture";

function openForm(channel: string) {
  return openChannelConnectionForm(catalogFixtureEntry(channel));
}

function fieldKeys(channel: string): string[] {
  return openForm(channel)
    .getState()
    .fields.map((field) => field.key);
}

describe("field shape per channel", () => {
  it("asks a token channel for one secret and an account name", () => {
    const model = openForm("telegram");
    expect(fieldKeys("telegram")).toEqual(["botToken"]);
    expect(model.getState().accountId).toBe("");
    expect(model.getState().fields[0]).toMatchObject({
      label: "Bot token",
      kind: "secret",
      required: true,
    });
  });

  it("maps Discord's catalog credential name onto the Connection body's", () => {
    const model = openForm("discord");
    expect(fieldKeys("discord")).toEqual(["botToken"]);
    // The label still comes from the catalog credential, which is called `token`.
    expect(model.getState().fields[0]?.label).toBe("Bot token");
  });

  it("gives Feishu every credential the Hub accepts, plus its domain", () => {
    expect(fieldKeys("feishu")).toEqual([
      "appId",
      "appSecret",
      "verificationToken",
      "encryptKey",
      "domain",
    ]);
  });

  it("shows one Google Chat field at a time, chosen by the source toggle", () => {
    const model = openForm("googlechat");
    expect(model.getState().serviceAccountSource).toBe("paste");
    expect(model.getState().fields.map((field) => field.key)).toEqual(["serviceAccount"]);
    model.setServiceAccountSource("file");
    expect(model.getState().fields.map((field) => field.key)).toEqual(["serviceAccountFile"]);
  });

  it("names no account for Slack, whose Connection is named by the app", () => {
    const model = openForm("slack");
    expect(model.getState().accountId).toBeNull();
    expect(fieldKeys("slack")).toEqual(["appToken", "botToken"]);
  });
});

describe("transport-driven requirements", () => {
  it("requires Zalo's webhook secret only in webhook mode", () => {
    const model = openForm("zalo");
    expect(model.getState().transportId).toBe("polling");
    expect(model.getState().fields[1]).toMatchObject({ key: "webhookSecret", required: false });
    model.setTransport("webhook");
    expect(model.getState().fields[1]).toMatchObject({ key: "webhookSecret", required: true });
  });

  it("requires Feishu's webhook verification fields only in webhook mode", () => {
    const model = openForm("feishu");
    const required = () =>
      model
        .getState()
        .fields.filter((field) => field.required)
        .map((field) => field.key);
    expect(required()).toEqual(["appId", "appSecret", "domain"]);
    model.setTransport("webhook");
    expect(required()).toEqual(["appId", "appSecret", "verificationToken", "encryptKey", "domain"]);
  });
});

describe("validation", () => {
  it("stays quiet until a field is touched", () => {
    const model = openForm("telegram");
    expect(model.getState().fields[0]?.error).toBeNull();
    expect(model.getState().accountIdError).toBeNull();
    model.setField("botToken", "");
    expect(model.getState().fields[0]?.error).toBe("This is required.");
  });

  it("checks the prefixes the Hub schema enforces", () => {
    const model = openForm("slack");
    model.setField("appToken", "xoxb-nope");
    expect(model.getState().fields[0]?.error).toBe("This must start with xapp-.");
    expect(model.getState().canSubmit).toBe(false);
  });

  it("bounds the Zalo webhook secret", () => {
    const model = openForm("zalo");
    model.setTransport("webhook");
    model.setField("webhookSecret", "short");
    expect(model.getState().fields[1]?.error).toBe("Use at least 8 characters.");
  });

  it("rejects a service account that is not one", () => {
    const model = openForm("googlechat");
    model.setField("serviceAccount", "not json");
    expect(model.getState().fields[0]?.error).toBe("This is not valid JSON.");
    model.setField("serviceAccount", '{"type":"authorized_user"}');
    expect(model.getState().fields[0]?.error).toBe(
      'The document\'s "type" must be "service_account".',
    );
  });

  it("requires an account name of at most 128 characters", () => {
    const model = openForm("telegram");
    model.setAccountId("   ");
    expect(model.getState().accountIdError).toBe("Enter an account name.");
    model.setAccountId("a".repeat(129));
    expect(model.getState().accountIdError).toBe("Use 128 characters or fewer.");
  });
});

describe("submission", () => {
  it("refuses a body until the form is complete", () => {
    const model = openForm("telegram");
    expect(model.requestBody()).toBeNull();
    model.setAccountId("support");
    expect(model.requestBody()).toBeNull();
    model.setField("botToken", " 123:ABC ");
    expect(model.getState().canSubmit).toBe(true);
    expect(model.requestBody()).toEqual({
      provider: "telegram",
      accountId: "support",
      credentials: { botToken: "123:ABC" },
    });
  });

  it("omits an empty optional credential", () => {
    const model = openForm("zalo");
    model.setAccountId("shop");
    model.setField("botToken", "token");
    expect(model.requestBody()).toEqual({
      provider: "zalo",
      accountId: "shop",
      credentials: { botToken: "token" },
    });
  });

  it("builds the Slack Socket Mode body without an account name", () => {
    const model = openForm("slack");
    model.setField("appToken", "xapp-1");
    model.setField("botToken", "xoxb-1");
    expect(model.requestBody()).toEqual({
      provider: "slack",
      transport: "socket",
      credentials: { appToken: "xapp-1", botToken: "xoxb-1" },
    });
  });

  it("carries the Feishu domain choice with its default", () => {
    const model = openForm("feishu");
    model.setAccountId("acme");
    model.setField("appId", "cli_1");
    model.setField("appSecret", "secret");
    expect(model.requestBody()).toMatchObject({
      credentials: { appId: "cli_1", appSecret: "secret", domain: "feishu" },
    });
    model.setField("domain", "lark");
    expect(model.requestBody()).toMatchObject({ credentials: { domain: "lark" } });
  });

  it("never publishes a secret value in the rendered state", () => {
    const model = openForm("telegram");
    model.setField("botToken", "123:SECRET");
    const published = JSON.stringify(model.getState());
    expect(published).not.toContain("123:SECRET");
    expect(model.getState().fields[0]).toMatchObject({ value: null, filled: true });
  });

  it("blocks submission while a request is in flight", () => {
    const model = openForm("telegram");
    model.setAccountId("support");
    model.setField("botToken", "123:ABC");
    model.setSubmitting(true);
    expect(model.getState().canSubmit).toBe(false);
    model.setProblem({ title: "t", detail: "d", hint: null, retryable: true });
    expect(model.getState().submitting).toBe(false);
    expect(model.getState().canSubmit).toBe(true);
  });

  it("notifies subscribers and stops after close", () => {
    const model = openForm("telegram");
    let notified = 0;
    const unsubscribe = model.subscribe(() => {
      notified += 1;
    });
    model.setAccountId("a");
    expect(notified).toBe(1);
    unsubscribe();
    model.setAccountId("b");
    expect(notified).toBe(1);
    model.close();
  });
});

describe("Hub problems become guidance", () => {
  const telegram = catalogFixtureEntry("telegram");

  it("separates a rejected credential from an unreachable provider", () => {
    expect(
      channelConnectionProblem(telegram, {
        status: 422,
        code: "connection_unavailable",
        message: "the telegram API rejected the token",
      }),
    ).toMatchObject({ title: "The provider rejected this credential", retryable: false });
    expect(
      channelConnectionProblem(telegram, {
        status: 502,
        code: "connection_unavailable",
        message: "the telegram API did not answer",
      }),
    ).toMatchObject({ title: "Telegram could not be reached", retryable: true });
  });

  it("reads a 404 as a Hub that does not ship this channel", () => {
    expect(
      channelConnectionProblem(catalogFixtureEntry("zalouser"), {
        status: 404,
        code: "not_found",
        message: "No management resource matches this path.",
      }),
    ).toMatchObject({
      title: "Zalo Personal connections are not available on this Hub",
      retryable: false,
    });
  });

  it("falls back without inventing a cause", () => {
    expect(
      channelConnectionProblem(undefined, { status: 400, code: "bad", message: "nope" }),
    ).toEqual({
      title: "The Hub refused this request",
      detail: "nope",
      hint: null,
      retryable: false,
    });
  });
});

describe("which channels the Accounts view can offer", () => {
  it("leaves out the QR channel and, without the authority, the Provider Application one", () => {
    expect(
      connectableChannelEntries(CHANNEL_CATALOG_FIXTURE, {
        allowProviderApplications: false,
      }).map((entry) => entry.id),
    ).toEqual(["telegram", "discord", "googlechat", "feishu", "zalo"]);
  });

  it("adds Slack for an instance operator", () => {
    expect(
      connectableChannelEntries(CHANNEL_CATALOG_FIXTURE, {
        allowProviderApplications: true,
      }).map((entry) => entry.id),
    ).toEqual(["slack", "telegram", "discord", "googlechat", "feishu", "zalo"]);
  });

  it("leaves out a channel this build has no request body for", () => {
    const unknown = { ...CHANNEL_CATALOG_FIXTURE[1]!, id: "matrix", label: "Matrix" };
    expect(connectableChannelEntries([unknown], { allowProviderApplications: true })).toEqual([]);
  });
});
