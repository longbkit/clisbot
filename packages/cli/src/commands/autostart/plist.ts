import type { AutostartTarget } from "./targets.js";

type PlistValue = string | string[] | boolean | { [key: string]: PlistValue };

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plistValue(value: PlistValue): string[] {
  if (typeof value === "boolean") return [value ? "<true/>" : "<false/>"];
  if (typeof value === "string") return [`<string>${escapeXml(value)}</string>`];
  if (Array.isArray(value))
    return ["<array>", ...value.map((item) => `<string>${escapeXml(item)}</string>`), "</array>"];
  return plistDictionary(Object.entries(value));
}

function plistDictionary(entries: Array<[string, PlistValue]>): string[] {
  const lines = ["<dict>"];
  for (const [key, value] of entries) {
    lines.push(`<key>${escapeXml(key)}</key>`, ...plistValue(value));
  }
  lines.push("</dict>");
  return lines;
}

/** KeepAlive with SuccessfulExit=false: a crash is restarted, a deliberate
 * `launchctl bootout` or clean daemon stop is not. */
export function renderAutostartPlist(target: AutostartTarget): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    ...plistDictionary([
      ["Label", target.label],
      ["ProgramArguments", target.argv],
      ["EnvironmentVariables", target.environment],
      ["WorkingDirectory", target.workingDirectory],
      ["RunAtLoad", true],
      ["KeepAlive", { SuccessfulExit: false }],
      ["StandardOutPath", target.standardOutPath],
      ["StandardErrorPath", target.standardErrorPath],
    ]),
    "</plist>",
    "",
  ].join("\n");
}
