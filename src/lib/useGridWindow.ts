"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Windowing for a plain CSS grid — no virtualization dependency, and no
 * change to how the grid is laid out.
 *
 * The project file grid is `grid-cols-2 sm:3 md:4 … 2xl:7`, so the column
 * count is owned by CSS, not by us. Rather than reimplement the breakpoints
 * in JS (two sources of truth that WILL drift), we read the resolved
 * `grid-template-columns` back off the element and measure the real cells.
 *
 * Off-window rows are replaced by two empty grid items that `grid-row: span N`
 * across the skipped tracks. Spanning tracks rather than emitting pixel
 * spacers means the gap arithmetic is the browser's problem, not ours — but
 * it only works if the skipped (empty) tracks have a height, which is what
 * `gridAutoRows` is for. Hence `rowHeight`: measured from the tallest real
 * cell, applied back to the grid, and re-measured if any cell ever overflows
 * it (see the tripwire in `measure`).
 */

export type GridWindow = {
  /** First item index to render (inclusive). */
  startIndex: number;
  /** Last item index to render (exclusive). */
  endIndex: number;
  /** Grid rows the leading spacer must span; 0 means render no spacer. */
  spanBefore: number;
  /** Grid rows the trailing spacer must span; 0 means render no spacer. */
  spanAfter: number;
  /**
   * Value for the grid's `grid-auto-rows`. `undefined` during the bootstrap
   * pass, when cells must keep their natural height so they can be measured.
   */
  rowHeight: number | undefined;
  /** False during the bootstrap pass, before anything has been measured. */
  measured: boolean;
};

type Metrics = {
  columns: number;
  rowHeight: number;
  gridWidth: number;
  gap: number;
};

/**
 * Rows rendered above and below the viewport. 3 rows ≈ 21 tiles at the widest
 * breakpoint — enough that a flick scroll doesn't show a blank band, cheap
 * enough that it doesn't matter when it's never seen.
 */
const OVERSCAN_ROWS = 3;

/**
 * Items rendered on the very first pass, before anything can be measured.
 * 42 = 7 columns (the 2xl grid) × 6 rows, which fills the tallest realistic
 * viewport at the widest breakpoint. Measurement happens in a layout effect,
 * so a large grid never actually paints this count.
 */
const BOOTSTRAP_ITEMS = 42;

/**
 * Below this many items the whole grid renders and the measurement machinery
 * stays out of the way. 80 is ~2× a full 2xl viewport (42): no small project
 * pays for the spacer math, no large project misses the window.
 */
export const GRID_WINDOW_THRESHOLD = 80;

export function useGridWindow({
  scrollRef,
  gridRef,
  itemCount,
  enabled = true,
}: {
  scrollRef: React.RefObject<HTMLElement | null>;
  gridRef: React.RefObject<HTMLElement | null>;
  itemCount: number;
  enabled?: boolean;
}): GridWindow {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [rows, setRows] = useState({ start: 0, end: 0 });
  const frameRef = useRef<number | null>(null);

  const active = enabled && itemCount > GRID_WINDOW_THRESHOLD;

  const measure = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const style = window.getComputedStyle(grid);
    const columns = style.gridTemplateColumns.split(" ").filter(Boolean).length;
    const gap = Number.parseFloat(style.rowGap) || 0;
    const gridWidth = grid.clientWidth;
    const cells = grid.querySelectorAll<HTMLElement>("[data-grid-cell]");
    if (!columns || cells.length === 0 || gridWidth === 0) return;

    setMetrics((prev) => {
      // A width change means the tiles (aspect-video) changed height too —
      // throw the measurement away and re-bootstrap at natural heights.
      if (prev && prev.gridWidth !== gridWidth) return null;

      let tallest = 0;
      for (const cell of cells) {
        // scrollHeight, not the rect: once `gridAutoRows` is applied the rect
        // reports the track height for every cell. scrollHeight still reports
        // what the (overflow-hidden) tile actually needs — which is how a
        // too-small rowHeight gets caught instead of silently clipping.
        tallest = Math.max(tallest, cell.scrollHeight);
      }
      if (tallest <= 0) return prev;

      if (!prev || prev.columns !== columns) {
        return { columns, rowHeight: tallest, gridWidth, gap };
      }
      if (tallest > prev.rowHeight + 0.5) {
        // Tripwire: the row track was sized from the tiles visible at the
        // time, and a taller kind of tile has since scrolled in. Grow, and
        // say so — a silently clipped tile is the failure this prevents.
        console.warn(
          `[useGridWindow] row height ${prev.rowHeight.toFixed(1)}px too small for a ${tallest.toFixed(1)}px cell; growing.`,
        );
        return { columns, rowHeight: tallest, gridWidth, gap };
      }
      return prev.gap === gap ? prev : { ...prev, gap };
    });
  }, [gridRef]);

  const update = useCallback(() => {
    const grid = gridRef.current;
    const scroller = scrollRef.current;
    if (!grid || !scroller || !metrics) return;
    const stride = metrics.rowHeight + metrics.gap;
    if (stride <= 0) return;
    const totalRows = Math.ceil(itemCount / metrics.columns);
    // Grid offset inside the scroller's content box. Recomputed each frame
    // because the folder row and contract strip above it change height.
    const gridTop =
      grid.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    const viewTop = scroller.scrollTop - gridTop;
    const visibleRows = Math.ceil(scroller.clientHeight / stride) + 1;
    const start = Math.min(
      Math.max(0, Math.floor(viewTop / stride) - OVERSCAN_ROWS),
      Math.max(0, totalRows - 1),
    );
    const end = Math.min(totalRows, start + visibleRows + OVERSCAN_ROWS * 2);
    setRows((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
    );
  }, [gridRef, scrollRef, itemCount, metrics]);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      update();
    });
  }, [update]);

  // Re-measure after every commit that could have changed the layout. Cheap
  // (one getComputedStyle plus a pass over the ~40 rendered cells) and it
  // keeps the window honest across breakpoints, sidebar collapse, and font
  // loading. `setMetrics` bails out when nothing moved, so it settles.
  useLayoutEffect(() => {
    if (!active) return;
    measure();
    update();
  });

  useEffect(() => {
    if (!active) return;
    const scroller = scrollRef.current;
    const grid = gridRef.current;
    if (!scroller) return;

    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            measure();
            schedule();
          })
        : null;
    observer?.observe(scroller);
    if (grid) observer.observe(grid);

    return () => {
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [active, gridRef, measure, schedule, scrollRef]);

  if (!active) {
    return {
      startIndex: 0,
      endIndex: itemCount,
      spanBefore: 0,
      spanAfter: 0,
      rowHeight: undefined,
      measured: true,
    };
  }

  if (!metrics) {
    // Bootstrap pass: natural heights, and enough cells to fill any viewport
    // so the layout effect above has something real to measure.
    return {
      startIndex: 0,
      endIndex: Math.min(itemCount, BOOTSTRAP_ITEMS),
      spanBefore: 0,
      spanAfter: 0,
      rowHeight: undefined,
      measured: false,
    };
  }

  const { columns, rowHeight } = metrics;
  const totalRows = Math.ceil(itemCount / columns);
  const startRow = Math.min(rows.start, Math.max(0, totalRows - 1));
  const endRow = Math.min(totalRows, Math.max(rows.end, startRow + 1));

  return {
    startIndex: startRow * columns,
    endIndex: Math.min(itemCount, endRow * columns),
    spanBefore: startRow,
    spanAfter: Math.max(0, totalRows - endRow),
    rowHeight,
    measured: true,
  };
}
