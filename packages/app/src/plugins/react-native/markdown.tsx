import type { MarkdownProps } from "@clisbot/plugin/client/ui";
import { MarkdownRenderer } from "@/components/markdown/renderer";

export function Markdown({ children }: MarkdownProps) {
  return children ? <MarkdownRenderer text={children} /> : null;
}
