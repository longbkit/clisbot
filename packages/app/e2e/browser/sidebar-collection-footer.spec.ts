import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { openMobileAgentSidebar } from "../support/helpers/sidebar";
import { createTempDirectory } from "../support/helpers/workspace";

for (const width of [1440, 390]) {
  test(`Bot and group chat footers expand in place and open directories at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const home = await createTempDirectory("clisbot-e2e-collection-footer-");
    const client = await connectDaemonClient<
      Pick<
        DaemonClient,
        | "createBot"
        | "archiveBot"
        | "removeProject"
        | "createChat"
        | "archiveChat"
        | "close"
        | "connect"
      >
    >({ clientIdPrefix: "collection-footer" });
    const bots: { id: string; projectId: string }[] = [];
    const chats: string[] = [];
    try {
      for (let index = 0; index < 7; index++) {
        const result = await client.createBot({
          name: `Footer bot ${index}`,
          path: `${home.path}/bot-${index}`,
          launch: { provider: "mock", model: "e2e-fast-stream", modeId: "load-test" },
        });
        if (!result.bot || result.error) throw new Error(result.error ?? "Bot creation failed");
        bots.push(result.bot);
      }
      for (let index = 0; index < 7; index++) {
        const result = await client.createChat({
          title: `Footer group ${index}`,
          kind: "group",
          botIds: [bots[0]!.id],
        });
        if (!result.chat || result.error) throw new Error(result.error ?? "Chat creation failed");
        chats.push(result.chat.id);
      }
      await gotoAppShell(page);
      if (width < 600) await openMobileAgentSidebar(page);
      for (const section of ["bots", "chats"]) {
        const rows = page.getByTestId(`sidebar-${section}-section`);
        const footer = page.getByTestId(`sidebar-${section}-footer`);
        const toggle = page.getByTestId(`sidebar-${section}-footer-toggle`);
        const all = footer.getByRole("button", { name: "View all (7)", exact: true });
        const titles = rows.getByText(section === "bots" ? /^Footer bot \d$/ : /^Footer group \d$/);
        await expect(titles).toHaveCount(5);
        await toggle.scrollIntoViewIfNeeded();
        const left = await toggle.boundingBox();
        const right = await all.boundingBox();
        expect(left).not.toBeNull();
        expect(right).not.toBeNull();
        expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x);
        expect(Math.abs(left!.y - right!.y)).toBeLessThan(2);
        await toggle.click();
        await expect(titles).toHaveCount(7);
        await expect(toggle).toHaveAttribute("aria-label", "Show less");
        await toggle.click();
        await expect(titles).toHaveCount(5);
        await testInfo.attach(`${section}-footer-${width}`, {
          body: await page.screenshot({
            path: testInfo.outputPath(`${section}-footer-${width}.png`),
          }),
          contentType: "image/png",
        });
        await all.click();
        if (section === "bots") {
          await expect(
            page.getByRole("textbox", { name: "Search bots or Hosts", exact: true }),
          ).toBeVisible();
          await page.getByRole("button", { name: "Close", exact: true }).last().click();
        } else {
          const lastChat = page.getByTestId(`sidebar-chat-${chats[0]}`).last();
          await expect(lastChat).toBeVisible();
          await lastChat.click();
          await expect(page).toHaveURL((url) => url.pathname.endsWith(`/chat/${chats[0]}`));
        }
      }
    } finally {
      for (const chatId of chats) await client.archiveChat({ chatId });
      for (const bot of bots) {
        await client.archiveBot({ botId: bot.id });
        await client.removeProject(bot.projectId);
      }
      await client.close();
      await home.cleanup();
    }
  });
}
