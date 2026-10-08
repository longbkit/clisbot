import { describe, expect, it } from "vitest";
import { catalogFixtureEntry } from "./channel-catalog.fixture";
import {
  channelConnectionProblem,
  connectableChannelEntries,
  connectionNamesFor,
  defaultConnectionName,
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
  it("asks a token channel for one secret and a Connection name", () => {
    const model = openForm("telegram");
    expect(fieldKeys("telegram")).toEqual(["botToken"]);
    expect(model.getState().accountId).toBe("telegram");
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

  it("gives Feishu its long-connection credentials and domain, no webhook secrets", () => {
    expect(fieldKeys("feishu")).toEqual(["appId", "appSecret", "domain"]);
  });

  it("shows one Google Chat field at a time, chosen by the source toggle", () => {
    const model = openForm("googlechat");
    expect(model.getState().serviceAccountSource).toBe("paste");
    expect(model.getState().fields.map((field) => field.key)).toEqual([
      "serviceAccount",
      "subscription",
    ]);
    model.setServiceAccountSource("file");
    expect(model.getState().fields.map((field) => field.key)).toEqual([
      "serviceAccountFile",
      "subscription",
    ]);
  });

  it("names no account for Slack, whose Connection is named by the app", () => {
    const model = openForm("slack");
    expect(model.getState().accountId).toBeNull();
    expect(fieldKeys("slack")).toEqual(["appToken", "botToken"]);
  });
});

describe("suggested Connection name", () => {
  it("is the channel's id, numbered past the names its Connections use", () => {
    expect(defaultConnectionName("telegram", [])).toBe("telegram");
    expect(defaultConnectionName("telegram", ["telegram", "telegram-2"])).toBe("telegram-3");
  });

  it("moves past a name the list brings in later, until the person edits it", () => {
    const model = openChannelConnectionForm(catalogFixtureEntry("telegram"));
    expect(model.getState().accountId).toBe("telegram");
    model.setTakenNames(["telegram"]);
    expect(model.getState()).toMatchObject({
      accountId: "telegram-2",
      accountIdSuggestion: "telegram-2",
    });
    model.setAccountId("support");
    model.setTakenNames(["telegram", "telegram-2"]);
    expect(model.getState().accountId).toBe("support");
  });

  it("refuses a taken name, which would replace that Connection's token", () => {
    const model = openChannelConnectionForm(catalogFixtureEntry("telegram"), ["support"]);
    model.setField("botToken", "123:ABC");
    model.setAccountId("support");
    expect(model.getState().accountIdError).toBe(
      "Another Telegram Connection already uses this name.",
    );
    expect(model.requestBody()).toBeNull();
  });

  it("counts only the same channel's Connections", () => {
    const connections = [
      { provider: "telegram", name: "telegram" },
      { provider: "discord", name: "discord" },
    ];
    expect(connectionNamesFor("telegram", connections)).toEqual(["telegram"]);
  });
});

describe("transports a Connection can use", () => {
  it("offers no webhook transport, so there is nothing to choose", () => {
    for (const channel of ["slack", "telegram", "googlechat", "feishu", "zalo"]) {
      const model = openForm(channel);
      expect(model.getState().transports.map(({ id }) => id)).not.toContain("webhook");
      model.setTransport("webhook");
      expect(model.getState().transportId).not.toBe("webhook");
    }
  });

  it("does not ask for a secret only webhook mode needs", () => {
    expect(fieldKeys("zalo")).not.toContain("webhookSecret");
    expect(fieldKeys("telegram")).toEqual(["botToken"]);
  });

  it("still requires Google Chat's subscription for Cloud Pub/Sub", () => {
    const model = openForm("googlechat");
    expect(model.getState().transportId).toBe("pubsub");
    expect(model.getState().fields.find((field) => field.key === "subscription")).toMatchObject({
      required: true,
      label: "Pub/Sub subscription",
    });
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

  it("rejects a service account that is not one", () => {
    const model = openForm("googlechat");
    model.setField("serviceAccount", "not json");
    expect(model.getState().fields[0]?.error).toBe("This is not valid JSON.");
    model.setField("serviceAccount", '{"type":"authorized_user"}');
    expect(model.getState().fields[0]?.error).toBe(
      'The document\'s "type" must be "service_account".',
    );
  });

  it("requires a Connection name of at most 128 characters", () => {
    const model = openForm("telegram");
    model.setAccountId("   ");
    expect(model.getState().accountIdError).toBe("Enter a Connection name.");
    model.setAccountId("a".repeat(129));
    expect(model.getState().accountIdError).toBe("Use 128 characters or fewer.");
  });
});

describe("submission", () => {
  it("adds a Zalo Personal Connection by name alone: the QR scan comes later", () => {
    const model = openForm("zalouser");
    expect(model.getState()).toMatchObject({ setup: "qr", fields: [] });
    model.setAccountId("");
    expect(model.requestBody()).toBeNull();
    model.setAccountId("main");
    expect(model.requestBody()).toEqual({
      provider: "zalouser",
      accountId: "main",
      credentials: {},
    });
  });

  it("adds a WhatsApp Connection by its name alone, which the Hub also uses as its label", () => {
    const model = openForm("whatsapp");
    expect(model.getState()).toMatchObject({ setup: "qr", fields: [] });
    model.setAccountId("support");
    expect(model.requestBody()).toEqual({
      provider: "whatsapp",
      accountId: "support",
      credentials: {},
    });
  });

  it("can be submitted with its suggested name", () => {
    const model = openChannelConnectionForm(catalogFixtureEntry("zalouser"), ["zalouser"]);
    expect(model.requestBody()).toEqual({
      provider: "zalouser",
      accountId: "zalouser-2",
      credentials: {},
    });
  });

  it("refuses a body until the form is complete", () => {
    const model = openForm("telegram");
    model.setAccountId("");
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
      credentials: { appId: "cli_1", appSecret: "secret", domain: "lark" },
    });
    model.setField("domain", "feishu");
    expect(model.requestBody()).toMatchObject({ credentials: { domain: "feishu" } });
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
  it("offers the QR channel and, without the authority, leaves out the Provider Application one", () => {
    expect(
      connectableChannelEntries(CHANNEL_CATALOG_FIXTURE, {
        allowProviderApplications: false,
      }).map((entry) => entry.id),
    ).toEqual(["telegram", "discord", "googlechat", "feishu", "zalouser", "whatsapp", "zalo"]);
  });

  it("adds Slack for an instance operator", () => {
    expect(
      connectableChannelEntries(CHANNEL_CATALOG_FIXTURE, {
        allowProviderApplications: true,
      }).map((entry) => entry.id),
    ).toEqual([
      "slack",
      "telegram",
      "discord",
      "googlechat",
      "feishu",
      "zalouser",
      "whatsapp",
      "zalo",
    ]);
  });

  it("leaves out a channel this build has no request body for", () => {
    const unknown = { ...CHANNEL_CATALOG_FIXTURE[1]!, id: "matrix", label: "Matrix" };
    expect(connectableChannelEntries([unknown], { allowProviderApplications: true })).toEqual([]);
  });
});
