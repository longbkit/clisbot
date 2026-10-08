import { connectorTools } from "./tools";
import { connectorsScreen } from "./screen";

type ConnectorsLocale = "en" | "ar" | "es" | "fr" | "ja" | "ko" | "pt-BR" | "ru" | "vi" | "zh-CN";

/** One locale's Connectors copy, `connectors.<area>.…` in `t()`. */
function connectorsFor<L extends ConnectorsLocale>(locale: L) {
  return { screen: connectorsScreen[locale], tools: connectorTools[locale] };
}

export const connectors = {
  en: connectorsFor("en"),
  ar: connectorsFor("ar"),
  es: connectorsFor("es"),
  fr: connectorsFor("fr"),
  ja: connectorsFor("ja"),
  ko: connectorsFor("ko"),
  "pt-BR": connectorsFor("pt-BR"),
  ru: connectorsFor("ru"),
  vi: connectorsFor("vi"),
  "zh-CN": connectorsFor("zh-CN"),
};
