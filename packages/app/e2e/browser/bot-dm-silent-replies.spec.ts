import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { getServerId } from "../support/helpers/server-id";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { TranscriptLog } from "../../../server/src/server/chats/transcript-log";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import type { ChatMessageSender } from "@clisbot/protocol/chats/types";

// Never invoke the machine's real Tailscale during isolated Bot tests.
test.use({ e2eDaemonEnvironment: { CLISBOT_TAILSCALE_BIN: process.execPath } });
test.describe.configure({ timeout: 120_000 });

for (const kind of ["group", "direct"] as const) {
  for (const marker of ["HEARTBEAT_OK", "PASS"]) {
    test(`${kind} hides completed boundary-prefixed ${marker} on the real Messages route`, async ({
      page,
    }, testInfo) => {
      const frames: unknown[] = [];
      const frameTypes: unknown[] = [];
      await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
        const server = socket.connectToServer();
        socket.onMessage((message) => server.send(message));
        server.onMessage((payload) => {
          const envelope = JSON.parse(String(payload));
          const message = envelope.type === "session" ? envelope.message : envelope;
          if (message.type === "status" && message.payload?.status === "server_info") {
            frames.push({
              type: "fixture.server_info",
              version: message.payload.version,
              protocolVersion: message.payload.protocolVersion,
              bots: message.payload.features?.bots,
            });
          }
          frameTypes.push({
            type: envelope.type,
            messageType: message.type,
            keys: Object.keys(message),
          });
          if (
            [
              "agent_stream",
              "fetch_agent_timeline_response",
              "chat.updated",
              "chat.transcript.appended",
            ].includes(message.type)
          )
            frames.push(message);
          socket.send(payload);
        });
      });
      const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "silent-reply" });
      const created = await client.createBot({
        name: "Silence fixture",
        launch: {
          provider: "mock",
          model: "e2e-fast-stream",
          modeId: "load-test",
          // Codex emits this exact prefix on a new assistant-message boundary.
          featureValues: { mockAssistantResponses: ["Fixture ready", `\n\n---\n\n${marker}`] },
        },
      });
      if (!created.bot) throw new Error(created.error ?? "Bot creation failed");
      const bot = created.bot;
      let chatId: string | undefined;
      try {
        const result = await client.createChat({ botIds: [bot.id], kind });
        if (!result.chat) throw new Error(result.error ?? "Chat creation failed");
        chatId = result.chat.id;
        await page.goto(`/h/${getServerId()}/chat/${chatId}`);
        const screen = page.getByTestId(`chat-screen-${chatId}`);
        const composer = screen.getByRole("textbox");
        await expect(composer).toBeEditable();
        await composer.fill("Open fixture session");
        await composer.press("Enter");
        await expect(screen.getByText("Fixture ready", { exact: true })).toBeVisible();
        await expect
          .poll(() =>
            frames.some((frame) => {
              const message = frame as {
                type: string;
                payload?: { entries?: unknown[]; event?: { item?: { text?: string } } };
              };
              return (
                (message.type === "fetch_agent_timeline_response" &&
                  JSON.stringify(message.payload?.entries).includes("Fixture ready")) ||
                (message.type === "agent_stream" &&
                  message.payload?.event?.item?.text === "Fixture ready")
              );
            }),
          )
          .toBe(true);
        const chatRecordPath = path.join(
          process.env.E2E_CLISBOT_HOME!,
          "chats",
          chatId,
          "chat.json",
        );
        const previousTurnId = JSON.parse(await readFile(chatRecordPath, "utf8")).participants[0]
          ?.completedTurn?.turnId;
        const completionCount = () =>
          frames.filter((frame) => {
            const message = frame as { type: string; payload?: { event?: { type?: string } } };
            return (
              message.type === "agent_stream" && message.payload?.event?.type === "turn_completed"
            );
          }).length;
        const previousCompletions = completionCount();
        await composer.fill("Check fixture status");
        await composer.press("Enter");
        await expect(screen.getByText("Check fixture status", { exact: true })).toBeVisible();
        await expect
          .poll(async () => {
            const stored = JSON.parse(await readFile(chatRecordPath, "utf8"));
            const turnId = stored.participants[0]?.completedTurn?.turnId;
            return typeof turnId === "string" && turnId !== previousTurnId;
          })
          .toBe(true);
        await expect.poll(completionCount).toBeGreaterThan(previousCompletions);
        const transcript = await client.fetchChatTranscript({ chatId });
        await writeFile(
          testInfo.outputPath("daemon-transcript.json"),
          JSON.stringify(transcript, null, 2),
        );
        await testInfo.attach("daemon-transcript", {
          body: JSON.stringify(transcript, null, 2),
          contentType: "application/json",
        });
        await page.screenshot({
          path: testInfo.outputPath("completed.png"),
          animations: "disabled",
        });
        await writeFile(testInfo.outputPath("completed-screen.txt"), await screen.innerText());
        await writeFile(testInfo.outputPath("frames.json"), JSON.stringify(frames, null, 2));
        await expect(screen).not.toContainText(marker);
        // Reload forces authoritative history rather than relying on completion timing.
        const historyBeforeReload = frames.filter(
          (frame) => (frame as { type: string }).type === "fetch_agent_timeline_response",
        ).length;
        await page.reload();
        await expect(screen.getByText("Check fixture status", { exact: true })).toBeVisible();
        await expect
          .poll(
            () =>
              frames.filter(
                (frame) => (frame as { type: string }).type === "fetch_agent_timeline_response",
              ).length,
          )
          .toBeGreaterThan(historyBeforeReload);
        await page.screenshot({
          path: testInfo.outputPath("reloaded.png"),
          animations: "disabled",
        });
        await testInfo.attach(`${kind}-${marker}-reloaded`, {
          body: await page.screenshot({ animations: "disabled" }),
          contentType: "image/png",
        });
        await expect(screen).not.toContainText(marker);
        expect(transcript.lines.map((line) => line.text)).toEqual([
          "Open fixture session",
          "Fixture ready",
          "Check fixture status",
        ]);
      } finally {
        await writeFile(
          testInfo.outputPath("observed-frame-types.json"),
          JSON.stringify(frameTypes, null, 2),
        );
        await writeFile(
          testInfo.outputPath("observed-frames.json"),
          JSON.stringify(frames, null, 2),
        );
        if (chatId) await client.archiveChat({ chatId });
        await client.archiveBot({ botId: bot.id });
        await client.removeProject(bot.projectId);
        await client.close();
      }
    });
  }
}

