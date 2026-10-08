import { useCallback } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      title={t("connectors.screen.sending.title")}
      info={t("connectors.screen.sending.info")}
    >
      <SettingsCard>
        {showSends ? (
          <SettingsSwitch
            label={t("connectors.screen.sending.ask")}
            hint={t("connectors.screen.sending.askHint")}
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
            label={t("connectors.screen.sending.builtIn")}
            hint={t("connectors.screen.sending.builtInHint")}
            value={grant?.builtInApps !== false}
            onValueChange={setBuiltIn}
          />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
