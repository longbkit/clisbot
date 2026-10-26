import { useEffect, useState } from "react";
import type { MessagePayload } from "@/composer/types";

/** A quick start set to Send right away, waiting for its template to apply. */
export interface QuickStartAutoSend {
  serverId: string;
  text: string;
}

/**
 * Sends a Send-right-away quick start once its template has applied, through Home's own submit,
 * so creation behaves as if the reader pressed Send. When the reader would have to check
 * something first — settings to confirm, a branch to choose, an error shown, attachments already
 * in the composer, a send in flight — the filled composer stays for review instead.
 */
export function useQuickStartAutoSend(input: {
  serverId: string;
  /** The template is still being applied to the composer. */
  applying: boolean;
  /** Anything set here (a settings problem, a branch to choose, an error, a send) holds it. */
  checks: readonly unknown[];
  attachments: number;
  cwd: string | null;
  submit: (payload: MessagePayload) => unknown;
}) {
  const [request, setRequest] = useState<QuickStartAutoSend | null>(null);
  const { serverId, applying, submit } = input;
  const cwd = input.cwd ?? "";
  const blocked = input.attachments > 0 || input.checks.some(Boolean);
  useEffect(() => {
    if (!request || applying) return;
    setRequest(null);
    if (request.serverId !== serverId || blocked) return;
    void submit({ text: request.text, attachments: [], cwd });
  }, [request, applying, blocked, serverId, cwd, submit]);
  return setRequest;
}
