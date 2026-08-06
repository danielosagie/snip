"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  Search,
  Users,
  Settings,
  CreditCard,
  Home,
  ArrowRight,
  Briefcase,
  Film,
  FileText,
  MessageSquare,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import {
  dashboardHomePath,
  projectPath,
  teamHomePath,
  teamSettingsPath,
  videoPath,
} from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * Command palette / search modal. Modeled after Meilisearch + Algolia
 * DocSearch: dim overlay, full-width search box at top, tab strip for
 * scope filters, then a result list.
 *
 * Sources we search across:
 *   - "Project" rows from api.teams.listWithProjects
 *   - "Team" rows (when the user has multiple teams)
 *   - Static "Quick navigation" items (Home, Billing, Settings)
 *
 * Keyboard:
 *   - Esc closes
 *   - Up/Down moves through results
 *   - Enter opens the focused result
 */

type SearchScope = "all" | "content" | "projects" | "teams" | "nav";

interface ResultItem {
  id: string;
  scope: Exclude<SearchScope, "all">;
  label: string;
  subtitle: string;
  href: string;
  icon: React.ReactNode;
  /** Deep-link search params (e.g. {t} to seek the video to a matched
   *  frame/transcript moment). */
  search?: Record<string, unknown>;
}

export function CommandSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [focusIndex, setFocusIndex] = useState(0);

  const teams = useQuery(api.teams.listWithProjects, open ? {} : "skip");

  // Debounce the text query before hitting the backend full-text search
  // so we don't fire a Convex query on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 180);
    return () => clearTimeout(t);
  }, [query]);
  const contentHits = useQuery(
    api.search.globalSearch,
    open && debouncedQuery.trim().length >= 2
      ? { query: debouncedQuery.trim() }
      : "skip",
  );

  const results = useMemo<ResultItem[]>(() => {
    if (!open) return [];
    const items: ResultItem[] = [];

    // Static nav.
    items.push(
      {
        id: "nav:home",
        scope: "nav",
        label: "Home",
        subtitle: "All projects",
        href: dashboardHomePath(),
        icon: <Home className="h-4 w-4" />,
      },
      {
        id: "nav:billing",
        scope: "nav",
        label: "Billing & usage",
        subtitle: "Workspace subscription",
        href: "/dashboard/billing",
        icon: <CreditCard className="h-4 w-4" />,
      },
      {
        id: "nav:settings",
        scope: "nav",
        label: "Settings",
        subtitle: "Account settings",
        href: "/dashboard/settings",
        icon: <Settings className="h-4 w-4" />,
      },
    );

    for (const team of teams ?? []) {
      items.push({
        id: `team:${team._id}`,
        scope: "teams",
        label: team.name,
        subtitle: "Team",
        href: teamHomePath(team.slug),
        icon: <Users className="h-4 w-4" />,
      });
      items.push({
        id: `team:${team._id}:members`,
        scope: "teams",
        label: `${team.name} — members`,
        subtitle: "Invite + manage seats",
        href: teamSettingsPath(team.slug),
        icon: <Users className="h-4 w-4" />,
      });
      for (const project of team.projects ?? []) {
        items.push({
          id: `project:${project._id}`,
          scope: "projects",
          label: project.name,
          subtitle: `${team.name} · ${project.videoCount} item${
            project.videoCount === 1 ? "" : "s"
          }`,
          href: projectPath(team.slug, project._id),
          icon: <Briefcase className="h-4 w-4" />,
        });
      }
    }

    const q = query.trim().toLowerCase();
    const localFiltered = items
      .filter((r) => (scope === "all" ? true : r.scope === scope))
      .filter((r) =>
        q
          ? r.label.toLowerCase().includes(q) ||
            r.subtitle.toLowerCase().includes(q)
          : true,
      );

    // Backend full-text hits — words *inside* documents, file/video
    // titles+descriptions, comments. Already query-matched server-side,
    // so no extra substring filter here.
    const contentItems: ResultItem[] = (contentHits ?? []).map((h, idx) => {
      let href = dashboardHomePath();
      let icon = <FileText className="h-4 w-4" />;
      if (h.kind === "document") {
        if (h.teamSlug && h.projectId) {
          href = `/dashboard/${h.teamSlug}/${h.projectId}/contract`;
        }
        icon = <FileText className="h-4 w-4" />;
      } else if (h.teamSlug && h.projectId && h.videoId) {
        href = videoPath(h.teamSlug, h.projectId, h.videoId);
        icon =
          h.kind === "comment" ? (
            <MessageSquare className="h-4 w-4" />
          ) : (
            <Film className="h-4 w-4" />
          );
      }
      // Frame / transcript hits deep-link the video to the matched
      // moment via a ?t= search param the video page reads.
      const search =
        typeof h.timestampSec === "number" && h.timestampSec >= 0
          ? { t: h.timestampSec }
          : undefined;
      return {
        id: `content:${h.kind}:${h.refId}:${idx}`,
        scope: "content",
        label: h.title,
        subtitle: `${h.contextLabel} — ${h.snippet}`,
        href,
        icon,
        search,
      };
    });

    const showContent = scope === "all" || scope === "content";
    return showContent
      ? [...localFiltered, ...contentItems]
      : localFiltered;
  }, [open, teams, query, scope, contentHits]);

  // Reset focus when results change.
  useEffect(() => {
    setFocusIndex(0);
  }, [query, scope, open]);

  // Focus the input on open.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setQuery("");
      setScope("all");
    }
  }, [open]);

  // Global Cmd-K shortcut to open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpenChange]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIndex((i) => Math.min(results.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const order: SearchScope[] = [
        "all",
        "content",
        "projects",
        "teams",
        "nav",
      ];
      const idx = order.indexOf(scope);
      setScope(order[(idx + 1) % order.length]);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const target = results[focusIndex];
      if (target) {
        onOpenChange(false);
        navigate({
          to: target.href,
          ...(target.search ? { search: target.search } : {}),
        } as never);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh] px-4"
      onClick={() => onOpenChange(false)}
    >
      <div className="absolute inset-0 bg-[#131315]/20 backdrop-blur-sm" />
      <div
        className="relative flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white shadow-[0_8px_24px_rgba(19,19,21,0.10)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="field-shell flex items-center gap-3 border-b border-[#E8E8EC] px-4 py-3">
          <Search className="h-4 w-4 flex-shrink-0 text-[#A0A0A5]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files, documents, comments, projects…"
            className="field-bare flex-1 text-[15px] text-[#131315] placeholder:text-[#A0A0A5]"
          />
          <kbd className="rounded-[6px] bg-[#F1F1F3] px-1.5 py-0.5 text-[11px] text-[#6E6E73]">
            esc
          </kbd>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-[#E8E8EC] px-3 py-2">
          {(
            ["all", "content", "projects", "teams", "nav"] as SearchScope[]
          ).map((s) => {
            const active = scope === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium transition-colors",
                  active
                    ? "bg-[#FFF0E6] text-[#D14E00]"
                    : "border border-[#D8D8DE] bg-white text-[#6E6E73] hover:bg-[#F1F1F3]",
                )}
              >
                {s === "nav" ? "go to" : s === "content" ? "in files" : s}
              </button>
            );
          })}
          <span className="ml-auto font-['Geist_Mono',system-ui,sans-serif] text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
            {results.length} result{results.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="overflow-y-auto flex-1">
          {results.length === 0 ? (
            <div className="p-6 text-center text-sm text-[#A0A0A5]">
              No matches.
            </div>
          ) : (
            <ul className="p-2">
              {results.map((r, i) => {
                const focused = i === focusIndex;
                return (
                  <li key={r.id}>
                    <Link
                      to={r.href}
                      search={r.search as never}
                      onClick={() => onOpenChange(false)}
                      onMouseEnter={() => setFocusIndex(i)}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-sm",
                        focused
                          ? "bg-[#FFF0E6] text-[#D14E00]"
                          : "text-[#131315] hover:bg-[#F1F1F3]",
                      )}
                    >
                      <span
                        className={cn(
                          "flex-shrink-0",
                          focused
                            ? "text-[#D14E00]"
                            : "text-[#6E6E73]",
                        )}
                      >
                        {r.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {r.label}
                        </span>
                        <span className="block truncate text-xs text-[#A0A0A5]">
                          {r.subtitle}
                        </span>
                      </span>
                      <ArrowRight
                        className={cn(
                          "h-4 w-4 flex-shrink-0",
                          focused
                            ? "text-[#D14E00]"
                            : "text-[#6E6E73]",
                        )}
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-[#E8E8EC] px-3 py-2 text-[11px] text-[#6E6E73]">
          <span>
            <kbd className="rounded-[6px] bg-[#F1F1F3] px-1.5 py-0.5 text-[11px] text-[#6E6E73]">
              ↑↓
            </kbd>{" "}
            navigate
          </span>
          <span>
            <kbd className="rounded-[6px] bg-[#F1F1F3] px-1.5 py-0.5 text-[11px] text-[#6E6E73]">
              ↵
            </kbd>{" "}
            open
          </span>
          <span>
            <kbd className="rounded-[6px] bg-[#F1F1F3] px-1.5 py-0.5 text-[11px] text-[#6E6E73]">
              tab
            </kbd>{" "}
            switch scope
          </span>
          <span className="ml-auto">⌘ K to reopen</span>
        </div>
      </div>
    </div>
  );
}

/** Trigger button mounted inside the sidebar (replaces the workspace
 *  dropdown). Looks like a search bar but is really a button that
 *  opens the modal. */
export function CommandSearchTrigger({
  onOpen,
  className,
}: {
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-2 text-left transition-colors",
        className,
      )}
    >
      <Search className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="flex-1 truncate">Search…</span>
      <kbd className="rounded-[6px] bg-[#F1F1F3] px-1.5 py-0.5 text-[11px] font-medium text-[#6E6E73]">
        ⌘K
      </kbd>
    </button>
  );
}
