import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import { z } from "zod";
import { HubHarness } from "../daemons/test-utils/hub-harness.js";

const describeHubE2E = process.env["RUN_HUB_E2E"] === "1" ? describe : describe.skip;

describeHubE2E("Hub provider attachment capability journey", () => {
  let hub: HubHarness;

  beforeEach(async () => {
    hub = await HubHarness.start();
    await hub.connectDaemon();
    const installed = await hub.installConfiguration({ yaml: hub.slackConfigurationYaml() });
    if (installed.status !== 201)
      throw new Error(`Slack config install failed: ${JSON.stringify(installed)}`);
  }, 120_000);

  afterEach(async () => {
    await hub?.stop();
  }, 120_000);

  it("dispatches Slack context and downloads the image from the materialized Hub URL", async () => {
    const response = await hub.deliverSlackMention();
    assert.equal(response.status, 200);

    const launch = await hub.waitForCreatedAgentLaunch();
    if (typeof launch.prompt !== "string") throw new Error("daemon prompt was not captured");
    const prompt = launch.prompt;
    assert.match(prompt, /inspect this image/u);
    assert.doesNotMatch(prompt, /files\.slack\.com|xoxb/u);

    const contextStart = prompt.lastIndexOf("Context: ");
    assert.notEqual(contextStart, -1);
    const context = SlackContextSchema.parse(
      JSON.parse(prompt.slice(contextStart + "Context: ".length)),
    );
    const attachment = context.slack.thread.messages[0]?.attachments[0];
    assert.deepEqual(
      attachment === undefined
        ? undefined
        : {
            filename: attachment.filename,
            content_type: attachment.content_type,
            size: attachment.size,
          },
      { filename: "diagram.png", content_type: "image/png", size: 19 },
    );
    const downloadUrl = attachment?.url;
    assert(downloadUrl);
    const image = await fetch(downloadUrl);
    assert.equal(image.status, 200);
    assert.equal(await image.text(), "diagram-image-bytes");
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal(image.headers.get("etag"), '"diagram-1"');
  }, 120_000);
});

const SlackContextSchema = z.object({
  slack: z.object({
    thread: z.object({
      messages: z.array(
        z.object({
          attachments: z.array(
            z.object({
              filename: z.string(),
              content_type: z.string().nullable(),
              size: z.number(),
              url: z.url(),
            }),
          ),
        }),
      ),
    }),
  }),
});
