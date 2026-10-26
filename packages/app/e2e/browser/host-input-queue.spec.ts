import { waitForSettledPosition } from "../support/helpers/sheet-layout";
import { longPressSend } from "../support/helpers/queue-send-gesture";
import { writeFile } from "node:fs/promises";
import { attachImageFromMenu, attachFileFromMenu } from "../support/helpers/composer";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, test, disabledQueueProviders } from "../support/helpers/queue-fixture";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { getServerId } from "../support/helpers/server-id";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { pressQueueRowAction } from "../support/helpers/queue-row";

test.use({
  hasTouch: true,
  e2eDaemonConfig: {
    version: 1,
    agents: {
      providers: disabledQueueProviders,
    },
  },
});
for (const surface of ["agent", "direct", "group"] as const) {
  test(`${surface}: long-press one-off Queue and Steer, local editing, stale save and deliberate new item`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      if (!localStorage.getItem("cto021-queue-setting-seeded")) {
        const settings = JSON.parse(localStorage.getItem("@clisbot:app-settings") ?? "{}");
        localStorage.setItem(
          "@clisbot:app-settings",
          JSON.stringify({ ...settings, sendBehavior: "steer" }),
        );
        localStorage.setItem("cto021-queue-setting-seeded", "1");
      }
    });
    const client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: `host-queue-${surface}`,
    });
    let agentId: string | undefined;
    let chatId: string | undefined;
    let bot: Awaited<ReturnType<DaemonClient["createBot"]>>["bot"] | undefined = undefined;
    let workspace: Awaited<ReturnType<typeof seedMockAgentWorkspace>> | undefined;
    try {
      if (surface === "agent") {
        workspace = await seedMockAgentWorkspace({
          repoPrefix: "host-queue-",
          title: "Queue session fixture",
          model: "one-minute-stream",
        });
        agentId = workspace.agentId;
        await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId });
      } else {
        bot = (
          await client.createBot({
            name: `Queue ${surface} fixture`,
            launch: { provider: "mock", model: "one-minute-stream", modeId: "load-test" },
          })
        ).bot;
        expect(bot).toBeTruthy();
        chatId = (
          await client.createChat({
            botIds: [bot!.id],
            kind: surface,
            rules: { rounds: { max: 1 } },
          })
        ).chat!.id;
        await page.goto(`/h/${getServerId()}/chat/${chatId}`);
      }
      const scope = surface === "agent" ? page.locator("body") : page.getByTestId("chat-composer");
      const composer = scope.getByRole("textbox").last();
      await expect(composer).toBeEditable();
      await composer.fill("Start fixture work");
      await scope.getByTestId("composer-send-button").tap();
      await expect(page.getByTestId("turn-working-indicator").first()).toBeVisible();
      await attachImageFromMenu(page, {
        name: "queued.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
      await attachFileFromMenu(page, {
        name: "queue-note.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Durable browser file bytes"),
      });
      await expect(page.getByTestId("composer-file-attachment-pill")).toBeVisible();
      await composer.fill(surface === "direct" ? "" : "Queued draft A");
      const queue = (command: Parameters<DaemonClient["executeAgentQueueCommand"]>[0]["command"]) =>
        agentId
          ? client.executeAgentQueueCommand({ agentId, command })
          : client.executeChatQueueCommand({ chatId: chatId!, command });
      const priorMessages = await page.getByTestId("user-message").count();
      await longPressSend(page, scope);
      if (surface === "agent") {
        await expect(page.locator(".__expo_fast_refresh")).toHaveCount(0);
        await waitForSettledPosition(page.getByTestId("composer-send-once-steer"));
        await page.screenshot({
          path: info.outputPath("agent-touch-send-menu.png"),
          fullPage: false,
        });
      }
      await expect(composer).toHaveValue(surface === "direct" ? "" : "Queued draft A");
      expect(await page.getByTestId("user-message").count()).toBe(priorMessages);
      expect((await queue({ action: "fetch" })).queue!.items).toEqual([]);
      await page.touchscreen.tap(12, 12); // Dismiss via the sheet backdrop, not a send action.
      await expect(page.getByTestId("composer-send-once-queue")).toHaveCount(0);
      await expect(composer).toHaveValue(surface === "direct" ? "" : "Queued draft A");
      await expect(page.getByTestId("composer-file-attachment-pill")).toBeVisible();
      await expect(page.getByTestId("composer-image-attachment-pill")).toBeVisible();
      expect(await page.getByTestId("user-message").count()).toBe(priorMessages);
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("@clisbot:app-settings")!).sendBehavior,
        ),
      ).toBe("steer");
      await longPressSend(page, scope);
      await page.getByTestId("composer-send-once-queue").tap();
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("@clisbot:app-settings")!).sendBehavior,
        ),
      ).toBe("steer");
      const row = scope.locator('[data-testid^="host-queue-"]').first();
      await expect(row).toBeVisible();
      await expect(composer).toHaveValue("");
      const original = (await queue({ action: "fetch" })).queue!;
      const id = original.items[0].id;
      await pressQueueRowAction(page, row, "Edit");
      await expect(composer).toHaveValue(surface === "direct" ? "" : "Queued draft A");
      await expect(page.getByTestId("composer-file-attachment-pill")).toBeVisible();
      await expect(page.getByTestId("composer-image-attachment-pill")).toBeVisible();
      const opened = (await queue({ action: "fetch" })).queue!;
      expect(opened.revision).toBe(original.revision); // No Host edit state or lock.
      await scope.getByRole("button", { name: "Cancel edit", exact: true }).click();
      expect((await queue({ action: "fetch" })).queue!.revision).toBe(original.revision);
      await pressQueueRowAction(page, row, "Edit");
      await expect(page.getByTestId("composer-send-once-queue")).toHaveCount(0);
      await composer.fill("Edited draft in original position");
      await scope.getByRole("button", { name: "Save changes", exact: true }).first().click();
      await expect(scope.locator(`[data-testid="host-queue-${id}"]`)).toContainText(
        "Edited draft in original position",
      );
      await info.attach(`${surface}-queue`, {
        path: await page
          .screenshot({ path: info.outputPath(`${surface}-queue.png`), fullPage: false })
          .then(() => info.outputPath(`${surface}-queue.png`)),
        contentType: "image/png",
      });
      await page.evaluate(() => {
        const settings = JSON.parse(localStorage.getItem("@clisbot:app-settings") ?? "{}");
        localStorage.setItem(
          "@clisbot:app-settings",
          JSON.stringify({ ...settings, sendBehavior: "queue" }),
        );
      });
      await page.reload();
      await expect(scope.locator(`[data-testid="host-queue-${id}"]`)).toBeVisible();
      await composer.fill("Steer through the shared saved setting");
      await longPressSend(page, scope);
      await page.getByTestId("composer-send-once-steer").tap();
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("@clisbot:app-settings")!).sendBehavior,
        ),
      ).toBe("queue");
      await expect(
        page
          .getByTestId("user-message")
          .filter({ hasText: "Steer through the shared saved setting" }),
      ).toBeVisible();
      expect((await queue({ action: "fetch" })).queue!.items.map((item) => item.id)).toEqual([id]);
      await pressQueueRowAction(page, scope.locator(`[data-testid="host-queue-${id}"]`), "Edit");
      await composer.fill("Local draft survives the original handoff");
      const latest = (await queue({ action: "fetch" })).queue!;
      const sent = await queue({
        action: surface === "direct" ? "delete" : "send_now",
        id,
        revision: latest.revision,
      });
      expect(sent.error).toBeNull();
      await scope.getByRole("button", { name: "Save changes", exact: true }).first().click();
      await expect(composer).toHaveValue("Local draft survives the original handoff");
      await expect(
        scope.getByRole("button", { name: "Add as new item", exact: true }),
      ).toBeVisible();
      if (surface === "group") {
        await expect(scope.getByTestId("composer-send-button")).toBeDisabled();
        await expect(
          scope.getByRole("button", { name: "Move to end", exact: true }),
        ).toBeDisabled();
        await expect(scope.getByTestId("composer-send-button")).not.toHaveAttribute(
          "data-send-actions",
          "longpress",
        );
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(
          scope.getByRole("button", { name: "Add as new item", exact: true }),
        ).toBeInViewport();
        await expect(page.locator(".__expo_fast_refresh")).toHaveCount(0);
        const screenshotPath = info.outputPath("group-stale-editor-phone-web.png");
        await page.screenshot({ path: screenshotPath, fullPage: false });
        await info.attach("group-stale-editor-phone-web", {
          path: screenshotPath,
          contentType: "image/png",
        });
      }
      await scope.getByRole("button", { name: "Add as new item", exact: true }).click();
      await expect(composer).toHaveValue("");
      const newQueue = (await queue({ action: "fetch" })).queue!;
      expect(newQueue.items).toHaveLength(1);
      expect(newQueue.items[0].id).not.toBe(id);
      expect(newQueue.items[0].text).toBe("Local draft survives the original handoff");
      await pressQueueRowAction(
        page,
        scope.locator(`[data-testid="host-queue-${newQueue.items[0].id}"]`),
        "Delete",
      );
      await expect(scope.locator('[data-testid^="host-queue-"]')).toHaveCount(0);
      await writeFile(
        info.outputPath(`${surface}-provenance.json`),
        JSON.stringify(
          {
            surface,
            platform: "browser",
            viewport: page.viewportSize(),
            original,
            opened,
            sent,
            newQueue,
          },
          null,
          2,
        ),
      );
      await info.attach(`${surface}-provenance`, {
        body: JSON.stringify(
          {
            surface,
            platform: "browser",
            viewport: page.viewportSize(),
            configuredSetting: "steer -> one-off Queue; queue -> one-off Steer",
            original,
            opened,
            sent,
            newQueue,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
    } finally {
      if (chatId) await client.stopChatDiscussion(chatId).catch(() => {});
      if (agentId) await client.cancelAgent(agentId).catch(() => {});
      if (bot) {
        await client.archiveBot({ botId: bot.id });
        await client.removeProject(bot.projectId);
      }
      await workspace?.cleanup();
      await client.close();
    }
  });
}

