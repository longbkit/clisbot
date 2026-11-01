import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { TextRange } from "./picker-search";

interface LabelPiece {
  start: number;
  text: string;
  matched: boolean;
}

export function splitLabel(text: string, ranges: readonly TextRange[]): LabelPiece[] {
  const pieces: LabelPiece[] = [];
  let at = 0;
  for (const range of ranges) {
    if (range.start > at)
      pieces.push({ start: at, text: text.slice(at, range.start), matched: false });
    pieces.push({ start: range.start, text: text.slice(range.start, range.end), matched: true });
    at = range.end;
  }
  if (at < text.length) pieces.push({ start: at, text: text.slice(at), matched: false });
  return pieces;
}

/** A model name with the characters a search matched in bold, nested in the row's own Text. */
export function HighlightedLabel({ text, ranges }: { text: string; ranges: readonly TextRange[] }) {
  return (
    <>
      {splitLabel(text, ranges).map((piece) =>
        piece.matched ? (
          <Text key={piece.start} style={styles.match} testID="composer-picker-match">
            {piece.text}
          </Text>
        ) : (
          <Text key={piece.start}>{piece.text}</Text>
        ),
      )}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  match: {
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
}));