test("old DM transcript hides only Bot markers through reload and socket reconnect", async ({
  page,
}, testInfo) => {
  const gate = await installDaemonWebSocketGate(page);
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "old-silence" });
  const created = await client.createBot({
    name: "History fixture",
    launch: { provider: "mock", model: "e2e-fast-stream", modeId: "load-test" },
  });
  if (!created.bot) throw new Error(created.error ?? "Bot creation failed");
  const bot = created.bot;
  let chatId: string | undefined;
  try {
    const result = await client.createChat({ botIds: [bot.id], kind: "direct" });
    if (!result.chat) throw new Error(result.error ?? "Chat creation failed");
    chatId = result.chat.id;
    const log = new TranscriptLog(path.join(process.env.E2E_CLISBOT_HOME!, "chats", chatId));
    const entries: Array<{ sender: ChatMessageSender; text: string }> = [
      { sender: { kind: "user" }, text: "PASS" },
      { sender: { kind: "user" }, text: "HEARTBEAT_OK" },
      { sender: { kind: "bot", botId: bot.id }, text: " PASS \n" },
      { sender: { kind: "bot", botId: bot.id }, text: " HEARTBEAT_OK\n" },
      {
        sender: { kind: "bot", botId: bot.id },
        text: "PASSING the tests; HEARTBEAT_OK means idle.",
      },
      { sender: { kind: "bot", botId: bot.id }, text: "```text\nPASS\nHEARTBEAT_OK\n```" },
      { sender: { kind: "system" }, text: "Fixture error stays visible" },
    ];
    for (const [index, entry] of entries.entries())
      await log.append({ ...entry, id: `old-${index}`, at: new Date().toISOString(), hop: 0 });
    await log.flush();
    const transcriptPath = path.join(log.directory, "transcript.jsonl");
    const original = await readFile(transcriptPath, "utf8");
    await page.goto(`/h/${getServerId()}/chat/${chatId}`);
    const screen = page.getByTestId(`chat-screen-${chatId}`);
    const verify = async () => {
      await expect(screen.getByText("Fixture error stays visible", { exact: true })).toBeVisible();
      await expect(
        screen.getByText("PASSING the tests; HEARTBEAT_OK means idle.", { exact: true }),
      ).toBeVisible();
      // One user marker and one code example, never the old standalone Bot lines.
      for (const marker of ["PASS", "HEARTBEAT_OK"]) {
        await expect
          .poll(
            async () =>
              (await screen.innerText()).split("\n").filter((text) => text.trim() === marker)
                .length,
          )
          .toBe(2);
      }
    };
    await verify();
    await page.screenshot({
      path: testInfo.outputPath("old-transcript-wide.png"),
      animations: "disabled",
    });
    await page.reload();
    await verify();
    const retainedScreen = await screen.elementHandle();
    await gate.drop();
    await expect(page.getByTestId("agent-reconnecting-toast")).toBeVisible();
    await verify();
    await expect(page.getByTestId("chat-initial-loading")).toHaveCount(0);
    expect(await retainedScreen?.evaluate((node) => node.isConnected)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("old-transcript-reconnecting.png"),
      animations: "disabled",
    });
    gate.restore();
    await expect(screen.getByRole("textbox")).toBeEditable({ timeout: 30_000 });
    await verify();
    await page.setViewportSize({ width: 390, height: 844 });
    await verify();
    await page.screenshot({
      path: testInfo.outputPath("old-transcript-phone-web.png"),
      animations: "disabled",
    });
    expect(await readFile(transcriptPath, "utf8")).toBe(original);
    await writeFile(testInfo.outputPath("unchanged-old-transcript.jsonl"), original);
  } finally {
    gate.restore();
    if (chatId) await client.archiveChat({ chatId });
    await client.archiveBot({ botId: bot.id });
    await client.removeProject(bot.projectId);
    await client.close();
  }
});

