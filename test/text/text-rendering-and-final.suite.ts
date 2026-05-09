import { describe, expect, test } from "bun:test";
import {
  appendInteractionText,
  cleanInteractionSnapshot,
  cleanRunningInteractionSnapshot,
  deriveBoundedRunningRewritePreview,
  deriveLatestPromptInteractionSnapshot,
  deriveLatestPromptRunningInteractionSnapshot,
  deriveMeaningfulPaneSnapshot,
  deriveInteractionText,
  deriveRunningInteractionText,
  extractFinalAnswer,
  extractSlackIncrement,
  mergeSlackStreamBodies,
  renderSlackInteraction,
  renderSlackSnapshot,
  renderTelegramInteraction,
  selectSlackCompletionBody,
  selectSlackSnapshotBody,
  truncateHead,
} from "../../src/shared/transcript.ts";

describe("snapshot shaping", () => {
  test("renders metadata and truncated snapshot", () => {
    const rendered = renderSlackSnapshot({
      agentId: "default",
      sessionName: "default",
      workspacePath: "/tmp/workspace",
      status: "running",
      snapshot: "a".repeat(5000),
      maxChars: 100,
    });

    expect(rendered).toContain("agent: default");
    expect(rendered).toContain("status: running");
    expect(rendered).toContain("```");
    expect(rendered.length).toBeLessThan(4300);
  });

  test("renders chat-first Slack interaction text without metadata", () => {
    expect(
      renderSlackInteraction({
        status: "queued",
        content: "",
        maxChars: 200,
        queuePosition: 2,
      }),
    ).toBe("_Queued: 2 ahead._");

    expect(
      renderSlackInteraction({
        status: "running",
        content: "Thinking...\nFound the issue.",
        maxChars: 200,
      }),
    ).toBe("Thinking...\nFound the issue.");

    expect(
      renderTelegramInteraction({
        status: "running",
        content: "Thinking...\nFound the issue.",
        maxChars: 200,
      }),
    ).toBe("Thinking...\nFound the issue.");

    expect(
      renderTelegramInteraction({
        status: "running",
        content: "Thinking...\nWorking... (2m 4s • esc to interrupt)",
        maxChars: 200,
      }),
    ).toBe("Thinking...\nWorking... (2m 4s • esc to interrupt)");

    expect(
      renderSlackInteraction({
        status: "detached",
        content: "Still working through the repository.",
        maxChars: 200,
        note:
          "This session has been running for over 15 minutes. clisbot left it running and will post the final result here when it completes. Use `/attach` for live updates, `/watch every <duration>` for periodic updates, or `/stop` to interrupt it.",
        allowTranscriptInspection: true,
      }),
    ).toBe(
      "Still working through the repository.\n\n_This session has been running for over 15 minutes. clisbot left it running and will post the final result here when it completes. Use `/attach` for live updates, `/watch every <duration>` for periodic updates, or `/stop` to interrupt it. You can also use `/transcript` to inspect the current session snapshot._",
    );
  });

  test("does not append a second generic error footer when the body already starts with Error", () => {
    expect(
      renderSlackInteraction({
        status: "error",
        content: "Error: Runtime stopped before the active run finished startup.",
        maxChars: 200,
      }),
    ).toBe("Error: Runtime stopped before the active run finished startup.");

    expect(
      renderTelegramInteraction({
        status: "error",
        content: "Error: Runtime stopped before the active run finished startup.",
        maxChars: 200,
      }),
    ).toBe("Error: Runtime stopped before the active run finished startup.");
  });

  test("renders concise unlabeled errors as a single Error line", () => {
    expect(
      renderSlackInteraction({
        status: "error",
        content: "Runtime stopped before the active run finished startup.",
        maxChars: 200,
      }),
    ).toBe("Error: Runtime stopped before the active run finished startup.");

    expect(
      renderTelegramInteraction({
        status: "error",
        content: "Runtime stopped before the active run finished startup.",
        maxChars: 200,
      }),
    ).toBe("Error: Runtime stopped before the active run finished startup.");
  });

  test("keeps detached note transcript-free when transcript inspection is disabled", () => {
    expect(
      renderSlackInteraction({
        status: "detached",
        content: "Still working through the repository.",
        maxChars: 200,
        note:
          "This session has been running for over 15 minutes. clisbot left it running and will post the final result here when it completes. Use `/attach` for live updates, `/watch every <duration>` for periodic updates, or `/stop` to interrupt it.",
        allowTranscriptInspection: false,
      }),
    ).toBe(
      "Still working through the repository.\n\n_This session has been running for over 15 minutes. clisbot left it running and will post the final result here when it completes. Use `/attach` for live updates, `/watch every <duration>` for periodic updates, or `/stop` to interrupt it._",
    );
  });

  test("extracts the final answer and drops leading progress blocks on completion", () => {
    const extracted = extractFinalAnswer(`
• I’m checking the latest web results for Gemma 4 and comparing coverage from April 4, 2026 versus April 3, 2026.

• Searching the web

• Searched Gemma 4 news April 4 2026

• Searching the web

• Searched Reuters Gemma 4 April 2026

• As of April 4, 2026, I’m not seeing a new official Google update on Gemma 4 today.

What changed today vs. yesterday

- Today: mostly follow-on analysis.
- Yesterday: broader launch coverage.
    `);

    expect(extracted).toStartWith("• As of April 4, 2026");
    expect(extracted).not.toContain("Searching the web");
    expect(extracted).not.toContain("I’m checking the latest web results");
  });

  test("extracts the final answer and drops standalone claude gerund progress blocks", () => {
    const extracted = extractFinalAnswer(`
Determining

PONG
    `);

    expect(extracted).toBe("PONG");
  });

  test("extracts a codex single-line final answer without the assistant bullet prefix", () => {
    const extracted = extractFinalAnswer(`
› Reply with exactly PONG and nothing else.

• PONG
    `);

    expect(extracted).toBe("PONG");
  });

  test("extracts the final answer and drops codex tool and file blocks on completion", () => {
    const extracted = extractFinalAnswer(`
Mình đang nạp context của workspace trước đã: đọc SOUL.md, USER.md, các memory gần đây, rồi
sẽ trả lời trong đúng ngữ cảnh của phiên này.

Ran pwd
 /Users/longluong/.clisbot/workspace/default

Explored List ls -1

Ran for f in SOUL.md USER.md MEMORY.md memory/2026-04-05.md memory/2026-04-04.md
 FILE:SOUL.md --- 125 lines

_Good luck out there. Make it count._

Hey. Anh vừa lên phiên này nên đang ở trạng thái fresh.

Trong workspace này còn BOOTSTRAP.md, nghĩa là mình đang ở lần khởi động đầu. Nên câu đầu
tiên đúng ra là: mình là ai, còn em là ai?

Cho anh 2 mẩu là đủ để bắt đầu:

1. Em muốn gọi anh là gì?
2. Anh nên gọi em là gì?
    `);

    expect(extracted).toStartWith("Hey. Anh vừa lên phiên này");
    expect(extracted).toContain("Cho anh 2 mẩu là đủ để bắt đầu:");
    expect(extracted).not.toContain("Mình đang nạp context");
    expect(extracted).not.toContain("Ran pwd");
    expect(extracted).not.toContain("Explored List ls -1");
    expect(extracted).not.toContain("FILE:SOUL.md");
    expect(extracted).not.toContain("Good luck out there");
  });

  test("extracts the final answer after generic shell command and filesystem blocks", () => {
    const extracted = extractFinalAnswer(`
Preparing workspace.

$ pwd
/Users/longluong/.clisbot/workspace/default

$ ls
README.md
src
package.json

The workspace is ready.

Next, I can inspect the source tree or run tests.
    `);

    expect(extracted).toBe(
      ["The workspace is ready.", "", "Next, I can inspect the source tree or run tests."].join(
        "\n",
      ),
    );
  });

  test("extracts the final answer after generic path-list trace blocks", () => {
    const extracted = extractFinalAnswer(`
Scanning candidate files.

src/index.ts
src/shared/transcript.ts
docs/features/runners/README.md

The duplicate came from settlement merging rather than tmux capture.
    `);

    expect(extracted).toBe("The duplicate came from settlement merging rather than tmux capture.");
  });

  test("completed interaction truncation preserves the beginning of the final answer", () => {
    const rendered = renderSlackInteraction({
      status: "completed",
      content: `
• Searching the web

• Searched Gemma 4 news April 4 2026

• As of April 4, 2026, I’m not seeing a new official Google update on Gemma 4 today.

What changed today vs. yesterday

- Today: mostly follow-on analysis.
- Yesterday: broader launch coverage.
      `,
      maxChars: 120,
    });

    expect(rendered).toStartWith("• As of April 4, 2026");
    expect(rendered).not.toContain("Searching the web");
    expect(rendered.endsWith("\n...")).toBe(true);
  });

  test("completed interaction can preserve streamed content when response policy is all", () => {
    const rendered = renderSlackInteraction({
      status: "completed",
      content: [
        "• Searching the web",
        "",
        "# Codebase Overview",
        "",
        "This workspace is currently empty.",
      ].join("\n"),
      maxChars: 200,
      responsePolicy: "all",
    });

    expect(rendered).toContain("• Searching the web");
    expect(rendered).toContain("# Codebase Overview");
  });

  test("completed interaction strips a codex single-line assistant bullet in final mode", () => {
    const rendered = renderSlackInteraction({
      status: "completed",
      content: "• PONG",
      maxChars: 200,
      responsePolicy: "final",
    });

    expect(rendered).toBe("PONG");
  });

  test("completed interaction drops delivery report lines before the final answer", () => {
    const rendered = renderSlackInteraction({
      status: "completed",
      content: [
        "Đã gửi câu trả lời vào Slack.",
        "Đã gửi câu trả lời vào Zalo Bot.",
        "",
        "• Waited for background terminal",
        "",
        "• Sent.",
        "",
        "4",
        "",
        "Sent the repo summary to Slack.",
      ].join("\n"),
      maxChars: 200,
      responsePolicy: "final",
    });

    expect(rendered).toBe("4");
  });

  test("completed interaction keeps only the last short queued answer block", () => {
    const rendered = renderSlackInteraction({
      status: "completed",
      content: [
        "• Waited for background terminal",
        "",
        "• Sent.",
        "",
        "4",
        "",
        "Sent.",
        "",
        "6",
        "",
        "Sent.",
        "",
        "8",
      ].join("\n"),
      maxChars: 200,
      responsePolicy: "final",
    });

    expect(rendered).toBe("8");
  });

  test("truncateHead keeps the start of long content", () => {
    const rendered = truncateHead("abcdefghij", 8);
    expect(rendered).toBe("abcd\n...");
  });

  test("extracts only appended content when snapshots overlap", () => {
    const previous = [
      "Welcome to Codex",
      "",
      "› Reply with exactly PONG and nothing else.",
      "",
      "• thinking",
    ].join("\n");
    const current = [
      "",
      "› Reply with exactly PONG and nothing else.",
      "",
      "• thinking",
      "",
      "• PONG",
    ].join("\n");

    expect(extractSlackIncrement(previous, current)).toBe("• PONG");
  });

  test("returns only the final delta when response policy keeps streamed replies", () => {
    const completion = selectSlackCompletionBody({
      previousBody: [
        "• Searching the web",
        "",
        "# Codebase Overview",
        "",
        "This workspace is currently empty.",
      ].join("\n"),
      finalBody: [
        "• Searching the web",
        "",
        "# Codebase Overview",
        "",
        "This workspace is currently empty.",
        "",
        "- No source files are present.",
      ].join("\n"),
      response: "all",
    });

    expect(completion).toBe("- No source files are present.");
  });

  test("extracts normalized line deltas when progress markers change", () => {
    const delta = extractSlackIncrement(
      [
        "* Recombobulating...",
        "",
        "web-explorer(gather Vietnam news)",
      ].join("\n"),
      [
        ":eight_spoked_asterisk: Recombobulating...",
        "",
        "web-explorer(gather Vietnam news)",
        "",
        "Initializing…",
      ].join("\n"),
    );

    expect(delta).toBe("Initializing…");
  });

  test("merges streamed bodies without duplicating the boundary line when indentation differs", () => {
    const merged = mergeSlackStreamBodies(
      [
        "Searched https://vnexpress.net/doi-sim-sang-dien-thoai-moi-phai-xac-thuc-khuon-mat-5058317.html",
        "",
        " Tính đến trưa thứ bảy, 4/4/2026 giờ Việt Nam, vài tin Việt Nam đáng chú ý là:",
      ].join("\n"),
      [
        "Tính đến trưa thứ bảy, 4/4/2026 giờ Việt Nam, vài tin Việt Nam đáng chú ý là:",
        "",
        "- Kinh tế quý I tăng mạnh",
      ].join("\n"),
    );

    expect(merged).toBe(
      [
        "Searched https://vnexpress.net/doi-sim-sang-dien-thoai-moi-phai-xac-thuc-khuon-mat-5058317.html",
        "",
        "Tính đến trưa thứ bảy, 4/4/2026 giờ Việt Nam, vài tin Việt Nam đáng chú ý là:",
        "",
        "- Kinh tế quý I tăng mạnh",
      ].join("\n"),
    );
  });

  test("merges repeated progress updates without accumulating duplicate lines", () => {
    const merged = mergeSlackStreamBodies(
      [
        "* Recombobulating...",
        "",
        "* Recombobulating...",
      ].join("\n"),
      [
        ":eight_spoked_asterisk: Recombobulating...",
        "",
        "• Recombobulating...",
      ].join("\n"),
    );

    expect(merged).toBe("* Recombobulating...");
  });

  test("dedupes repeated progress lines even when the first streamed delta is already noisy", () => {
    const merged = mergeSlackStreamBodies(
      "",
      [
        "Creating",
        "",
        ":eight_spoked_asterisk: Creating",
        "",
        "Creating",
      ].join("\n"),
    );

    expect(merged).toBe("Creating");
  });

  test("dedupes claude progress markers that use the ✽ glyph", () => {
    const merged = mergeSlackStreamBodies(
      "Quantumizing",
      [
        "✽ Quantumizing",
        "",
        ":eight_spoked_asterisk: Quantumizing",
      ].join("\n"),
    );

    expect(merged).toBe("✽ Quantumizing");
  });

  test("suppresses completion replay when the final body was already streamed", () => {
    const completion = selectSlackCompletionBody({
      previousBody: [
        "# Codebase Overview",
        "",
        "This workspace is currently empty.",
      ].join("\n"),
      finalBody: [
        "# Codebase Overview",
        "",
        "This workspace is currently empty.",
      ].join("\n"),
      response: "all",
    });

    expect(completion).toBe("");
  });

  test("keeps the full final body when response policy is final", () => {
    const completion = selectSlackCompletionBody({
      previousBody: "• Searching the web",
      finalBody: [
        "# Codebase Overview",
        "",
        "This workspace is currently empty.",
      ].join("\n"),
      response: "final",
    });

    expect(completion).toBe(
      ["# Codebase Overview", "", "This workspace is currently empty."].join("\n"),
    );
  });

  test("keeps only the newly appended body while running", () => {
    const body = selectSlackSnapshotBody({
      status: "running",
      initialSnapshot: "line 1\nline 2",
      snapshot: "line 1\nline 2\nline 3",
      previousBody: "line 2",
    });

    expect(body).toBe("line 3");
  });

  test("reuses the last meaningful body when completion adds no new content", () => {
    const body = selectSlackSnapshotBody({
      status: "completed",
      initialSnapshot: "line 1\nline 2\nline 3",
      snapshot: "line 1\nline 2\nline 3",
      previousBody: "line 3",
    });

    expect(body).toBe("line 3");
  });
});
