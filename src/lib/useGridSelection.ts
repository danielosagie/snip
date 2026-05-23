import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Reusable multi-select model for any grid/list of items keyed by string id.
 * Mirrors the dashboard's selection behavior so other surfaces (file lists,
 * folder rows, the share grid) can adopt the same shift-range + Cmd/Ctrl
 * semantics instead of re-implementing them.
 *
 *  • plain click        → select only that item
 *  • Cmd/Ctrl + click   → toggle that item, keep the rest
 *  • Shift + click      → extend the range from the anchor to the clicked item
 *
 * `handleClick` takes the currently-rendered ordered id list so Shift-range
 * follows the visual order regardless of sort/filter.
 */
export interface GridSelection<T extends string> {
  selected: Set<T>;
  isSelected: (id: T) => boolean;
  count: number;
  handleClick: (
    id: T,
    mods: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
    orderedIds: T[],
  ) => void;
  toggle: (id: T) => void;
  selectOnly: (id: T) => void;
  selectAll: (ids: T[]) => void;
  clear: () => void;
  setSelected: (next: Set<T>) => void;
}

export function useGridSelection<T extends string>(): GridSelection<T> {
  const [selected, setSelected] = useState<Set<T>>(() => new Set());
  const anchorRef = useRef<T | null>(null);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  const toggle = useCallback((id: T) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = id;
  }, []);

  const selectOnly = useCallback((id: T) => {
    setSelected(new Set([id]));
    anchorRef.current = id;
  }, []);

  const selectAll = useCallback((ids: T[]) => {
    setSelected(new Set(ids));
  }, []);

  const handleClick = useCallback(
    (
      id: T,
      mods: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
      orderedIds: T[],
    ) => {
      if (mods.shiftKey && anchorRef.current) {
        const a = orderedIds.indexOf(anchorRef.current);
        const b = orderedIds.indexOf(id);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const range = orderedIds.slice(lo, hi + 1);
          setSelected((prev) => {
            const next = new Set(prev);
            for (const r of range) next.add(r);
            return next;
          });
          return;
        }
      }
      if (mods.metaKey || mods.ctrlKey) {
        toggle(id);
        return;
      }
      selectOnly(id);
    },
    [toggle, selectOnly],
  );

  const isSelected = useCallback((id: T) => selected.has(id), [selected]);

  return useMemo(
    () => ({
      selected,
      isSelected,
      count: selected.size,
      handleClick,
      toggle,
      selectOnly,
      selectAll,
      clear,
      setSelected,
    }),
    [selected, isSelected, handleClick, toggle, selectOnly, selectAll, clear],
  );
}
