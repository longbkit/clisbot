import { formatWithOptions } from "node:util";

type ConsoleMethod = "log" | "info" | "warn" | "error";

function prefixLogLines(text: string, timestamp: string) {
  return text
    .split("\n")
    .map((line) => `[${timestamp}] ${line}`)
    .join("\n");
}

export function formatTimestampedLogMessage(
  args: unknown[],
  now: Date = new Date(),
) {
  const timestamp = now.toISOString();
  if (args.length === 0) {
    return `[${timestamp}]`;
  }

  const rendered = formatWithOptions(
    {
      colors: false,
      depth: null,
    },
    ...args,
  );
  return prefixLogLines(rendered, timestamp);
}

export function installRuntimeConsoleTimestamps() {
  const originals = new Map<ConsoleMethod, Console[ConsoleMethod]>();
  const methods: ConsoleMethod[] = ["log", "info", "warn", "error"];

  for (const method of methods) {
    const original = console[method].bind(console) as Console[ConsoleMethod];
    originals.set(method, original);
    console[method] = ((...args: unknown[]) => {
      original(formatTimestampedLogMessage(args));
    }) as Console[ConsoleMethod];
  }

  return () => {
    for (const method of methods) {
      const original = originals.get(method);
      if (original) {
        console[method] = original;
      }
    }
  };
}
