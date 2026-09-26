/**
 * How each running terminal was launched: from which Terminal profile, and by whom.
 * Daemon-wide because every session checks the same terminals. A terminal missing
 * here counts as a shell, so a lost record fails closed.
 * docs/features/access/terminal-and-project-creation.md#using-a-running-terminal
 */
export interface TerminalLaunch {
  /** Absent for a shell. */
  profileId?: string;
  /** The Hub actor id of whoever created it; decides nothing yet. */
  createdBy?: string;
}

const launches = new Map<string, TerminalLaunch>();

/** Records a new terminal's launch and forgets it when the terminal exits. */
export function trackTerminalLaunch(
  session: { id: string; onExit(listener: () => void): () => void },
  launch: TerminalLaunch,
): void {
  recordTerminalLaunch(session.id, launch);
  session.onExit(() => forgetTerminalLaunch(session.id));
}

export function recordTerminalLaunch(terminalId: string, launch: TerminalLaunch): void {
  launches.set(terminalId, launch);
}

export function forgetTerminalLaunch(terminalId: string): void {
  launches.delete(terminalId);
}

export function terminalLaunchOf(terminalId: string): TerminalLaunch {
  return launches.get(terminalId) ?? {};
}
