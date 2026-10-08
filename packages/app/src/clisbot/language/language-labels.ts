import {
  LANGUAGE_NATIVE_NAMES,
  parseAppLanguage,
  type AppLanguage,
  type SupportedLocale,
} from "@/i18n/locales";

/**
 * The languages offered one tap away, most widely used first. Every supported locale is here:
 * the list is how someone stuck in a language they cannot read finds their own.
 */
export const QUICK_LANGUAGE_ORDER: readonly SupportedLocale[] = [
  "en",
  "vi",
  "zh-CN",
  "ko",
  "ja",
  "es",
  "pt-BR",
  "fr",
  "ru",
  "ar",
];

/** A language is always named in itself: the reader recognizes their own without a translation. */
export function nativeLanguageName(locale: SupportedLocale): string {
  return LANGUAGE_NATIVE_NAMES[locale];
}

/** The language the UI renders in under this setting: the chosen one, or what System resolved to. */
export function shownLanguageName(language: AppLanguage, activeLocale: SupportedLocale): string {
  return nativeLanguageName(language === "system" ? activeLocale : language);
}

/**
 * What the language dropdown shows. "System" alone hides which language the app picked, so a
 * wrong guess goes unnoticed; "System - English" names it.
 */
export function languageSelectionLabel(
  language: AppLanguage,
  activeLocale: SupportedLocale,
  systemLabel: string,
): string {
  const name = shownLanguageName(language, activeLocale);
  return language === "system" ? `${systemLabel} - ${name}` : name;
}

/** The locale the UI renders in, from i18next's current language. */
export function activeLocaleOf(i18nLanguage: string | undefined): SupportedLocale {
  const parsed = parseAppLanguage(i18nLanguage);
  return parsed && parsed !== "system" ? parsed : "en";
}
