import {
	AgentService,
	type AgentSessionTarget,
} from "../agents/runtime/agent-service.ts";
import {
	processChannelInteraction,
	type ChannelInteractionRoute,
	type ChannelInteractionIdentity,
} from "../channels/message/interaction-processing.ts";
import { buildSteeringPromptText } from "../channels/message/agent-prompt.ts";
import { buildSurfacePromptContext } from "../channels/surface/surface-prompt-context.ts";
import { loadConfig, type LoadedConfig } from "../config/core/load-config.ts";
import { renderCliCommand } from "./commands/cli-name.ts";

type ParsedPromptCommand = {
	agentId: string;
	message: string;
	sessionKey?: string;
	stream: boolean;
	json: boolean;
	timeoutMs: number;
};

type PromptCliDependencies = {
	loadConfig: (configPath?: string) => Promise<LoadedConfig>;
	print: (text: string) => void;
};

const defaultDeps: PromptCliDependencies = {
	loadConfig,
	print: (text) => console.log(text),
};

function hasFlag(args: string[], flag: string) {
	return args.includes(flag);
}

function parseOptionValue(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index === -1 || index + 1 >= args.length) {
		return undefined;
	}
	return args[index + 1];
}

function parseIntegerOption(args: string[], name: string): number | undefined {
	const raw = parseOptionValue(args, name);
	if (raw === undefined) {
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	if (Number.isNaN(parsed)) {
		throw new Error(`${name} requires a number`);
	}
	return parsed;
}

function parsePromptCommand(args: string[]): ParsedPromptCommand | null {
	const first = args[0];
	if (!first || first === "help" || first === "--help" || first === "-h") {
		return null;
	}

	const agentId = parseOptionValue(args, "--agent");
	if (!agentId) {
		throw new Error("--agent <id> is required");
	}

	const message = parseOptionValue(args, "--message");
	if (!message) {
		throw new Error("--message <text> is required");
	}

	const timeoutSec = parseIntegerOption(args, "--timeout") ?? 120;

	return {
		agentId,
		message,
		sessionKey: parseOptionValue(args, "--session-key"),
		stream: hasFlag(args, "--stream"),
		json: hasFlag(args, "--json"),
		timeoutMs: timeoutSec * 1000,
	};
}

export function renderPromptHelp(): string {
	return [
		renderCliCommand("prompt"),
		"",
		"Usage:",
		`  ${renderCliCommand("prompt --agent <id> --message <text> [--session-key <key>] [--stream] [--timeout <seconds>] [--json]")}`,
		"",
		"Options:",
		"  --agent <id>          Agent id to send the message to (required)",
		"  --message <text>      Message text to send (required)",
		"  --session-key <key>   Session key; defaults to the config main key",
		"  --stream              Stream output as it arrives",
		"  --timeout <seconds>   Max wait time in seconds (default: 120)",
		"  --json                Output result as JSON",
		"  --help, -h            Show this help",
		"",
		"Description:",
		"  Sends a message directly to a running clisbot agent and prints the",
		"  response to stdout. Useful for scripting and external tool integration",
		"  without requiring a Slack or Telegram channel.",
		"",
		"Examples:",
		`  ${renderCliCommand('prompt --agent myagent --message "What is 2+2?"')}`,
		`  ${renderCliCommand('prompt --agent myagent --message "Summarize logs" --stream')}`,
		`  ${renderCliCommand('prompt --agent myagent --message "Run tests" --json --timeout 300')}`,
	].join("\n");
}

export async function runPromptCli(
	args: string[],
	deps: PromptCliDependencies = defaultDeps,
): Promise<void> {
	const command = parsePromptCommand(args);
	if (!command) {
		deps.print(renderPromptHelp());
		return;
	}

	const loadedConfig = await deps.loadConfig(process.env.CLISBOT_CONFIG_PATH);

	const agentService = new AgentService(loadedConfig);
	const sessionTarget: AgentSessionTarget = {
		agentId: command.agentId,
		sessionKey:
			command.sessionKey ?? loadedConfig.raw.session.mainKey ?? command.agentId,
	};

	const route: ChannelInteractionRoute = {
		agentId: command.agentId,
		commandPrefixes: { slash: ["/"], bash: ["!"] },
		streaming: command.stream ? "latest" : "off",
		response: "final",
		responseMode: "capture-pane",
		additionalMessageMode: "queue",
		surfaceNotifications: { queueStart: "none", loopStart: "none" },
		verbose: "off",
		followUp: { mode: "paused", participationTtlMs: 0 },
	};

	const identity: ChannelInteractionIdentity = {
		platform: "terminal",
		conversationKind: "dm",
		senderId: process.env.USER ?? "cli",
	};

	const now = Date.now();
	const promptContext = buildSurfacePromptContext({
		identity,
		agentId: command.agentId,
		time: now,
	});

	const agentPromptBuilder = (text: string) =>
		buildSteeringPromptText({
			text,
			identity,
			agentId: command.agentId,
			time: now,
			promptContext,
		});

	let capturedText = "";

	try {
		await processChannelInteraction({
			agentService,
			sessionTarget,
			identity,
			text: command.message,
			route,
			agentPromptBuilder,
			promptContext,
			maxChars: Number.POSITIVE_INFINITY,
			postText: async (text: string) => {
				capturedText = text;
				if (command.stream && !command.json) {
					process.stdout.write(text + "\n");
				}
				return [text];
			},
			reconcileText: async (_chunks: string[], text: string) => {
				capturedText = text;
				if (command.stream && !command.json && text) {
					process.stdout.write(text + "\n");
				}
				return [text];
			},
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		process.stderr.write(`Error: ${msg}\n`);
		process.exit(1);
	}

	if (command.json) {
		deps.print(
			JSON.stringify(
				{
					ok: true,
					status: "completed",
					text: capturedText,
					agentId: command.agentId,
					sessionKey: sessionTarget.sessionKey,
				},
				null,
				2,
			),
		);
		return;
	}

	if (!command.stream) {
		deps.print(capturedText);
	}
}
