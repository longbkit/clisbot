// COMPAT(clisbot-control-plane): Slack channel format — mrkdwn-aware rendering
// (C5). Supersedes the naive "escape every backtick/star/underscore/tilde"
// port of OpenClaw `extensions/slack/src/monitor/mrkdwn.ts` (`escapeSlackMrkdwn`),
// which also killed the very markup the agent meant to render: a code span
// `` `code` `` came back as `` \`code\` `` (literal backslashes + backticks).
//
// Correct behavior: let legitimate markdown RENDER — code spans, fenced code
// blocks, links, bold, italic, strikethrough, blockquote, lists — while still
// escaping the XML-unsafe chars (`&` `<` `>`) inside plain-text leaves, and
// leaving a literal backslash the agent typed intact. Slack mrkdwn is a strict
// subset of CommonMark for the relevant constructs, so we parse the agent's
// markdown with markdown-it (the same parser the Telegram vertical's
// `markdownToIR` port is built on) and walk the token tree, emitting mrkdwn
// tokens for the supported constructs and escaping only the text leaves.
//
// The OpenClaw full `format.ts` front-end (angle-token preservation, link
// conversion, table rendering) remains OUT OF SCOPE for the P0 text path:
// the relay posts one `text` field, not blocks.

import MarkdownIt from "markdown-it";

/** Structural view of a markdown-it `Token` (the `export =` module does not
 * re-export the `Token` class by name). Non-optional where the real `Token`
 * is non-optional, so a real `Token` is assignable here. */
interface MarkdownToken {
  type: string;
  tag: string;
  content: string;
  info: string;
  children: MarkdownToken[] | null;
  attrs: [string, string][] | null;
  level: number;
  map: [number, number] | null;
  markup: string;
}

function createMarkdownIt(): MarkdownIt {
  const md = new MarkdownIt({ html: false, linkify: false, breaks: false, typographer: false });
  md.enable("strikethrough");
  md.disable("table");
  return md;
}

/** The inline emphasis pairs: `<style>_open` opens, `<style>_close` closes
 * (markdown-it token names -> Slack mrkdwn delimiters). */
const INLINE_DELIMS: Record<string, string> = {
  em_open: "_",
  em_close: "_",
  strong_open: "*",
  strong_close: "*",
  s_open: "~",
  s_close: "~",
};

/** A Slack native special token in a message's `text`: `<@USER|BOT>`,
 * `<@!channel>`, `<!here|@channel|channel|everyone>`, `<#C…|name>`, an
 * angle-bracketed link `<http…|label>` / `<mailto:…>`, or `<subteam^…>`.
 * These are Slack's OWN markup (the decided-state responder mention is one);
 * they must reach the API verbatim or Slack renders them as literal text —
 * the exact "ký tự lạ" the mention bug produced. */
const SLACK_SPECIAL_TOKEN = new RegExp(
  [
    "<@[A-Z][A-Z0-9]{2,31}>", // user / bot id (the decided-state mention)
    "<@![A-Z][A-Z0-9]{2,31}>", // legacy user-group id
    "<!(?:here|channel|everyone|subteam\\^[A-Z0-9]+(?:\\.[A-Z0-9]+)?)>", // broadcasts
    "<#[A-Z][A-Z0-9]{2,31}(?:\\|[^<>]*)?>", // channel mention (+ alias)
    "<(?:https?|mailto|tel):[^<>\\s|]*(?:\\|[^<>]*)?>", // angle-bracketed links
  ].join("|"),
  "g",
);

/** Escape the XML-unsafe chars for an mrkdwn text leaf, preserving (1) Slack
 * native special tokens — emitted verbatim so mentions/tags keep working —
 * and (2) entities already present in the source (an agent echoing text it
 * read back from Slack carries `&lt;` / `=&gt;`; re-escaping their `&` is
 * what made the literal `&amp;lt;` garbage). `>` needs no escaping in
 * mrkdwn: only `&` and the `<` that opens a tag are special. A literal
 * backslash the agent typed is kept as-is: in mrkdwn a backslash before a
 * non-special char is inert, and before a char we let through (backtick,
 * `*`, `_`, `~`) it is exactly the way to keep that char literal. */
