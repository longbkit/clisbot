/** Portable CommonMark; channel adapters own native formatting and escaping. */
export function literalText(value: string): string {
  return value.replace(/[\r\n]/gu, " ").replace(/([\\`*_{}[\]<>#!|~])/gu, "\\$1");
}

export function inlineCode(value: string): string {
  const text = value.replace(/[\r\n]/gu, " ");
  let longest = 0;
  for (const match of text.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(longest + 1);
  const padding = /`|^ | $/u.test(text) && !/^ +$/u.test(text) ? " " : "";
  return `${fence}${padding}${text}${padding}${fence}`;
}
