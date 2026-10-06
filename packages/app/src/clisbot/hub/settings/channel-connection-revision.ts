import type { z } from "zod";
import type { HubChannelConfigurationSchema } from "../contracts";

type HubChannelConfiguration = z.infer<typeof HubChannelConfigurationSchema>;

/**
 * Whether the configuration only moved by the account the Hub added with a new
 * Connection: the Route form opened on `before`'s revision can then edit on top
 * of `after`. Anything else that changed — a revision the form never saw, or an
 * account, resource or policy edited in the same window — keeps the form's
 * baseline, so its save still stops with "changed while editing".
 */
export function followsConnectionAdd(
  editorRevisionId: string | null,
  before: HubChannelConfiguration | undefined,
  after: HubChannelConfiguration | undefined,
  connectionId: string,
): boolean {
  if (before === undefined || after === undefined) return false;
  if ((before.revision?.id ?? null) !== editorRevisionId) return false;
  const others = after.accounts.filter((account) => account["connectionId"] !== connectionId);
  return (
    JSON.stringify(others) === JSON.stringify(before.accounts) &&
    JSON.stringify(after.resource ?? null) === JSON.stringify(before.resource ?? null) &&
    JSON.stringify(after.policy ?? null) === JSON.stringify(before.policy ?? null)
  );
}
