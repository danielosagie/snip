"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ContextMenuEntry } from "@/components/ui/context-menu";
import type { VideoWorkflowStatus } from "@/components/videos/VideoWorkflowStatusControl";

/**
 * One row of `api.videos.list`. Derived from the query's return type so the
 * tile props can never drift from what the project page actually has.
 */
export type ProjectVideoItem = FunctionReturnType<
  typeof api.videos.list
>[number];

export type SelectionModifiers = {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
};

/**
 * Every callback a file/video tile needs, as ONE object that is referentially
 * stable for the life of the project page (see `useProjectTileActions`).
 *
 * This is the whole point of the shape: a tile's props are then just its own
 * data plus booleans, so `React.memo` actually holds. Previously each tile got
 * a fresh arrow function per parent render, and the parent re-renders on every
 * selection click — so 369 tiles re-rendered to change one tile's outline.
 *
 * Note `currentSelectionIds()` is a getter, not a prop. The selection `Set`
 * changes identity on every click; reading it at dragstart keeps it out of the
 * render path entirely.
 */
export type ProjectTileActions = {
  open: (videoId: Id<"videos">) => void;
  prewarm: (videoId: Id<"videos">, muxPlaybackId?: string) => void;
  selectToggle: (videoId: Id<"videos">, modifiers: SelectionModifiers) => void;
  dragSelectOnly: (videoId: Id<"videos">) => void;
  currentSelectionIds: () => readonly Id<"videos">[];
  combine: (targetVideoId: Id<"videos">, draggedVideoId: Id<"videos">) => void;
  remove: (videoId: Id<"videos">) => void;
  download: (videoId: Id<"videos">, title: string) => void;
  share: (video: ProjectVideoItem) => void;
  setWorkflowStatus: (
    videoId: Id<"videos">,
    status: VideoWorkflowStatus,
  ) => void;
  buildMenu: (
    video: ProjectVideoItem,
    canDownload: boolean,
  ) => ContextMenuEntry[];
};

/**
 * Freezes a fresh set of closures behind a stable façade. `impl` may be
 * rebuilt on every render (it closes over selection state, handlers, etc.);
 * the returned object never changes identity, so it is safe to pass to a
 * memoized tile.
 */
export function useStableActions(impl: ProjectTileActions): ProjectTileActions {
  const ref = useRef(impl);
  ref.current = impl;
  const stable = useRef<ProjectTileActions | null>(null);
  if (!stable.current) {
    stable.current = {
      open: (a) => ref.current.open(a),
      prewarm: (a, b) => ref.current.prewarm(a, b),
      selectToggle: (a, b) => ref.current.selectToggle(a, b),
      dragSelectOnly: (a) => ref.current.dragSelectOnly(a),
      currentSelectionIds: () => ref.current.currentSelectionIds(),
      combine: (a, b) => ref.current.combine(a, b),
      remove: (a) => ref.current.remove(a),
      download: (a, b) => ref.current.download(a, b),
      share: (a) => ref.current.share(a),
      setWorkflowStatus: (a, b) => ref.current.setWorkflowStatus(a, b),
      buildMenu: (a, b) => ref.current.buildMenu(a, b),
    };
  }
  return stable.current;
}

/**
 * Per-tile "don't mount the menus until someone could plausibly use them".
 *
 * A Radix `DropdownMenu` root costs ~6 component instances even while closed,
 * and a video tile has two of them (actions + workflow status). Across a full
 * grid that was the single largest chunk of the tree. Menus arm on pointer
 * entering the tile (mouse) or focus landing inside it (keyboard) — by which
 * point at most a handful of tiles are armed.
 *
 * Keyboard focus needs care: arming swaps a plain button for a Radix trigger,
 * which remounts the DOM node and drops focus. Elements that can arm carry
 * `data-defer-focus="<name>"`; after arming we re-focus the node with the same
 * name so tab order survives.
 */
export function useDeferredMenus<T extends HTMLElement>() {
  const rootRef = useRef<T | null>(null);
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const pendingFocusRef = useRef<string | null>(null);

  const arm = useCallback(() => {
    if (armedRef.current) return;
    armedRef.current = true;
    setArmed(true);
  }, []);

  const armFromFocus = useCallback((event: React.FocusEvent) => {
    if (armedRef.current) return;
    const target = event.target as HTMLElement | null;
    pendingFocusRef.current =
      target?.getAttribute?.("data-defer-focus") ?? null;
    armedRef.current = true;
    setArmed(true);
  }, []);

  useLayoutEffect(() => {
    const name = pendingFocusRef.current;
    if (!name) return;
    pendingFocusRef.current = null;
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-defer-focus="${name}"]`)
      ?.focus();
  }, [armed]);

  return { rootRef, armed, arm, armFromFocus };
}
