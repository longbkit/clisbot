import { i18n } from "@/i18n/i18next";

/**
 * Text parsing behind the MCP server form. Kept apart from the component so it is tested
 * without a renderer.
 */

/**
 * `Name: value` (headers) or `NAME=value` (environment) lines into a map, or `undefined`
 * when the field was left empty, which tells the Host to keep what it stores.
 */
export function parseSecretLines(
  text: string,
  separator: ":" | "=",
): Record<string, string> | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  const values: Record<string, string> = {};
  for (const line of lines) {
    const at = line.indexOf(separator);
    if (at <= 0) {
      throw new Error(
        separator === ":"
          ? i18n.t("connectors.screen.errors.notAHeader", { line })
          : i18n.t("connectors.screen.errors.notAVariable", { line }),
      );
    }
    values[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return values;
}

/** Splits a command line on spaces, keeping "quoted parts" and 'quoted parts' whole. */
/**
 * The command and its arguments as one line `splitCommandLine` reads back to the same list: a
 * word with spaces or quotes goes in single quotes, and a single quote inside one is written as
 * `'"'"'` (close, a double-quoted quote, reopen).
 */
export function joinCommandLine(words: readonly string[]): string {
  return words
    .map((word) => (/^[^\s'"]+$/.test(word) ? word : `'${word.replaceAll("'", `'"'"'`)}'`))
    .join(" ");
}

export function splitCommandLine(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const character of text.trim()) {
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) parts.push(current);
      current = "";
      started = false;
    } else {
      current += character;
      started = true;
    }
  }
  if (started) parts.push(current);
  return parts;
}

export interface McpServerFormValues {
  previousName?: string;
  name: string;
  transport: "http" | "stdio";
  url: string;
  command: string;
  /** The Headers or Environment field, as typed. */
  secrets: string;
}

/** The `connectors.mcp_server.save` request for what the form holds. */
export function buildMcpServerSave(values: McpServerFormValues): {
  previousName?: string;
  server:
    | { name: string; transport: "http"; url: string }
    | { name: string; transport: "stdio"; command: string; args: string[] };
  headers?: Record<string, string>;
  env?: Record<string, string>;
} {
  const name = values.name.trim();
  const previous = values.previousName ? { previousName: values.previousName } : {};
  if (values.transport === "http") {
    const headers = parseSecretLines(values.secrets, ":");
    return {
      ...previous,
      server: { name, transport: "http", url: values.url.trim() },
      ...(headers ? { headers } : {}),
    };
  }
  const [command = "", ...args] = splitCommandLine(values.command);
  const env = parseSecretLines(values.secrets, "=");
  return {
    ...previous,
    server: { name, transport: "stdio", command, args },
    ...(env ? { env } : {}),
  };
}
