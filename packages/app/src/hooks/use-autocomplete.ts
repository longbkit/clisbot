import { useCallback, useEffect, useState } from "react";
import {
  getAutocompleteFallbackIndex,
  getAutocompleteNextIndex,
  type AutocompleteOptionsPosition,
} from "@/components/ui/autocomplete-utils";

interface AutocompleteKeyPressEvent {
  key: string;
  shiftKey?: boolean;
  preventDefault: () => void;
}

/**
 * What picking an option asks for. Tab only accepts: it completes the text and never runs a
 * command. Enter commits: an immediate command runs. A terminal's completion keeps the two apart
 * the same way, so completing a command name can never also execute it.
 */
export type AutocompleteSelectIntent = "accept" | "commit";

interface UseAutocompleteInput<
  TOption,
  TKeyPressEvent extends AutocompleteKeyPressEvent = AutocompleteKeyPressEvent,
> {
  isVisible: boolean;
  options: readonly TOption[];
  query: string;
  onSelectOption: (
    option: TOption,
    event: TKeyPressEvent,
    intent: AutocompleteSelectIntent,
  ) => void;
  /** Runs after Escape closes the list; the text stays unless this changes it. */
  onEscape?: () => void;
  optionsPosition?: AutocompleteOptionsPosition;
  /**
   * Clisbot: whether the best match starts selected (default true). False leaves the list with
   * no selection until an arrow key picks a row, so Enter and Tab act on nothing.
   */
  preselect?: boolean;
}

interface UseAutocompleteResult<TKeyPressEvent extends AutocompleteKeyPressEvent> {
  selectedIndex: number;
  /** Escape closed the list for this query; typing another query opens it again. */
  dismissed: boolean;
  onKeyPress: (event: TKeyPressEvent) => boolean;
}

/**
 * Keyboard for an open option list, following the combobox pattern: arrows move the selection
 * and never pick, Tab completes, Enter picks, Escape closes the list and keeps the text. A list
 * that is closed (or dismissed) handles no key, so Tab and Shift+Tab move focus as usual.
 */
export function useAutocomplete<
  TOption,
  TKeyPressEvent extends AutocompleteKeyPressEvent = AutocompleteKeyPressEvent,
>(input: UseAutocompleteInput<TOption, TKeyPressEvent>): UseAutocompleteResult<TKeyPressEvent> {
  const [dismissed, setDismissed] = useState(false);
  // The user's choice, tied to the query (and the side of the input) it was made for. The shown
  // index is resolved from it during render, so a list never paints its first frame without a
  // selection: the popover only measures once a non-empty list has one. A list that moved to the
  // input's other side starts again on the match next to the input.
  const [choice, setChoice] = useState<SelectionChoice | null>(null);
  const itemCount = input.isVisible ? input.options.length : 0;
  const selectedIndex = resolveSelectedIndex({
    choice,
    query: input.query,
    itemCount,
    optionsPosition: input.optionsPosition,
    preselect: input.preselect ?? true,
  });
  const open = input.isVisible && !dismissed;

  // A choice belongs to one search, and Escape closes the list only for the query it was
  // pressed on. Until this clears them, the checks above ignore a stale choice.
  useEffect(() => {
    setChoice(null);
    setDismissed(false);
  }, [input.isVisible, input.query]);

  const onKeyPress = useCallback(
    (event: TKeyPressEvent) => {
      if (!open) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        input.onEscape?.();
        return true;
      }
      const count = input.options.length;
      if (count === 0) return false;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        setChoice({
          index: getAutocompleteNextIndex({
            currentIndex: selectedIndex,
            itemCount: count,
            key: event.key,
          }),
          query: input.query,
          optionsPosition: input.optionsPosition,
        });
        return true;
      }
      // Shift+Tab is focus navigation, never a completion.
      if (event.key === "Tab" && event.shiftKey) return false;
      if (event.key !== "Tab" && event.key !== "Enter") return false;
      event.preventDefault();
      const selectedOption = input.options[selectedIndex];
      if (selectedOption) {
        input.onSelectOption(selectedOption, event, event.key === "Tab" ? "accept" : "commit");
      }
      return true;
    },
    [input, open, selectedIndex],
  );

  return { selectedIndex, dismissed, onKeyPress };
}

interface SelectionChoice {
  index: number;
  query: string;
  optionsPosition: AutocompleteOptionsPosition | undefined;
}

function resolveSelectedIndex(input: {
  choice: SelectionChoice | null;
  query: string;
  itemCount: number;
  optionsPosition?: AutocompleteOptionsPosition;
  preselect: boolean;
}): number {
  const { choice } = input;
  if (
    choice &&
    choice.query === input.query &&
    choice.optionsPosition === input.optionsPosition &&
    choice.index >= 0 &&
    choice.index < input.itemCount
  ) {
    return choice.index;
  }
  if (!input.preselect) return -1;
  return getAutocompleteFallbackIndex(input.itemCount, input.optionsPosition);
}
