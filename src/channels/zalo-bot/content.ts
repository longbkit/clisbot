import type { MessageInputFormat, MessageRenderMode } from "../message-command.ts";

function normalizeLineEndings(text: string) {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function renderZaloBotMarkdownToPlain(markdown: string) {
  let text = normalizeLineEndings(markdown);

  const codeSpans: string[] = [];
  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const token = `@@CODE_SPAN_${codeSpans.length}@@`;
    codeSpans.push(code);
    return token;
  });

  text = text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_match, language: string, code: string) => {
    const label = language.trim();
    const body = code.replace(/\n+$/, "");
    return label ? `${label}:\n${body}` : body;
  });

  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt: string, url: string) =>
    alt.trim() ? `${alt.trim()}: ${url}` : url,
  );
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1: $2");
  text = text.replace(/^ {0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^>\s?/gm, "│ ");
  text = text.replace(/^(\s*[-*])\s+\[( |x|X)\]\s+/gm, "$1 ");
  text = text.replace(/^---+$/gm, "");
  text = text.replace(/^___+$/gm, "");
  text = text.replace(/^\*\*\*+$/gm, "");
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  text = text.replace(/__([^_\n]+)__/g, "$1");
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/gm, "$1$2");
  text = text.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/gm, "$1$2");
  text = text.replace(/\\/g, "");

  text = text.replace(/@@CODE_SPAN_(\d+)@@/g, (_match, index: string) => {
    const code = codeSpans[Number(index)] ?? "";
    return `"${code}"`;
  });

  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function resolveZaloBotMessageContent(params: {
  text: string;
  inputFormat: MessageInputFormat;
  renderMode: MessageRenderMode;
}) {
  const text = normalizeLineEndings(params.text);

  if (params.inputFormat === "blocks" || params.renderMode === "blocks") {
    throw new Error("Zalo Bot does not support block payloads");
  }
  if (params.inputFormat === "mrkdwn" || params.renderMode === "mrkdwn") {
    throw new Error("Zalo Bot does not support Slack mrkdwn payloads");
  }
  if (params.inputFormat === "html") {
    throw new Error("Zalo Bot does not support HTML input; use --input md or plain");
  }
  if (params.renderMode === "html") {
    throw new Error("Zalo Bot does not support HTML render output");
  }
  if (params.renderMode === "none" || params.inputFormat === "plain") {
    return { text };
  }

  return {
    text: renderZaloBotMarkdownToPlain(text),
  };
}
