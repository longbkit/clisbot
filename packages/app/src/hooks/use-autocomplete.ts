import { useCallback, useEffect, useRef, useState } from "react";
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
  optionsPosition?: AutocompleteOptionsPosition;
}

interface UseAutocompleteResult<TKeyPressEvent extends AutocompleteKeyPressEvent> {
  selectedIndex: number;
  /** Escape closed the list for this query; typing another query opens it again. */
  dismissed: boolean;
  onKeyPress: (event: TKeyPressEvent) => boolean;
}

function useSelectedIndex(input: {
  isVisible: boolean;
  count: number;
  query: string;
  optionsPosition?: AutocompleteOptionsPosition;
  onQueryChange: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const previousQueryRef = useRef("");
  const previousPositionRef = useRef(input.optionsPosition);
  const { onQueryChange } = input;
  useEffect(() => {
    if (previousQueryRef.current !== input.query) onQueryChange();
    if (!input.isVisible) {
      previousQueryRef.current = input.query;
      setSelectedIndex(-1);
      return;
    }
    // A list that moved to the input's other side starts again on the match next to the input.
    const queryChanged =
      previousQueryRef.current !== input.query ||
      previousPositionRef.current !== input.optionsPosition;
    previousQueryRef.current = input.query;
    previousPositionRef.current = input.optionsPosition;
    setSelectedIndex((current) => {
      if (input.count === 0) return -1;
      const fallbackIndex = getAutocompleteFallbackIndex(input.count, input.optionsPosition);
      if (queryChanged || current < 0 || current >= input.count) return fallbackIndex;
      return current;
    });
  }, [input.isVisible, input.count, input.query, input.optionsPosition, onQueryChange]);
  return [selectedIndex, setSelectedIndex] as const;
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
  const undismiss = useCallback(() => setDismissed(false), []);
  const [selectedIndex, setSelectedIndex] = useSelectedIndex({
    isVisible: input.isVisible,
    count: input.options.length,
    query: input.query,
    optionsPosition: input.optionsPosition,
    onQueryChange: undismiss,
  });
  const open = input.isVisible && !dismissed;

  const onKeyPress = useCallback(
    (event: TKeyPressEvent) => {
      if (!open) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return true;
      }
      const count = input.options.length;
      if (count === 0) return false;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const key = event.key;
        setSelectedIndex((current) =>
          getAutocompleteNextIndex({ currentIndex: current, itemCount: count, key }),
        );
        return true;
      }
      // Shift+Tab is focus navigation, never a completion.
      if (event.key === "Tab" && event.shiftKey) return false;
      if (event.key !== "Tab" && event.key !== "Enter") return false;
      event.preventDefault();
      const fallbackIndex = getAutocompleteFallbackIndex(count, input.optionsPosition);
      const resolvedIndex =
        selectedIndex >= 0 && selectedIndex < count ? selectedIndex : fallbackIndex;
      const selectedOption = input.options[resolvedIndex];
      if (selectedOption) {
        input.onSelectOption(selectedOption, event, event.key === "Tab" ? "accept" : "commit");
      }
      return true;
    },
    [input, open, selectedIndex, setSelectedIndex],
  );

  return { selectedIndex, dismissed, onKeyPress };
}