test("settled Send menu fits the complete phone viewport", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "queue-menu-",
    title: "Send menu visual fixture",
  });
  try {
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: workspace.agentId });
    await page.getByRole("textbox").last().fill("Retained menu draft");
    await longPressSend(page, page.locator("body"));
    await expect(page.locator(".__expo_fast_refresh")).toHaveCount(0);
    await waitForSettledPosition(page.getByTestId("composer-send-once-steer"));
    const geometry = [];
    for (const action of ["queue", "steer"]) {
      const row = page.getByTestId(`composer-send-once-${action}`);
      const bounds = await row.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
      expect(bounds!.height).toBeGreaterThanOrEqual(48);
      const ownsTouch = await row.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return hit === node || (hit !== null && node.contains(hit));
      });
      expect(ownsTouch).toBe(true);
      geometry.push({ action, bounds, ownsTouch });
    }
    await writeFile(
      info.outputPath("menu-left-edge-dom.json"),
      JSON.stringify(
        await page.evaluate(() =>
          document
            .elementsFromPoint(20, 820)
            .slice(0, 8)
            .map((node) => ({ tag: node.tagName, html: node.outerHTML.slice(0, 2500) })),
        ),
        null,
        2,
      ),
    );
    await writeFile(
      info.outputPath("menu-overlay-dom.json"),
      JSON.stringify(
        await page.evaluate(() =>
          [...document.querySelectorAll("*")]
            .filter((node) => {
              const r = node.getBoundingClientRect();
              return r.x < 50 && r.y > 750 && r.width < 110 && r.height < 100;
            })
            .map((node) => ({
              html: node.outerHTML.slice(0, 3000),
              parent: node.parentElement?.outerHTML.slice(0, 3000),
              style: getComputedStyle(node).cssText,
            })),
        ),
        null,
        2,
      ),
    );
    await page.screenshot({
      path: info.outputPath("agent-send-menu-settled.png"),
      fullPage: false,
    });
    await writeFile(
      info.outputPath("settled-menu-geometry.json"),
      JSON.stringify(
        { platform: "Chromium phone web", viewport: page.viewportSize(), geometry },
        null,
        2,
      ),
    );
    await page.touchscreen.tap(12, 12);
    await expect(page.getByRole("textbox").last()).toHaveValue("Retained menu draft");
  } finally {
    await workspace.cleanup();
  }
});
