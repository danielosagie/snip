"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Lightweight, dependency-free right-click context menu. Wrap any element with
 * <ContextMenu items={...}> — the wrapper uses `display: contents` so it never
 * affects layout. The menu renders in a portal at the cursor, clamps to the
 * viewport, and closes on outside click / Esc / scroll. Items are flat with
 * optional separators; pass a function for `items` to compute them lazily at
 * open time (e.g. based on current selection).
 */

export type ContextMenuEntry =
  | {
      type?: "item";
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
    }
  | { type: "separator"; key?: string };

const MENU_WIDTH = 220;

export function ContextMenu({
  items,
  children,
  disabled,
}: {
  items: ContextMenuEntry[] | (() => ContextMenuEntry[]);
  children: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [entries, setEntries] = useState<ContextMenuEntry[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const resolved = typeof items === "function" ? items() : items;
      if (resolved.length === 0) return;
      setEntries(resolved);
      setCoords({ x: e.clientX, y: e.clientY });
      setOpen(true);
    },
    [disabled, items],
  );

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open, close]);

  // Clamp the menu inside the viewport once it has a measured height.
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    const nextX = Math.max(8, Math.min(coords.x, maxX));
    const nextY = Math.max(8, Math.min(coords.y, maxY));
    if (nextX !== coords.x || nextY !== coords.y) {
      setCoords({ x: nextX, y: nextY });
    }
  }, [open, coords.x, coords.y, entries]);

  return (
    <span style={{ display: "contents" }} onContextMenu={handleContextMenu}>
      {children}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-[100] border-2 border-[#1a1a1a] bg-[#f0f0e8] py-1 shadow-[6px_6px_0px_0px_rgba(0,0,0,0.15)]"
              style={{ left: coords.x, top: coords.y, minWidth: MENU_WIDTH }}
            >
              {entries.map((entry, idx) => {
                if (entry.type === "separator") {
                  return (
                    <div
                      key={entry.key ?? `sep-${idx}`}
                      className="my-1 h-0.5 bg-[#1a1a1a]/15"
                    />
                  );
                }
                return (
                  <button
                    key={`${entry.label}-${idx}`}
                    type="button"
                    role="menuitem"
                    disabled={entry.disabled}
                    onClick={() => {
                      close();
                      entry.onSelect();
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      entry.danger
                        ? "text-[#dc2626] hover:bg-[#fde2e2]"
                        : "text-[#1a1a1a] hover:bg-[#FFEDD5]",
                    )}
                  >
                    {entry.icon ? (
                      <span className="flex h-4 w-4 items-center justify-center">
                        {entry.icon}
                      </span>
                    ) : null}
                    {entry.label}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