for (const marker of ["PASS", "HEARTBEAT_OK"]) {
  test(`live DM withholds ${marker} prefixes and releases a meaningful longer reply`, async ({
    page,
  }, testInfo) => {
    const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "stream-silence" });
    const created = await client.createBot({
      name: "Stream fixture",
      launch: {
        provider: "mock",
        model: "e2e-fast-stream",
        modeId: "load-test",
        featureValues: {
          mockStreamingAssistantResponse: `\n\n---\n\n${marker} means idle; this longer reply remains visible.`,
          mockStreamingAssistantIntervalMs: 400,
        },
      },
    });
    if (!created.bot) throw new Error(created.error ?? "Bot creation failed");
    const bot = created.bot;
    let chatId: string | undefined;
    try {
      const result = await client.createChat({ botIds: [bot.id], kind: "direct" });
      if (!result.chat) throw new Error(result.error ?? "Chat creation failed");
      chatId = result.chat.id;
      await page.goto(`/h/${getServerId()}/chat/${chatId}`);
      const screen = page.getByTestId(`chat-screen-${chatId}`);
      const composer = screen.getByRole("textbox");
      await expect(composer).toBeEditable();
      await screen.evaluate((element) => {
        const observations: string[] = [];
        const observer = new MutationObserver(() =>
          observations.push((element as HTMLElement).innerText),
        );
        observer.observe(element, { childList: true, subtree: true, characterData: true });
        Object.assign(window, { silenceObservations: observations });
      });
      await composer.fill("Stream fixture answer");
      await composer.press("Enter");
      await expect(screen).toContainText(`${marker} means idle`, { timeout: 30_000 });
      await page.screenshot({
        path: testInfo.outputPath("meaningful-live.png"),
        animations: "disabled",
      });
      await expect
        .poll(
          async () => {
            const stored = JSON.parse(
              await readFile(
                path.join(process.env.E2E_CLISBOT_HOME!, "chats", chatId!, "chat.json"),
                "utf8",
              ),
            );
            return Boolean(stored.participants[0]?.completedTurn);
          },
          { timeout: 30_000 },
        )
        .toBe(true);
      await expect(screen).toContainText("this longer reply remains visible.");
      const observations = await page.evaluate(
        () => (window as unknown as { silenceObservations: string[] }).silenceObservations,
      );
      await writeFile(
        testInfo.outputPath("stream-observations.json"),
        JSON.stringify(observations, null, 2),
      );
      // The marker may occur in a meaningful paragraph, but never as a standalone reply.
      expect(
        observations
          .flatMap((text) => text.split("\n"))
          .filter((text) => text.trim() !== "" && marker.startsWith(text.trim())),
      ).toEqual([]);
      await page.reload();
      await expect(screen).toContainText("this longer reply remains visible.");
      await page.screenshot({
        path: testInfo.outputPath("meaningful-reloaded.png"),
        animations: "disabled",
      });
    } finally {
      if (chatId) await client.archiveChat({ chatId });
      await client.archiveBot({ botId: bot.id });
      await client.removeProject(bot.projectId);
      await client.close();
    }
  });
}

test("ordinary agent sessions keep both exact marker replies", async ({ page }, testInfo) => {
  const regular = await seedMockAgentWorkspace({
    repoPrefix: "clisbot-marker-control-",
    title: "Ordinary marker control",
    initialPrompt: "First marker control",
    featureValues: { mockAssistantResponses: ["PASS", "HEARTBEAT_OK"] },
  });
  try {
    await openAgentRoute(page, regular);
    await expect(page.getByText("PASS", { exact: true })).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
    await composer.fill("Second marker control");
    await composer.press("Enter");
    await expect(page.getByText("HEARTBEAT_OK", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("PASS", { exact: true })).toBeVisible();
    await expect(page.getByText("HEARTBEAT_OK", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("ordinary-agent-markers.png"),
      animations: "disabled",
    });
  } finally {
    await regular.cleanup();
  }
});
