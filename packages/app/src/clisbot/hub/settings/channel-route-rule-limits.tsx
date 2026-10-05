// A Rule's own limits: how much the people who come in this way may take
// (docs/audits/2026-10-05-routes-and-rules.md#limits). Folded to one line until
// the Rule sets one; a leaf it leaves alone shows what it meets instead.

import React, { useCallback, useMemo } from "react";
import type { ChannelLimits } from "../channel-configuration";
import type { AudienceRuleDraft } from "./channel-route-audience";
import {
  LIMITS_NOTE,
  RULE_LIMIT_NAMES,
  channelLimitsSummary,
  limitsAuthored,
  parseChannelLimitsDraft,
  ruleLimitDefaults,
  type ChannelLimitsDraft,
} from "./channel-limits-draft";
import { ChannelLimitsFields } from "./channel-limits-fields";
import { FoldedRouteFormSubgroup } from "./channel-route-form-sections";

type Update = (change: (rule: AudienceRuleDraft) => AudienceRuleDraft) => void;

export function RuleLimitFields({
  rule,
  routeLimits,
  disabled,
  update,
}: {
  rule: AudienceRuleDraft;
  /** The Route's own limits, as its form holds them now. */
  routeLimits: ChannelLimits;
  disabled: boolean;
  update: Update;
}) {
  const defaults = useMemo(
    () => ruleLimitDefaults(routeLimits, rule.who.anyone),
    [routeLimits, rule.who.anyone],
  );
  const setDraft = useCallback(
    (change: (current: ChannelLimitsDraft) => ChannelLimitsDraft) =>
      update((current) => ({ ...current, limits: change(current.limits) })),
    [update],
  );
  const parsed = parseChannelLimitsDraft(rule.limits, RULE_LIMIT_NAMES);
  return (
    <FoldedRouteFormSubgroup
      title="Limits"
      info={LIMITS_NOTE}
      summary={limitsLine(rule.limits, defaults)}
      inUse={limitsAuthored(rule.limits, RULE_LIMIT_NAMES)}
    >
      <ChannelLimitsFields
        names={RULE_LIMIT_NAMES}
        note={false}
        draft={rule.limits}
        setDraft={setDraft}
        defaults={defaults}
        error={parsed.valid ? null : parsed.error}
        disabled={disabled}
      />
    </FoldedRouteFormSubgroup>
  );
}

/** What the folded line says: the Rule's own, else whether anything applies at all. */
function limitsLine(draft: ChannelLimitsDraft, defaults: object): string {
  if (limitsAuthored(draft, RULE_LIMIT_NAMES)) {
    const parsed = parseChannelLimitsDraft(draft, RULE_LIMIT_NAMES);
    return parsed.valid ? channelLimitsSummary(parsed.value, RULE_LIMIT_NAMES) : parsed.error;
  }
  return Object.keys(defaults).length === 0 ? "No limits" : "Default limits";
}
