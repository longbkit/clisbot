// One live ACP session: an adapter child process plus one ACP sessionId,
// driven over the official SDK client connection. Owns prompt turns, event
// accumulation for chat rendering, permission policy, and cancel.

import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type InitializeResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type StopReason,
} from "@agentclientprotocol/sdk";
import { getClisbotVersion } from "../../version.ts";
import type { RunEvent } from "../contract/run-event.ts";
import { AcpAdapterProcess, AcpAdapterProcessError } from "./adapter-process.ts";
import {
  applyRunEventToTurn,
  mapPermissionOptionKind,
  mapSessionUpdateToRunEvent,
  renderTurnText,
  type TurnSegment,
} from "./events.ts";

export type AcpPermissionPolicy = "auto-allow" | "deny";

export type AcpSessionParams = {
  sessionName: string;
  workspacePath: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  permissionPolicy: AcpPermissionPolicy;
};

export class AcpTurnAlreadyActiveError extends Error {
  constructor(sessionName: string) {
    super(`ACP session "${sessionName}" already has an active prompt turn.`);
    this.name = "AcpTurnAlreadyActiveError";
  }
}

export class AcpSession {
  private readonly process: AcpAdapterProcess;
  private readonly connection: ClientSideConnection;
  private initializeResponse: InitializeResponse | null = null;
  private acpSessionId: string | null = null;
  private turnSegments: TurnSegment[] = [];
  private settledTranscript = "";
  private turnActive = false;
  private eventListener: ((event: RunEvent) => void) | null = null;
  private turnChangedListener: (() => void) | null = null;

  constructor(private readonly params: AcpSessionParams) {
    this.process = new AcpAdapterProcess(params.sessionName, {
      command: params.command,
      args: params.args,
      cwd: params.workspacePath,
      env: params.env,
    });
    const { output, input } = this.process.openStdioStreams();
    const client: Client = {
      requestPermission: (request) => this.resolvePermissionRequest(request),
      sessionUpdate: (notification) => this.handleSessionUpdate(notification),
    };
    this.connection = new ClientSideConnection(() => client, ndJsonStream(output, input));
  }

  get sessionName() {
    return this.params.sessionName;
  }

  get workspacePath() {
    return this.params.workspacePath;
  }

  get sessionId() {
    return this.acpSessionId;
  }

  get adapterPid() {
    return this.process.pid;
  }

  get alive() {
    return this.process.alive;
  }

  get adapterStderrEvidence() {
    return this.process.stderrEvidence;
  }

  get hasActiveTurn() {
    return this.turnActive;
  }

  get supportsLoadSession() {
    return this.initializeResponse?.agentCapabilities?.loadSession === true;
  }

  /** Full rendered transcript: settled turns plus the running turn. */
  get transcript() {
    const runningTurn = renderTurnText(this.turnSegments);
    return [this.settledTranscript, runningTurn].filter(Boolean).join("\n\n");
  }

  /** Rendered text of the currently running turn only. */
  get currentTurnText() {
    return renderTurnText(this.turnSegments);
  }

  onEvent(listener: ((event: RunEvent) => void) | null) {
    this.eventListener = listener;
  }

  onTurnChanged(listener: (() => void) | null) {
    this.turnChangedListener = listener;
  }

  onAdapterExit(listener: () => void) {
    this.process.onExit(() => listener());
  }

