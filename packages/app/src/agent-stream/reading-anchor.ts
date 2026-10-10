interface RowGeometry {
  id: string;
  top: number;
  height: number;
}

// A row must clear the reading line before the next row takes ownership.
const READING_POSITION_OFFSET_PX = 8;

// Content coordinates survive user scrolling. Layout commits replace the geometry;
// scroll events reuse it, without another DOM measurement pass.
export function createReadingAnchor() {
  let anchor: RowGeometry | null = null;
  let geometry: readonly RowGeometry[] = [];
  const readingRow = (scrollTop: number) =>
    geometry.find((row) => row.top + row.height > scrollTop + READING_POSITION_OFFSET_PX);
  const project = (
    scrollTop: number,
    row: (Pick<RowGeometry, "id" | "top"> & Partial<Pick<RowGeometry, "height">>) | undefined,
  ) => {
    if (!anchor || row?.id !== anchor.id) return scrollTop;
    const movedTop = scrollTop + row.top - anchor.top;
    // Wheel input can enter the bottom of an image placeholder just before its
    // intrinsic size arrives. If that part disappears, preserve the distance to
    // its lower edge so the text immediately below cannot jump past the reader.
    const shrink = row.height === undefined ? 0 : Math.max(0, anchor.height - row.height);
    return shrink > 0 && movedTop + READING_POSITION_OFFSET_PX >= row.top + row.height!
      ? movedTop - shrink
      : movedTop;
  };
  return {
    getRowId: () => anchor?.id ?? null,
    getReadingRowId: (scrollTop: number) =>
      readingRow(scrollTop)?.id ?? geometry.at(-1)?.id ?? null,
    project,
    reset() {
      anchor = null;
    },
    scroll(scrollTop: number) {
      const next = readingRow(scrollTop);
      anchor = next ? { ...next } : null;
    },
    reconcile(scrollTop: number, rows: readonly RowGeometry[], userScrolled = false): number {
      geometry = rows;
      const previous = anchor && rows.find((row) => row.id === anchor?.id);
      // The first virtualized commit can precede its mounted range. Keep the
      // pinned reader until it mounts, rather than adopting an unrelated row.
      if (anchor && !previous && !userScrolled) return scrollTop;
      const correctedTop = project(scrollTop, previous ?? undefined);
      // A prepend can expose the bottom of an estimated row above the reader.
      // Do not transfer ownership to it until the user moves the reading position.
      const next = previous && !userScrolled ? previous : readingRow(correctedTop);
      anchor = next ? { ...next } : null;
      return correctedTop;
    },
  };
}
