import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useWindowDimensions, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Globe } from "lucide-react-native";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { Button } from "@/components/ui/button";
import { buttonIconSize } from "@/components/ui/control-geometry";
import { isWeb } from "@/constants/platform";
import type { AppLanguage, SupportedLocale } from "@/i18n/locales";
import type { Theme } from "@/styles/theme";
import {
  QUICK_LANGUAGE_ORDER,
  activeLocaleOf,
  languageSelectionLabel,
  nativeLanguageName,
  shownLanguageName,
} from "./language-labels";

const ThemedGlobe = withUnistyles(Globe);
const globeColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const GLOBE_ICON = <ThemedGlobe size={buttonIconSize.sm} uniProps={globeColor} />;

/** Below this window width the dropdown drops its "System - " prefix and names only the language. */
const NARROW_WINDOW_WIDTH = 360;

export interface LanguagePickerProps {
  language: AppLanguage;
  onChange: (language: AppLanguage) => void;
}

interface LanguageDropdownProps extends LanguagePickerProps {
  /** Name only the language, without "System - ", where the row has no room for both. */
  nameOnly?: boolean;
}

/** The locale the UI is rendering in right now. */
function useActiveLocale(): SupportedLocale {
  const { i18n } = useTranslation();
  return activeLocaleOf(i18n.language);
}

/** A globe and the language by name, so the control reads as "language" in any language. */
export function LanguageDropdown({ language, onChange, nameOnly }: LanguageDropdownProps) {
  const { t } = useTranslation();
  const activeLocale = useActiveLocale();
  const narrowWindow = useWindowDimensions().width < NARROW_WINDOW_WIDTH;
  const systemLabel = t("settings.general.language.options.system");
  const label =
    nameOnly || narrowWindow
      ? shownLanguageName(language, activeLocale)
      : languageSelectionLabel(language, activeLocale, systemLabel);
  return (
    // The trigger keeps its content width unless the row runs out; then its label truncates.
    <View style={styles.dropdown}>
      <DropdownMenu>
        <DropdownTrigger
          accessibilityRole="button"
          accessibilityLabel={`${t("settings.general.language.label")}: ${label}`}
          leading={GLOBE_ICON}
          testID="language-dropdown"
        >
          {label}
        </DropdownTrigger>
        <DropdownMenuContent side="bottom" align="end" width={240}>
          <LanguageMenuItem
            value="system"
            label={languageSelectionLabel("system", activeLocale, systemLabel)}
            selected={language === "system"}
            onChange={onChange}
          />
          <DropdownMenuSeparator />
          {QUICK_LANGUAGE_ORDER.map((locale) => (
            <LanguageMenuItem
              key={locale}
              value={locale}
              label={nativeLanguageName(locale)}
              selected={language === locale}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

interface LanguageMenuItemProps {
  value: AppLanguage;
  label: string;
  selected: boolean;
  onChange: (language: AppLanguage) => void;
}

function LanguageMenuItem({ value, label, selected, onChange }: LanguageMenuItemProps) {
  const handleSelect = useCallback(() => onChange(value), [onChange, value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

interface LanguageQuickListProps extends LanguagePickerProps {
  /** Centered under a centered screen; otherwise its text sits on the surrounding left rail. */
  centered?: boolean;
}

/**
 * Every supported language, named in itself and one tap away. The one the UI renders in is
 * checked, so "System" never hides a wrong guess.
 */
export function LanguageQuickList({ language, onChange, centered }: LanguageQuickListProps) {
  const activeLocale = useActiveLocale();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[styles.list, centered ? styles.listCentered : styles.listOnRail]}
    >
      {QUICK_LANGUAGE_ORDER.map((locale) => (
        <QuickLanguage
          key={locale}
          locale={locale}
          active={locale === activeLocale}
          explicit={language === locale}
          onChange={onChange}
        />
      ))}
    </View>
  );
}

interface QuickLanguageProps {
  locale: SupportedLocale;
  /** The UI renders in this language. */
  active: boolean;
  /** This language is the saved choice, not just what System resolved to. */
  explicit: boolean;
  onChange: (language: AppLanguage) => void;
}

function QuickLanguage({ locale, active, explicit, onChange }: QuickLanguageProps) {
  // Picking the language System already resolved to pins it: the choice should survive a
  // change of the device language, the same as choosing it in the dropdown.
  const handlePress = useCallback(() => {
    if (!explicit) onChange(locale);
  }, [explicit, locale, onChange]);
  return (
    <Button
      variant="ghost"
      size="xs"
      onPress={handlePress}
      style={active ? styles.itemActive : styles.item}
      textStyle={active ? styles.itemTextActive : undefined}
      accessibilityRole="radio"
      aria-checked={active}
      // iOS reads the name in its own voice; react-native-web takes `lang` instead.
      accessibilityLanguage={locale}
      {...(isWeb ? { lang: locale } : null)}
      testID={`language-quick-${locale}`}
    >
      {nativeLanguageName(locale)}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  dropdown: {
    flexShrink: 1,
    minWidth: 0,
  },
  list: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: theme.spacing[1],
  },
  listCentered: {
    justifyContent: "center",
  },
  // Pull the first item's padding out so its text lines up with the row title above.
  listOnRail: {
    marginLeft: -theme.spacing[1.5],
  },
  // Narrower than the xs Button's own padding so all ten names fit one line on a desktop card.
  item: {
    paddingHorizontal: theme.spacing[1.5],
  },
  itemActive: {
    paddingHorizontal: theme.spacing[1.5],
    backgroundColor: theme.colors.surface2,
  },
  itemTextActive: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
}));
