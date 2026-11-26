/**
 * Native terminal renderer. The caller owns terminal state (xterm), input and gestures; this view
 * shapes and paints one frame of terminal cells on the authoritative cell grid and reports the
 * cell size its font produces.
 *
 * Colors are unsigned 32-bit ARGB numbers (`0xAARRGGBB`). Alpha 0 means "not painted".
 */
export interface ClisbotTerminalFrame {
  /** Columns the frame paints. Cells beyond it are clipped. */
  columns: number;
  rows: ClisbotTerminalRow[];
  cursor: ClisbotTerminalCursor | null;
  selection: ClisbotTerminalSelection | null;
}

/**
 * One terminal row. Cells start at column 0 and are consecutive. `text` is every cell's text in
 * order, so cell `i` owns the next `cells[2i]` UTF-16 code units of `text` and covers the next
 * `cells[2i + 1]` columns. Style spans are consecutive from column 0 and cover all columns.
 */
export interface ClisbotTerminalRow {
  text: string;
  /** Flattened `[utf16Length, columnSpan]` per cell. */
  cells: number[];
  /** Flattened `[columnCount, foreground, background, flags]` per style span. */
  styles: number[];
}

export interface ClisbotTerminalCursor {
  row: number;
  col: number;
}

/** Inclusive cell range in frame rows. A cell is selected when any of its columns is. */
export interface ClisbotTerminalSelection {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface ClisbotTerminalTheme {
  background: number;
  cursor: number;
  selectionBackground: number;
}

export interface ClisbotTerminalCellMetrics {
  cellWidth: number;
  cellHeight: number;
}

export const CLISBOT_TERMINAL_STYLE_FLAGS = {
  bold: 1,
  italic: 2,
  underline: 4,
  strikethrough: 8,
  dim: 16,
} as const;