function escapeXmlUnsafe(value: string): string {
  let out = "";
  let last = 0;
  for (const match of value.matchAll(SLACK_SPECIAL_TOKEN)) {
    const index = match.index ?? 0;
    out += plainEscape(value.slice(last, index));
    out += match[0];
    last = index + match[0].length;
  }
  return out + plainEscape(value.slice(last));
}

/** Escape a plain run (no Slack token, no entity) for an mrkdwn leaf. */
function plainEscape(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|#39);|[<&]/g, (match, entity: string | undefined) => {
    if (entity !== undefined) return match;
    return match === "&" ? "&amp;" : "&lt;";
  });
}

/** Decode the entities Slack's own API puts into a message `text` in one
 * pass (`&amp;` / `&lt;` / `&gt;` — `&quot;` and `&#39;` appear in some
 * payloads), so an entity's decoded text is never interpreted again. This
 * preserves literal entity text such as `&amp;lt;` → `&lt;`; unmatched
 * ampersands remain untouched. Applied at the inbound boundary, the result
 * is safe for the outbound escape to render back to wire form. */
export function decodeSlackEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/gu, (_match, entity: string) => {
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
        return _match;
    }
  });
}

/** The render state shared across the recursive walk. */
interface SlackState {
  out: string[];
  /** The open link's href (Slack's `[label](href)` needs it at link_close). */
  openHref: string | null;
  /** The current ordered-list counter (1-based); null outside an ordered list. */
  orderedIndex: number | null;
  /** Nesting depth of the open blockquote(s). */
  quoteDepth: number;
  /** True while emitting the inline content of a quoted line, so a softbreak
   * inside the quoted block re-issues the `> ` prefix on the next line. */
  inQuoteLine: boolean;
}

/** Render one inline container's children in place. */
// eslint-disable-next-line complexity -- token dispatch is the bounded Markdown inline grammar.
function renderInline(tokens: MarkdownToken[], state: SlackState): void {
  for (const token of tokens) {
    const delim = INLINE_DELIMS[token.type];
    if (delim !== undefined) {
      state.out.push(delim);
      continue;
    }
    switch (token.type) {
      case "text":
        state.out.push(escapeXmlUnsafe(token.content));
        break;
      case "softbreak":
      case "hardbreak":
        if (state.inQuoteLine) {
          state.out.push("\n" + "> ".repeat(state.quoteDepth));
        } else {
          state.out.push("\n");
        }
        break;
      case "code_inline":
        state.out.push("`" + escapeXmlUnsafe(token.content) + "`");
        break;
      case "link_open": {
        const href = token.attrs?.find(([key]) => key === "href")?.[1] ?? "";
        state.openHref = href;
        state.out.push("[");
        break;
      }
      case "link_close": {
        // Slack's link markup is `<url|label>` — the CommonMark `[label](url)`
        // form renders as literal brackets on Slack. The label was already
        // pushed as the inline run between the markers; splice it out.
        let href = state.openHref ?? "";
        if (href.includes("%7C")) {
          // The source was ALREADY a Slack `<url|label>` token: markdown-it's
          // autolink rule ate it and percent-encoded the `|`. Emit the token
          // verbatim (label === href for an autolink).
          // Drop the pushed label text AND the "[" from link_open.
          while (state.out.length > 0 && state.out[state.out.length - 1] !== "[") {
            state.out.length -= 1;
          }
          if (state.out[state.out.length - 1] === "[") state.out.length -= 1;
          state.out.push(`<${href.replaceAll("%7C", "|")}>`);
          state.openHref = null;
          break;
        }
        const labelStart = state.out.lastIndexOf("[");
        const label = labelStart >= 0 ? state.out.slice(labelStart + 1).join("") : "";
        if (labelStart >= 0) {
          state.out.length = labelStart;
          state.out.push(href === "" ? `[${label}]()` : `<${href}|${label}>`);
        } else {
          state.out.push("](" + href + ")");
        }
        state.openHref = null;
        break;
      }
      default:
        if (token.children) {
          renderInline(token.children, state);
        }
        break;
    }
  }
}

/** The inline content of one paragraph/heading/list-item as mrkdwn. When
 * inside a blockquote, every line of the content is prefixed with `> `
 * (repeated for nesting). */
