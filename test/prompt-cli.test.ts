import { describe, expect, test } from "bun:test";
import { resolveAuthPrincipal } from "../src/auth/resolve.ts";
import { renderPlatformInteraction } from "../src/channels/message/rendering.ts";

describe("resolveAuthPrincipal — terminal platform", () => {
	test("resolves terminal principal with terminal: prefix", () => {
		const result = resolveAuthPrincipal({
			platform: "terminal",
			conversationKind: "dm",
			senderId: "myuser",
		});
		expect(result).toBe("terminal:myuser");
	});

	test("resolves slack principal with slack: prefix uppercased", () => {
		const result = resolveAuthPrincipal({
			platform: "slack",
			conversationKind: "dm",
			senderId: "u123abc",
		});
		expect(result).toBe("slack:U123ABC");
	});

	test("resolves telegram principal with telegram: prefix", () => {
		const result = resolveAuthPrincipal({
			platform: "telegram",
			conversationKind: "dm",
			senderId: "987654",
		});
		expect(result).toBe("telegram:987654");
	});

	test("returns undefined when senderId is empty", () => {
		const result = resolveAuthPrincipal({
			platform: "terminal",
			conversationKind: "dm",
		});
		expect(result).toBeUndefined();
	});
});

describe("renderPlatformInteraction — terminal platform", () => {
	test("running status with no content returns Working...", () => {
		const result = renderPlatformInteraction({
			platform: "terminal",
			status: "running",
			content: "",
			maxChars: Number.POSITIVE_INFINITY,
		});
		expect(result).toBe("Working...");
		expect(result).not.toContain("_Working..._");
	});

	test("running status with content streams the content", () => {
		const result = renderPlatformInteraction({
			platform: "terminal",
			status: "running",
			content: "processing...",
			maxChars: Number.POSITIVE_INFINITY,
		});
		expect(result).toBe("processing...");
	});

	test("completed status returns body only, no decoration", () => {
		const result = renderPlatformInteraction({
			platform: "terminal",
			status: "completed",
			content: "hello world",
			maxChars: Number.POSITIVE_INFINITY,
		});
		expect(result).toBe("hello world");
	});

	test("queued status includes queue indicator", () => {
		const result = renderPlatformInteraction({
			platform: "terminal",
			status: "queued",
			content: "",
			maxChars: Number.POSITIVE_INFINITY,
		});
		expect(result).toContain("Queued");
		expect(result).not.toContain("_");
	});

	test("queued with position includes position number", () => {
		const result = renderPlatformInteraction({
			platform: "terminal",
			status: "queued",
			content: "",
			queuePosition: 2,
			maxChars: Number.POSITIVE_INFINITY,
		});
		expect(result).toContain("2");
	});

	test("error status renders plain text, no slack markdown", () => {
		const result = renderPlatformInteraction({
			platform: "terminal",
			status: "error",
			content: "something went wrong",
			maxChars: Number.POSITIVE_INFINITY,
		});
		expect(result).toContain("something went wrong");
		expect(result).not.toContain("_Error._");
	});

	test("timeout status is plain text", () => {
		const result = renderPlatformInteraction({
			platform: "terminal",
			status: "timeout",
			content: "",
			maxChars: Number.POSITIVE_INFINITY,
		});
		expect(result).toContain("Timed out");
		expect(result).not.toContain("_");
	});
});

describe("renderPromptHelp", () => {
	test("includes required flags in help text", async () => {
		const { renderPromptHelp } = await import("../src/control/prompt-cli.ts");
		const help = renderPromptHelp();
		expect(help).toContain("--agent");
		expect(help).toContain("--message");
		expect(help).toContain("--stream");
		expect(help).toContain("--json");
		expect(help).toContain("--session-key");
		expect(help).toContain("--timeout");
	});
});
