import { botsChat } from "./chat";
import { botsWorkspace } from "./workspace";

type BotsLocale = "en" | "ar" | "es" | "fr" | "ja" | "ko" | "pt-BR" | "ru" | "vi" | "zh-CN";

/** One locale's Bots & Chats copy, `bots.<area>.…` in `t()`. */
function botsFor<L extends BotsLocale>(locale: L) {
  return { chat: botsChat[locale], workspace: botsWorkspace[locale] };
}

export const bots = {
  en: botsFor("en"),
  ar: botsFor("ar"),
  es: botsFor("es"),
  fr: botsFor("fr"),
  ja: botsFor("ja"),
  ko: botsFor("ko"),
  "pt-BR": botsFor("pt-BR"),
  ru: botsFor("ru"),
  vi: botsFor("vi"),
  "zh-CN": botsFor("zh-CN"),
};
