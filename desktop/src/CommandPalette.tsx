/**
 * ⌘K command palette — the desktop analogue of the web CommandSearch.
 * Searches across projects, quick-nav, and full-text content
 * (search:globalSearch — file/video titles, document text, comments).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ConvexClient } from "convex/browser";
import { useConvexQuery } from "./useConvex";
import { View } from "./Sidebar";
import { C, mono } from "./ui";

interface TeamWithProjects {
  _id: string;
  name: string;
  slug: string;
  projects: Array<{ _id: string; name: string; videoCount: number }>;
}

interface ContentHit {
  kind: string;
  title: string;
  contextLabel: string;
  snippet: string;
  projectId: string | null;
  videoId: string | null;
}

interface Result {
  id: string;
  label: string;
  subtitle: string;
  view: View;
}

export function CommandPalette({
  client,
  open,
  onClose,
  onNavigate,
}: {
  client: ConvexClient | null;
  open: boolean;
  onClose: () => void;
  onNavigate: (v: View) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState(0);

  const teams = useConvexQuery<TeamWithProjects[]>(client, "teams:listWithProjects", open ? {} : "skip");

  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(t);
  }, [query]);
  const hits = useConvexQuery<ContentHit[]>(
    client,
    "search:globalSearch",
    open && debounced.trim().length >= 2 ? { query: debounced.trim() } : "skip",
  );

  const results = useMemo<Result[]>(() => {
    if (!open) return [];
    const items: Result[] = [
      { id: "nav:home", label: "Home", subtitle: "All projects", view: { kind: "home" } },
      { id: "nav:billing", label: "Billing & usage", subtitle: "Workspace subscription", view: { kind: "billing" } },
      { id: "nav:settings", label: "Settings", subtitle: "Account settings", view: { kind: "settings" } },
    ];
    for (const team of teams ?? []) {
      for (const p of team.projects ?? []) {
        items.push({
          id: `project:${p._id}`,
          label: p.name,
          subtitle: `${team.name} · ${p.videoCount} item${p.videoCount === 1 ? "" : "s"}`,
          view: { kind: "project", projectId: p._id },
        });
      }
    }
    const q = query.trim().toLowerCase();
    const local = items.filter((r) =>
      q ? r.label.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q) : true,
    );
    const content: Result[] = (hits ?? [])
      .filter((h) => h.projectId)
      .map((h, i) => ({
        id: `content:${h.kind}:${i}`,
        label: h.title,
        subtitle: `${h.contextLabel} — ${h.snippet}`,
        view: { kind: "project", projectId: h.projectId as string },
      }));
    return [...local, ...content];
  }, [open, teams, query, hits]);

  useEffect(() => setFocus(0), [query, open]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);

  if (!open) return null;

  const choose = (r: Result | undefined) => {
    if (!r) return;
    onNavigate(r.view);
    onClose();
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "center", paddingTop: "10vh" }}
      onClick={onClose}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(26,26,26,0.6)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 560,
          maxHeight: "70vh",
          margin: "0 16px",
          background: C.bg,
          border: `2px solid ${C.border}`,
          boxShadow: `6px 6px 0 0 ${C.border}`,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `2px solid ${C.border}` }}>
          <span style={{ color: C.muted, fontFamily: mono, fontSize: 13 }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setFocus((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setFocus((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(results[focus]);
              }
            }}
            placeholder="Search files, documents, comments, projects…"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 15 }}
          />
          <kbd style={kbd}>esc</kbd>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {results.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>No matches.</div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {results.map((r, i) => (
                <li key={r.id}>
                  <button
                    onMouseEnter={() => setFocus(i)}
                    onClick={() => choose(r)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      padding: "8px 14px",
                      border: "none",
                      borderBottom: `1px solid ${C.borderSubtle}`,
                      cursor: "pointer",
                      background: i === focus ? C.fg : "transparent",
                      color: i === focus ? C.bg : C.fg,
                    }}
                  >
                    <span style={{ fontWeight: 800, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.label}
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 11, opacity: i === focus ? 0.8 : 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.subtitle}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div style={{ display: "flex", gap: 12, padding: "8px 14px", borderTop: `2px solid ${C.border}`, fontFamily: mono, fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          <span><kbd style={kbd}>↑↓</kbd> navigate</span>
          <span><kbd style={kbd}>↵</kbd> open</span>
          <span style={{ marginLeft: "auto" }}>⌘K to reopen</span>
        </div>
      </div>
    </div>
  );
}

const kbd: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10,
  fontWeight: 700,
  padding: "1px 5px",
  border: `1px solid ${C.border}`,
  background: C.cell,
};
