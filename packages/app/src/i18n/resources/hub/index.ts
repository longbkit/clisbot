import { hubConnection } from "./connection";
import { hubAccount } from "./account";
import { hubSettings } from "./settings";
import { hubAccess } from "./access";
import { hubTeam } from "./team";
import { hubChannels } from "./channels";
import { hubRoutes } from "./routes";
import { hubAutomations } from "./automations";

type HubLocale = "en" | "ar" | "es" | "fr" | "ja" | "ko" | "pt-BR" | "ru" | "vi" | "zh-CN";

/** One locale's Hub copy, `hub.<area>.…` in `t()`. Each area lives in its own module so
 * the Hub screens can be translated area by area. */
function hubFor<L extends HubLocale>(locale: L) {
  return {
    connection: hubConnection[locale],
    account: hubAccount[locale],
    settings: hubSettings[locale],
    access: hubAccess[locale],
    team: hubTeam[locale],
    channels: hubChannels[locale],
    routes: hubRoutes[locale],
    automations: hubAutomations[locale],
  };
}

export const hub = {
  en: hubFor("en"),
  ar: hubFor("ar"),
  es: hubFor("es"),
  fr: hubFor("fr"),
  ja: hubFor("ja"),
  ko: hubFor("ko"),
  "pt-BR": hubFor("pt-BR"),
  ru: hubFor("ru"),
  vi: hubFor("vi"),
  "zh-CN": hubFor("zh-CN"),
};
