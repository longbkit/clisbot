import { z } from "zod";
import type { DaemonClient } from "../daemon-client.js";

const TerminalSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  cwd: z.string(),
  name: z.string(),
});

export type ClisbotTerminal = z.infer<typeof TerminalSchema>;

export interface ClisbotTerminalCreateOptions {
  workspaceId: string;
  /** Process working directory; defaults to the workspace directory. */
  cwd?: string;
  name?: string;
  command?: string;
  args?: string[];
  size?: { rows: number; cols: number };
  requestId?: string;
}

export interface ClisbotTerminalListOptions {
  /** Ownership filter. When supplied, cwd does not restrict the results. */
  workspaceId?: string;
  /** Workspace root directory filter for unscoped listings. */
  cwd?: string;
  requestId?: string;
}

export interface ClisbotTerminalListResult {
  entries: ClisbotTerminal[];
  requestId: string;
}

export interface ClisbotTerminalCaptureOptions {
  start?: number;
  end?: number;
  stripAnsi?: boolean;
  requestId?: string;
}

export type ClisbotTerminalCaptureResult = Awaited<ReturnType<DaemonClient["captureTerminal"]>>;

export interface ClisbotTerminalHandle {
  readonly id: string;
  current(): ClisbotTerminal | null;
  refresh(options?: { requestId?: string }): Promise<ClisbotTerminal | null>;
  /** Sends literal input and returns its UTF-16 length. Does not await command execution. */
  write(data: string): number;
  /** Expands CLI key tokens; other strings are literal. Returns the input's UTF-16 length. */
  sendKeys(keys: readonly string[]): number;
  capture(options?: ClisbotTerminalCaptureOptions): Promise<ClisbotTerminalCaptureResult>;
  kill(requestId?: string): Promise<void>;
}

export interface ClisbotTerminalActions {
  create(options: ClisbotTerminalCreateOptions): Promise<ClisbotTerminalHandle>;
  list(options?: ClisbotTerminalListOptions): Promise<ClisbotTerminalListResult>;
  ref(terminal: string | ClisbotTerminal): ClisbotTerminalHandle;
}

export interface ClisbotWorkspaceTerminalActions {
  create(
    options?: Omit<ClisbotTerminalCreateOptions, "workspaceId">,
  ): Promise<ClisbotTerminalHandle>;
  list(options?: { requestId?: string }): Promise<ClisbotTerminalListResult>;
}

type TerminalClient = Pick<
  DaemonClient,
  | "ensureConnected"
  | "getLastServerInfoMessage"
  | "createTerminal"
  | "listTerminals"
  | "sendTerminalInput"
  | "captureTerminal"
  | "killTerminal"
>;

/** @package */
export function createTerminalActions(
  daemonClient: TerminalClient,
  resolveWorkspaceDirectory: (workspaceId: string) => Promise<string>,
): ClisbotTerminalActions {
  function client(): TerminalClient {
    daemonClient.ensureConnected();
    // COMPAT(workspaceTerminals): added in v0.7.3, remove gate after 2027-09-05.
    if (daemonClient.getLastServerInfoMessage()?.features?.workspaceTerminals !== true) {
      throw new Error("Update the host to use workspace terminals through the SDK.");
    }
    return daemonClient;
  }

  const list = async (
    options: ClisbotTerminalListOptions = {},
  ): Promise<ClisbotTerminalListResult> => {
    const result = await client().listTerminals(options.cwd, options.requestId, {
      workspaceId: options.workspaceId,
    });
    return {
      entries: result.terminals.map((terminal) => TerminalSchema.parse(terminal)),
      requestId: result.requestId,
    };
  };

  const ref = (terminal: string | ClisbotTerminal): ClisbotTerminalHandle => {
    const id = typeof terminal === "string" ? terminal : terminal.id;
    let current = typeof terminal === "string" ? null : terminal;
    const write = (data: string): number => {
      client().sendTerminalInput(id, { type: "input", data });
      return data.length;
    };
    return {
      id,
      current: () => current,
      refresh: async (options) => {
        const result = await list(options);
        current = result.entries.find((entry) => entry.id === id) ?? null;
        return current;
      },
      write,
      sendKeys: (keys) => write(keys.map(resolveKeyToken).join("")),
      capture: (options = {}) => {
        const { requestId, ...captureOptions } = options;
        return client().captureTerminal(id, captureOptions, requestId);
      },
      kill: async (requestId) => {
        const result = await client().killTerminal(id, requestId);
        if (!result.success) throw new Error(`Failed to kill terminal ${id}`);
        current = null;
      },
    };
  };

  return {
    create: async ({ workspaceId, cwd, name, requestId, ...options }) => {
      const driver = client();
      if (!workspaceId) throw new Error("workspaceId is required");
      const directory = cwd ?? (await resolveWorkspaceDirectory(workspaceId));
      const result = await driver.createTerminal(directory, name, requestId, {
        ...options,
        workspaceId,
      });
      if (result.error || !result.terminal) {
        throw new Error(result.error ?? "The daemon did not create a terminal");
      }
      return ref(TerminalSchema.parse(result.terminal));
    },
    list,
    ref,
  };
}

function resolveKeyToken(key: string): string {
  switch (key) {
    case "Enter":
      return "\r";
    case "Tab":
      return "\t";
    case "Escape":
      return "\u001b";
    case "Space":
      return " ";
    case "BSpace":
      return "\u007f";
    case "C-c":
      return "\u0003";
    case "C-d":
      return "\u0004";
    case "C-z":
      return "\u001a";
    case "C-l":
      return "\u000c";
    case "C-a":
      return "\u0001";
    case "C-e":
      return "\u0005";
    default:
      return key;
  }
}
