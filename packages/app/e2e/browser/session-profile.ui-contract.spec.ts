import { expect, test } from "../support/fixtures";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import {
  readScrollMetrics,
  scrollChatAwayFromBottom,
} from "../support/helpers/agent-bottom-anchor";
import { expectComposerDraft, fillComposerDraft } from "../support/helpers/composer";
import {
  openAgentTimeline,
  seedLongMockAgentTimeline,
} from "../support/helpers/timeline-pagination";

// This is the app's route/retained-pane contract, not identity admission proof.
// The daemon fixture provides real history; the WebSocket boundary adds authorized
// snapshot fields as a capable daemon would. No app stores/components are replaced.
const actor = {
  kind: "user",
  id: "slack:profile-review",
  displayName: "Profile review",
  hubOrigin: "https://fixture-hub.example",
  organizationId: "fixture-org",
  connectionId: "fixture-slack",
  memberId: "fixture-member",
};
function addSnapshot(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(addSnapshot);
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.type === "user_message" || record.kind === "user_message") record.sender = actor;
  for (const nested of Object.values(record)) addSnapshot(nested);
}

test("profile tab preserves chat draft and reading position in the workspace route", async ({
  page,
}) => {
  test.setTimeout(240_000);
  expect(
    process.env.PASEO_AGENT_SESSION_STORAGE,
    "Run this contract with the actual durable backend enabled",
  ).toBe("1");
  const session = await seedLongMockAgentTimeline({ turns: 30 });
  try {
    await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        const raw = typeof message === "string" ? message : message.toString();
        try {
          const frame: unknown = JSON.parse(raw);
          addSnapshot(frame);
          socket.send(JSON.stringify(frame));
        } catch {
          socket.send(message);
        }
      });
    });
    await page.setViewportSize({ width: 1200, height: 800 });
    await openAgentTimeline(page, session);
    await fillComposerDraft(page, "Keep this unsent draft while reading a profile");
    await scrollChatAwayFromBottom(page, { deltaY: -450, minDistanceFromBottom: 150 });
    const author = page
      .getByRole("button", { name: /Open profile: Profile review/ })
      .filter({ visible: true })
      .last();
    await author.scrollIntoViewIfNeeded();
    const before = await readScrollMetrics(page);
    await author.click();
    await expect(page.getByTestId("user-profile-panel")).toBeVisible();
    await expect(page.getByTestId("user-profile-panel")).toContainText("fixture-member");
    const profileScreenshot = test.info().outputPath("workspace-profile.png");
    await page.screenshot({ path: profileScreenshot });
    await test
      .info()
      .attach("workspace-profile", { path: profileScreenshot, contentType: "image/png" });
    await page
      .getByTestId(`workspace-tab-agent_${session.agentId}`)
      .filter({ visible: true })
      .first()
      .click();
    await expectComposerDraft(page, "Keep this unsent draft while reading a profile");
    await expect
      .poll(async () => Math.abs((await readScrollMetrics(page)).offsetY - before.offsetY))
      .toBeLessThanOrEqual(24);
    const restoredScreenshot = test.info().outputPath("workspace-chat-restored.png");
    await page.screenshot({ path: restoredScreenshot });
    await test
      .info()
      .attach("workspace-chat-restored", { path: restoredScreenshot, contentType: "image/png" });
    await author.click();
    await expect(
      page.locator('[data-testid^="workspace-tab-user_profile_"]').filter({ visible: true }),
    ).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId("user-profile-panel")).toBeVisible();
    await expect(page.getByTestId("user-profile-panel")).toContainText("fixture-member");
    await page
      .getByTestId(`workspace-tab-agent_${session.agentId}`)
      .filter({ visible: true })
      .first()
      .click();
    await expectComposerDraft(page, "Keep this unsent draft while reading a profile");
  } finally {
    await session.cleanup();
  }
});
