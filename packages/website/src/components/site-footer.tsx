import { useTranslation } from "react-i18next";
import { PAGE_INSET_CLASS, PAGE_RAIL_CLASS } from "~/components/page-frame";
import { getAlternativePages } from "~/data/alternative-pages";
import { MOBILE_DOWNLOADS, webAppUrl } from "~/downloads";
import { openAnalyticsSettings } from "~/components/website-analytics";
import { useLocale, useLocalizePath } from "~/i18n";
import { PLUGINS_LINKED } from "~/plugins/launch";

interface SiteFooterProps {
  width?: "default" | "prose" | "wide";
  /** Pages that show the sponsors in their content turn the footer band off. */
  sponsors?: boolean;
}

const NON_DEFAULT_WIDTH_CLASSES: Record<
  Exclude<NonNullable<SiteFooterProps["width"]>, "default">,
  string
> = {
  prose: "max-w-prose p-6 md:p-12 md:pt-0",
  wide: "max-w-7xl p-6 md:p-20 md:pt-0",
};

const LINK_CLASS = "block text-muted-foreground transition-colors hover:text-foreground";
const COLUMN_HEADING_CLASS =
  "font-mono text-[11px] uppercase tracking-[0.12em] text-extra-muted-foreground";

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
      {children}
    </a>
  );
}

export function SiteFooter({ width = "default", sponsors: _sponsors = true }: SiteFooterProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const localize = useLocalizePath();
  const alternatives = getAlternativePages(locale);
  const page = (path: string, label: string) => (
    <a href={localize(path)} className={LINK_CLASS}>
      {label}
    </a>
  );

  const columns = (
    <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-5">
      <div className="space-y-3">
        <p className={COLUMN_HEADING_CLASS}>{t("footer.product")}</p>
        <div className="space-y-2">
          {page("/blog", t("footer.blog"))}
          {page("/docs", t("footer.docs"))}
          {PLUGINS_LINKED && page("/plugins", t("footer.plugins"))}
          {page("/changelog", t("footer.changelog"))}
          {page("/hub", t("footer.hub"))}
          {page("/docs/cli", t("footer.cli"))}
          {page("/privacy", t("footer.privacy"))}
          {page("/terms", t("footer.terms"))}
          {page("/sponsor", t("footer.sponsor"))}
          <button
            type="button"
            onClick={openAnalyticsSettings}
            className={`${LINK_CLASS} text-left`}
          >
            Cookie settings
          </button>
        </div>
      </div>
      <div className="space-y-3">
        <p className={COLUMN_HEADING_CLASS}>{t("footer.agents")}</p>
        <div className="space-y-2">
          {page("/claude-code", "Claude Code")}
          {page("/codex", "Codex")}
          {page("/opencode", "OpenCode")}
          {page("/antigravity", "Antigravity")}
          {page("/muse-code", "Muse Code")}
          {page("/agents", t("footer.allProviders"))}
        </div>
      </div>
      <div className="space-y-3">
        <p className={COLUMN_HEADING_CLASS}>{t("footer.alternatives")}</p>
        <div className="space-y-2">
          {alternatives.map((alternative) => (
            <a key={alternative.slug} href={localize(alternative.href)} className={LINK_CLASS}>
              {alternative.name}
            </a>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <p className={COLUMN_HEADING_CLASS}>{t("footer.community")}</p>
        <div className="space-y-2">
          <ExternalLink href="https://discord.gg/awGmcmFXC">Discord</ExternalLink>
          <ExternalLink href="https://www.reddit.com/r/ClisbotAI/">Reddit</ExternalLink>
          <ExternalLink href="https://github.com/longbkit/clisbot">GitHub</ExternalLink>
        </div>
      </div>
      <div className="space-y-3">
        <p className={COLUMN_HEADING_CLASS}>{t("footer.download")}</p>
        <div className="space-y-2">
          <a href={localize(MOBILE_DOWNLOADS.ios.href)} className={LINK_CLASS}>
            iOS
          </a>
          <span aria-disabled="true" className="block text-xs text-extra-muted-foreground">
            App Store — Pending
          </span>
          <a href={localize(MOBILE_DOWNLOADS.android.href)} className={LINK_CLASS}>
            Android
          </a>
          <span aria-disabled="true" className="block text-xs text-extra-muted-foreground">
            Google Play — Pending
          </span>
          <ExternalLink href="https://github.com/longbkit/clisbot/releases">
            {t("footer.desktop")}
          </ExternalLink>
          <ExternalLink href={webAppUrl}>{t("footer.webApp")}</ExternalLink>
        </div>
      </div>
    </div>
  );

  if (width === "default") {
    return (
      <footer className="border-t border-white/[0.07]">
        <div className={`${PAGE_RAIL_CLASS} ${PAGE_INSET_CLASS} py-12 md:py-14`}>{columns}</div>
      </footer>
    );
  }

  return (
    <footer className={`${NON_DEFAULT_WIDTH_CLASSES[width]} mx-auto mt-12 md:mt-16`}>
      <div className="border-t border-white/10 pt-8 pb-4">{columns}</div>
    </footer>
  );
}