  async initialize() {
    this.initializeResponse = await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: {
          readTextFile: false,
          writeTextFile: false,
        },
      },
      clientInfo: {
        name: "clisbot",
        version: getClisbotVersion(),
      },
    });
    return this.initializeResponse;
  }

  async newSession() {
    const response = await this.connection.newSession({
      cwd: this.params.workspacePath,
      mcpServers: [],
    });
    this.acpSessionId = response.sessionId;
    return response.sessionId;
  }

  async loadSession(sessionId: string) {
    // session/load replays the stored conversation through session/update
    // notifications before it responds; the replayed turns settle into the
    // transcript so /attach-style reads show prior context.
    await this.connection.loadSession({
      sessionId,
      cwd: this.params.workspacePath,
      mcpServers: [],
    });
    this.settleTurnIntoTranscript();
    this.acpSessionId = sessionId;
    return sessionId;
  }

  async prompt(text: string): Promise<{ stopReason: StopReason; turnText: string }> {
    const sessionId = this.requireSessionId();
    if (this.turnActive) {
      throw new AcpTurnAlreadyActiveError(this.params.sessionName);
    }
    this.turnActive = true;
    this.appendPromptEcho(text);
    try {
      const response = await this.connection.prompt({
        sessionId,
        prompt: [
          {
            type: "text",
            text,
          },
        ],
      });
      return {
        stopReason: response.stopReason,
        turnText: renderTurnText(this.turnSegments),
      };
    } finally {
      this.turnActive = false;
      this.settleTurnIntoTranscript();
    }
  }

  async cancel() {
    if (!this.acpSessionId || !this.turnActive) {
      return false;
    }
    await this.connection.cancel({ sessionId: this.acpSessionId });
    return true;
  }

  /** Rotate to a fresh ACP conversation on the same adapter process. */
  async rotateToNewSession() {
    await this.cancel().catch(() => undefined);
    this.settleTurnIntoTranscript();
    return this.newSession();
  }

  stop() {
    this.process.kill();
  }

  buildAdapterLostError(detail: string) {
    const exit = this.process.exit;
    const exitDetail =
      exit && typeof exit.code === "number" ? ` (adapter exit code ${exit.code})` : "";
    return new AcpAdapterProcessError(
      this.params.sessionName,
      `${detail}${exitDetail}`,
      this.adapterStderrEvidence,
    );
  }

  private requireSessionId() {
    if (!this.acpSessionId) {
      throw this.buildAdapterLostError("has no active ACP session yet");
    }
    return this.acpSessionId;
  }

  private appendPromptEcho(text: string) {
    this.settleTurnIntoTranscript();
    const echo = text.trim();
    if (echo) {
      this.settledTranscript = [this.settledTranscript, `› ${echo}`]
        .filter(Boolean)
        .join("\n\n");
    }
  }

  private settleTurnIntoTranscript() {
    const turnText = renderTurnText(this.turnSegments);
    if (turnText) {
      this.settledTranscript = [this.settledTranscript, turnText]
        .filter(Boolean)
        .join("\n\n");
    }
    this.turnSegments = [];
  }

  private handleSessionUpdate(notification: SessionNotification) {
    // session/load replays arrive before acpSessionId is bound; once bound,
    // ignore updates for foreign session ids.
    if (this.acpSessionId !== null && notification.sessionId !== this.acpSessionId) {
      return;
    }
    const event = mapSessionUpdateToRunEvent(notification.update);
    if (!event) {
      return;
    }
    applyRunEventToTurn(this.turnSegments, event);
    this.eventListener?.(event);
    this.turnChangedListener?.();
  }

  private resolvePermissionRequest(
    request: RequestPermissionRequest,
  ): RequestPermissionResponse {
    const options = request.options ?? [];
    this.eventListener?.({
      type: "permission-request",
      requestId: String(request.toolCall?.toolCallId ?? "permission"),
      title: request.toolCall?.title ?? "Tool permission request",
      options: options.map((option) => ({
        optionId: option.optionId,
        label: option.name,
        kind: mapPermissionOptionKind(option.kind),
      })),
    });

    if (this.params.permissionPolicy === "deny") {
      const rejectOption =
        options.find((option) => option.kind === "reject_once") ??
        options.find((option) => option.kind === "reject_always");
      if (rejectOption) {
        return { outcome: { outcome: "selected", optionId: rejectOption.optionId } };
      }
      return { outcome: { outcome: "cancelled" } };
    }

    const allowOption =
      options.find((option) => option.kind === "allow_always") ??
      options.find((option) => option.kind === "allow_once") ??
      options[0];
    if (allowOption) {
      return { outcome: { outcome: "selected", optionId: allowOption.optionId } };
    }
    return { outcome: { outcome: "cancelled" } };
  }
}
