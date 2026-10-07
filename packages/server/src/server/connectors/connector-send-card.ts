import { isRecord } from "./connector-json.js";

/**
 * What a send card shows (docs/features/connectors/README.md, "Runtime"): each argument of the
 * send as a labelled line ("To", "Subject", "Attendees"), so the person reads who receives what
 * instead of raw JSON. The request's `input` keeps the arguments for clients without the card.
 */

export interface SendCardField {
  label: string;
  value: string;
}

const MAX_FIELDS = 20;
const MAX_VALUE = 400;

/** `{ sends: [{ tool, arguments }] }` for several sends (`sendInput`), else one send's arguments. */
export function sendCardFields(input: Record<string, unknown>): SendCardField[] {
  const sends = Array.isArray(input.sends) ? input.sends : null;
  if (!sends) return fieldsOf(input, "").slice(0, MAX_FIELDS);
  return sends
    .flatMap((send, index) =>
      isRecord(send) && isRecord(send.arguments) ? fieldsOf(send.arguments, `${index + 1} · `) : [],
    )
    .slice(0, MAX_FIELDS);
}

function fieldsOf(args: Record<string, unknown>, prefix: string): SendCardField[] {
  return Object.entries(args).flatMap(([key, value]) => {
    const text = valueText(value);
    return text === null ? [] : [{ label: `${prefix}${labelOf(key)}`, value: text }];
  });
}

/** `start_datetime` and `startDateTime` read "Start date time". */
function labelOf(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  const sentence = words.join(" ") || key;
  return sentence[0]!.toUpperCase() + sentence.slice(1);
}

function valueText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return clip(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => (isRecord(item) ? personOf(item) : valueText(item)));
    const shown = items.filter((item): item is string => item !== null);
    return shown.length > 0 ? clip(shown.join(", ")) : null;
  }
  return isRecord(value) ? clip(JSON.stringify(value)) : null;
}

/** An attendee or recipient object reads as its address. */
function personOf(item: Record<string, unknown>): string {
  const address = item.email ?? item.address ?? item.emailAddress;
  return typeof address === "string" ? address : JSON.stringify(item);
}

function clip(text: string): string {
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
}
