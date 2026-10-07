import { useCallback } from "react";
import {
  DEFAULT_CONNECTOR_DAILY_SEND_LIMIT,
  type ConnectorGrant,
} from "@clisbot/protocol/connectors/types";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@/components/settings";
import type { GrantEdit } from "./use-grant-editor";
import { SendLimitRow } from "./send-limit-row";

/**
 * How a Project's agents send (docs/features/connectors/README.md, "Runtime"): whether anything
 * someone else receives waits for an answer, how many may go out a day when it does not, and
 * whether Codex may also use the ChatGPT apps connected in Codex itself, which run outside
 * Connectors (no per-Project accounts, tools or send approvals). One section, one card.
 */
export function SendingSection({
  grant,
  apply,
  showSends,
  showBuiltInApps,
}: {
  grant: ConnectorGrant | undefined;
  apply(edit: GrantEdit): void;
  /** Sending settings matter once an app is granted. */
  showSends: boolean;
  /** Codex's own apps: only for sessions that may run Codex. */
  showBuiltInApps: boolean;
}) {
  const ask = (grant?.sends ?? "ask") === "ask";
  const setAsk = useCallback(
    (value: boolean) => apply((current) => ({ ...current, sends: value ? "ask" : "allow" })),
    [apply],
  );
  const setLimit = useCallback(
    (limit: number) => apply((current) => ({ ...current, dailySendLimit: limit })),
    [apply],
  );
  const setBuiltIn = useCallback(
    (value: boolean) =>
      apply((current) => {
        const { builtInApps: _previous, ...rest } = current ?? {};
        return value ? rest : { ...rest, builtInApps: false };
      }),
    [apply],
  );
  if (!showSends && !showBuiltInApps) return null;
  return (
    <SettingsSection
      title="Sending"
      info="Sending covers anything someone else receives: email, messages, posts, invites, shares and payments."
    >
      <SettingsCard>
        {showSends ? (
          <SettingsSwitch
            label="Ask before sending"
            hint="Each send waits for your answer in the chat"
            value={ask}
            onValueChange={setAsk}
          />
        ) : null}
        {showSends && !ask ? (
          <SendLimitRow
            value={grant?.dailySendLimit ?? DEFAULT_CONNECTOR_DAILY_SEND_LIMIT}
            onChange={setLimit}
          />
        ) : null}
        {showBuiltInApps ? (
          <SettingsSwitch
            label="Codex's own apps"
            hint="ChatGPT apps connected in Codex skip Connectors' accounts, tool limits and send approvals. Applies from the next session"
            value={grant?.builtInApps !== false}
            onValueChange={setBuiltIn}
          />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
