// Fusion-owned inbound seam. Upstream keeps its mirror of this decode private
// inside `extensions/slack/src/format.ts` (`decodeSlackMrkdwnEntities`, three
// entities), so there is no upstream symbol to import. The Fusion transport
// needs it at the inbound boundary and also decodes `&quot;`/`&#39;`, which
// Slack emits in some payloads. Recorded as D-024 in upstream-sync.json.

/** Decode the entities Slack's own API puts into a message `text` in one
 * pass (`&amp;` / `&lt;` / `&gt;` — `&quot;` and `&#39;` appear in some
 * payloads), so an entity's decoded text is never interpreted again. This
 * preserves literal entity text such as `&amp;lt;` → `&lt;`; unmatched
 * ampersands remain untouched. Applied at the inbound boundary, the result
 * is safe for the outbound render to project back to wire form. */
export function decodeSlackEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/gu, (match, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "#39":
        return "'";
      default:
        return match;
    }
  });
}
