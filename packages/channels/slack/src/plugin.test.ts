// The drive surface after slice 10b: the Hub reads `plugin.actions` as the
// account's `ChannelMessageActionAdapter` (`packages/hub/src/channels/message-actions.ts`
// `readPluginMessageActions`) and dispatches every non-`send` action through
// `handleAction`. These cases pin what that adapter advertises and that the
// upstream send primitives are reachable from `plugin.outbound`.

import { describe, expect, it } from "vitest";
import { slackMessageActions, slackPlugin } from "./plugin.js";
import { SLACK_PRESENTATION_CAPABILITIES } from "./presentation.js";

const CFG = {
  channels: {
    slack: {
      accounts: {
        work: { botToken: "xoxb-plugin-surface" },
      },
    },
  },
} as never;

describe("slackPlugin drive surface", () => {
  it("exposes the upstream message-action adapter under both spellings", () => {
    expect(slackPlugin.actions).toBe(slackMessageActions);
    expect(slackPlugin.messageActions).toBe(slackMessageActions);
    expect(typeof slackMessageActions.describeMessageTool).toBe("function");
    expect(typeof slackMessageActions.handleAction).toBe("function");
    expect(typeof slackMessageActions.extractToolSend).toBe("function");
    expect(typeof slackMessageActions.prepareSendPayload).toBe("function");
  });

  it("declares the vertical's presentation capabilities on its outbound surface", () => {
    // Upstream's `slackOutbound.presentationCapabilities`
    // (`extensions/slack/src/outbound-adapter.ts@5d8067a4483:259`): the same
    // constant, so core's presentation adaptation and the Hub's `sendText`
    // path agree on what Slack renders natively (D-W6-01).
    expect(slackPlugin.outbound?.["presentationCapabilities"]).toBe(SLACK_PRESENTATION_CAPABILITIES);
    expect(SLACK_PRESENTATION_CAPABILITIES.charts).toBe(true);
    expect(SLACK_PRESENTATION_CAPABILITIES.tables).toBe(true);
  });

  it("advertises the configured action set for an account with a bot token", () => {
    const discovery = slackMessageActions.describeMessageTool({
      cfg: CFG,
      accountId: "work",
    });
    expect(discovery?.actions).toEqual(
      expect.arrayContaining([
        "send",
        "react",
        "reactions",
        "read",
        "edit",
        "delete",
        "pin",
        "unpin",
        "list-pins",
        "upload-file",
        "download-file",
        "conversation-open",
        "member-info",
        "emoji-list",
      ]),
    );
  });

  it("advertises nothing for an account with no credential", () => {
    const discovery = slackMessageActions.describeMessageTool({
      cfg: { channels: { slack: { accounts: { work: {} } } } } as never,
      accountId: "work",
    });
    expect(discovery?.actions ?? []).toEqual([]);
  });

  it("exposes the upstream send primitives alongside the Fusion drive verbs", () => {
    const outbound = slackPlugin.outbound as Record<string, unknown>;
    for (const name of [
      "sendText",
      "sendMedia",
      "typing",
      "updateText",
      "sendMessageSlack",
      "updateMessageSlack",
      "reconcileSlackUnknownSend",
      "sendSlackMessage",
      "editSlackMessage",
      "deleteSlackMessage",
      "reactSlackMessage",
      "removeSlackReaction",
      "pinSlackMessage",
      "unpinSlackMessage",
      "listSlackPins",
      "readSlackMessages",
      "openSlackConversation",
      "getSlackMemberInfo",
      "listSlackEmojis",
      "downloadSlackFile",
      "uploadSlackFile",
    ]) {
      expect(typeof outbound[name], name).toBe("function");
    }
  });
});
