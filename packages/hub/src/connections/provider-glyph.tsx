import { TerminalIcon } from "lucide-react";

/**
 * Brand marks for the connection providers. Lucide dropped brand icons, and a generic
 * message or repository icon reads as "some integration" rather than "Discord" or
 * "GitHub" — a provider card is exactly where the mark carries the meaning. "manual"
 * is not a brand, so it gets a plain lucide glyph instead of a drawn mark.
 */
export function ProviderGlyph({
  provider,
}: {
  provider: "github" | "discord" | "slack" | "linear" | "manual";
}) {
  if (provider === "github") return <GitHubMark />;
  if (provider === "discord") return <DiscordMark />;
  if (provider === "slack") return <SlackMark />;
  if (provider === "linear") return <LinearMark />;
  return <TerminalIcon className="size-4.5" aria-hidden="true" />;
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-4.5" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function DiscordMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-4.5" fill="currentColor" aria-hidden="true">
      <path d="M13.55 3.11A13.2 13.2 0 0 0 10.29 2.1a.05.05 0 0 0-.05.02c-.14.25-.3.58-.41.84a12.2 12.2 0 0 0-3.66 0A8.4 8.4 0 0 0 5.75 2.12.05.05 0 0 0 5.7 2.1c-1.14.2-2.23.54-3.25 1.01a.05.05 0 0 0-.02.02C.36 6.28-.22 9.36.07 12.4c0 .01.01.03.02.03 1.37 1.01 2.7 1.62 4 2.03a.05.05 0 0 0 .06-.02c.31-.42.58-.87.82-1.34a.05.05 0 0 0-.03-.07 8.7 8.7 0 0 1-1.25-.6.05.05 0 0 1 0-.09l.25-.19a.05.05 0 0 1 .05 0 9.3 9.3 0 0 0 7.94 0 .05.05 0 0 1 .05 0l.25.2a.05.05 0 0 1 0 .08c-.4.24-.82.44-1.25.6a.05.05 0 0 0-.03.07c.24.47.52.92.82 1.34a.05.05 0 0 0 .06.02 13.2 13.2 0 0 0 4-2.03.05.05 0 0 0 .02-.03c.35-3.52-.57-6.57-2.4-9.28a.04.04 0 0 0-.02-.02ZM5.35 10.55c-.79 0-1.44-.72-1.44-1.6 0-.89.64-1.61 1.44-1.61.8 0 1.45.73 1.44 1.6 0 .89-.64 1.61-1.44 1.61Zm5.31 0c-.79 0-1.44-.72-1.44-1.6 0-.89.63-1.61 1.44-1.61.8 0 1.45.73 1.44 1.6 0 .89-.63 1.61-1.44 1.61Z" />
    </svg>
  );
}

function SlackMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-4.5" fill="currentColor" aria-hidden="true">
      <path d="M3.38 9.88A1.69 1.69 0 1 1 1.69 8.2h1.69v1.69Zm.85 0a1.69 1.69 0 1 1 3.38 0v4.23a1.69 1.69 0 1 1-3.38 0V9.88Zm1.69-6.76a1.69 1.69 0 1 1 1.69-1.69v1.69H5.92Zm0 .85a1.69 1.69 0 1 1 0 3.38H1.69a1.69 1.69 0 1 1 0-3.38h4.23Zm6.76 1.69a1.69 1.69 0 1 1 1.69 1.69h-1.69V5.66Zm-.85 0a1.69 1.69 0 1 1-3.38 0V1.43a1.69 1.69 0 1 1 3.38 0v4.23Zm-1.69 6.76a1.69 1.69 0 1 1-1.69 1.69v-1.69h1.69Zm0-.85a1.69 1.69 0 1 1 0-3.38h4.23a1.69 1.69 0 1 1 0 3.38h-4.23Z" />
    </svg>
  );
}

function LinearMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-4.5" fill="currentColor" aria-hidden="true">
      <path d="M2.15 13.85 13.85 2.15A6.77 6.77 0 0 0 2.15 13.85Zm.9-5.2 5.6-5.6a4.8 4.8 0 0 1 4.3-.9l-8.99 8.99a4.8 4.8 0 0 1-.9-2.49Zm4.3 4.3 5.6-5.6a4.8 4.8 0 0 1-.9 4.3l-1.2 1.2a4.8 4.8 0 0 1-2.5.1Z" />
    </svg>
  );
}
