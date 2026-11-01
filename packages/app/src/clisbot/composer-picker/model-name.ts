/**
 * The composer's Model chip is short: the provider icon already says who makes the model,
 * so the family prefix ("GPT-", "Claude ", "Gemini ") is dropped and hyphens become spaces.
 * "GPT-6-Astra" reads "6 Astra"; "Claude Opus 5.5" reads "Opus 5.5".
 */
const FAMILY_PREFIX = /^(gpt|claude|gemini)[\s-]+/i;

export function formatCompactModelName(label: string): string {
  const trimmed = label.trim();
  const withoutFamily = trimmed.replace(FAMILY_PREFIX, "");
  const spaced = withoutFamily.replace(/-+/g, " ").replace(/\s+/g, " ").trim();
  return spaced.length > 0 ? spaced : trimmed;
}

/** The chip's text: the short model name, then the effort when the model has one. */
export function formatModelChipLabel(modelLabel: string, effortLabel: string | null): string {
  const name = formatCompactModelName(modelLabel);
  return effortLabel ? `${name} ${effortLabel}` : name;
}
