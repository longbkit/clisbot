import { i18n } from "@/i18n/i18next";

/** A Hub enum value shown as a label: `member` → `Member`, `owner` → `Owner`. */
export function capitalizeLabel(value: string): string {
  if (value.length === 0) return value;
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

/** `count` with the word that agrees with it: `plural(1, "Team")` → `Team`. */
export function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return count === 1 ? singular : pluralValue;
}

/** `3 Teams`, `1 Team`. */
export function countLabel(count: number, singular: string, pluralValue?: string): string {
  return `${String(count)} ${plural(count, singular, pluralValue)}`;
}

/** An organization role as the UI names it, in the app language. */
export function organizationRoleLabel(role: "owner" | "admin" | "member"): string {
  switch (role) {
    case "owner":
      return i18n.t("hub.settings.roles.owner");
    case "admin":
      return i18n.t("hub.settings.roles.admin");
    case "member":
      return i18n.t("hub.settings.roles.member");
  }
}