function renderInlineBlock(token: MarkdownToken, state: SlackState): string {
  const savedHref = state.openHref;
  state.openHref = null;
  const before = state.out.length;
  if (token.children) {
    renderInline(token.children, state);
  }
  let text = state.out.slice(before).join("");
  state.out.length = before;
  state.openHref = savedHref;
  if (state.quoteDepth > 0) {
    state.inQuoteLine = true;
    const prefix = "> ".repeat(state.quoteDepth);
    text = prefix + text.replace(/\n/g, "\n" + prefix);
  }
  return text;
}

/** Render one block token. */
// eslint-disable-next-line complexity -- token dispatch is the bounded Markdown block grammar.
function renderBlock(token: MarkdownToken, state: SlackState): string | null {
  switch (token.type) {
    case "inline":
      return renderInlineBlock(token, state);
    case "fence":
      return "```" + token.info.trim() + "\n" + escapeXmlUnsafe(token.content) + "```";
    case "code_block":
      return "```\n" + escapeXmlUnsafe(token.content) + "```";
    case "heading_open":
    case "heading_close":
    case "paragraph_open":
    case "paragraph_close":
    case "bullet_list_open":
    case "bullet_list_close":
      return null;
    case "ordered_list_open":
      state.orderedIndex = 1;
      return null;
    case "ordered_list_close":
      state.orderedIndex = null;
      return null;
    case "list_item_open": {
      const marker = state.orderedIndex !== null ? `${state.orderedIndex}. ` : "- ";
      if (state.orderedIndex !== null) {
        state.orderedIndex += 1;
      }
      return marker;
    }
    case "list_item_close":
      return null;
    case "blockquote_open":
      state.quoteDepth += 1;
      return null;
    case "blockquote_close":
      state.quoteDepth -= 1;
      state.inQuoteLine = false;
      return null;
    default:
      if (token.children) {
        const parts: string[] = [];
        for (const child of token.children) {
          const rendered = renderBlock(child, state);
          if (rendered !== null) parts.push(rendered);
        }
        return parts.length > 0 ? parts.join("") : null;
      }
      return null;
  }
}

/** The public render: agent markdown -> Slack mrkdwn `text` field.
 * Legitimate markup renders; `&`/`<`/`>` in text leaves are escaped; a literal
 * backslash the agent typed is kept. */
export function renderSlackMrkdwn(markdown: string): string {
  const tokens = createMarkdownIt().parse(markdown ?? "", {});
  const state: SlackState = {
    out: [],
    openHref: null,
    orderedIndex: null,
    quoteDepth: 0,
    inQuoteLine: false,
  };
  const blocks: string[] = [];
  for (const token of tokens) {
    const rendered = renderBlock(token, state);
    if (rendered !== null && rendered !== "") {
      blocks.push(rendered);
    }
  }
  // A list item's marker and its inline content are two adjacent blocks; they
  // must join without a separator. Consecutive items of the SAME list kind get
  // one newline; a different list kind or any prose/list boundary gets a blank
  // line (Slack's paragraph break).
  const isBullet = (b: string) => b.startsWith("- ");
  const isOrdered = (b: string) => /^\d+\. /.test(b);
  const isMarker = (b: string) => isBullet(b) || isOrdered(b);
  let prevKind: "bullet" | "ordered" | null = null;
  let prevWasMarker = false;
  let out = "";
  blocks.forEach((block, i) => {
    if (i === 0) {
      out = block;
    } else if (prevWasMarker) {
      // This block is the content of the previous marker: no separator.
      out += block;
    } else if (isMarker(block) && prevKind !== null) {
      const kind = isBullet(block) ? "bullet" : "ordered";
      out += kind === prevKind ? "\n" + block : "\n\n" + block;
    } else {
      out += "\n\n" + block;
    }
    if (isMarker(block)) {
      prevKind = isBullet(block) ? "bullet" : "ordered";
      prevWasMarker = true;
    } else if (prevWasMarker) {
      // The content block of a list item: keep the list kind alive so the
      // next item's marker still joins with one newline. Only a genuinely
      // non-list block (prose, fence, ...) resets the kind.
      prevWasMarker = false;
    } else {
      prevKind = null;
      prevWasMarker = false;
    }
  });
  return out.replace(/\n+$/u, "");
}
