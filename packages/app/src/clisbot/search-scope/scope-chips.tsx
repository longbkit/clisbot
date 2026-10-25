import { useCallback } from "react";
import { withUnistyles } from "react-native-unistyles";
import { Building2, Filter, FolderGit2, Server, X } from "lucide-react-native";
import { ScopeChip, type ScopeChipIcon } from "@/command-center/scope-chip";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useSearchScopeTranslation } from "@/i18n/search-scope";
import type { SearchScopeCatalog } from "./catalog";
import { searchScopeChipId, type SearchScopeChip } from "./model";

const muted = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
const ThemedServer = withUnistyles(Server, muted);
const ThemedHub = withUnistyles(Building2, muted);
const ThemedProject = withUnistyles(FolderGit2, muted);
const ThemedFilter = withUnistyles(Filter, muted);
const ThemedX = withUnistyles(X, muted);

const CHIP_ICONS: Record<SearchScopeChip["kind"], ScopeChipIcon> = {
  host: ThemedServer,
  hub: ThemedHub,
  project: ThemedProject,
};

function Chip({
  chip,
  catalog,
  remove,
}: {
  chip: SearchScopeChip;
  catalog: SearchScopeCatalog | null;
  remove(id: string): void;
}) {
  const { t } = useSearchScopeTranslation();
  const id = searchScopeChipId(chip);
  const press = useCallback(() => remove(id), [id, remove]);
  const hub = chip.kind === "hub" ? catalog?.hubByOrigin.get(chip.origin) : null;
  const label = hub ? t("chip.hub", { name: chip.label, count: hub.serverIds.length }) : chip.label;
  return (
    <ScopeChip
      label={label}
      icon={CHIP_ICONS[chip.kind]}
      onPress={press}
      accessibilityLabel={t("chip.remove", { label })}
      testID={`command-center-scope-chip-${id}`}
    />
  );
}

export interface ScopeChipsProps {
  chips: readonly SearchScopeChip[];
  catalog: SearchScopeCatalog | null;
  /** "Only current filter (sandbox-12)", offered only while no chip is set (R1). */
  suggestion: { label: string; apply(): void } | null;
  remove(id: string): void;
  clear(): void;
}

/** The scope chips in the search field, in the order they were added. */
export function ScopeChips({ chips, catalog, suggestion, remove, clear }: ScopeChipsProps) {
  const { t } = useSearchScopeTranslation();
  if (chips.length === 0) {
    if (!suggestion) return null;
    return (
      <ScopeChip
        suggestion
        label={t("chip.onlyCurrentFilter", { label: suggestion.label })}
        icon={ThemedFilter}
        onPress={suggestion.apply}
        testID="command-center-scope-suggestion"
      />
    );
  }
  return (
    <>
      {chips.map((chip) => (
        <Chip key={searchScopeChipId(chip)} chip={chip} catalog={catalog} remove={remove} />
      ))}
      {chips.length > 1 ? (
        <ToolbarButton
          label={t("chip.clearAll")}
          onPress={clear}
          testID="command-center-scope-clear"
        >
          <ThemedX size={14} strokeWidth={2.2} />
        </ToolbarButton>
      ) : null}
    </>
  );
}
