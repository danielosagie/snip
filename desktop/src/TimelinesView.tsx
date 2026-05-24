import { ConvexClient } from "convex/browser";
import { useCallback, useEffect, useState } from "react";
import { api, ResolveStatus } from "./api";
import { useConvexQuery } from "./useConvex";
import { DiffView } from "./DiffView";

/**
 * snip's "GitHub Desktop for Resolve" — but with the dev jargon scrubbed.
 * No more "branch / commit / push / pull" anywhere visible. Editors see:
 *
 *   - "Save current Resolve timeline" (= snapshot / commit / push)
 *   - "Open this version in Resolve" (= checkout / restore)
 *   - "Edit thread" instead of branch — each thread is an isolated line
 *     of saves (editor's working thread vs. colorist's). Create new
 *     threads from the picker.
 *   - "What changed" instead of diff — compare any two saves and see the
 *     human-readable summary.
 */

interface SnapshotRow {
  _id: string;
  _creationTime: number;
  branch: string;
  message: string;
  parentSnapshotId: string | null;
  versionId: string | null;
  source: "resolve" | "premiere" | "manual";
  createdByName: string;
  sizeBytes: number | null;
  sourceProjectId: string | null;
  sourceTimelineId: string | null;
}

interface BranchInfo {
  branch: string;
  count: number;
  tipAt: number;
  tipId: string;
}

interface Props {
  client: ConvexClient | null;
  projectId: string;
}

export function TimelinesView({ client, projectId }: Props) {
  const snapshots = useConvexQuery<SnapshotRow[]>(client, "timelines:list", {
    projectId,
    limit: 50,
  });
  const branches = useConvexQuery<BranchInfo[]>(client, "timelines:listBranches", {
    projectId,
  });

  const [resolveStatus, setResolveStatus] = useState<ResolveStatus | null>(null);
  const [busy, setBusy] = useState<null | "save" | "open" | "status" | "prproj">(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [premierePath, setPremierePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState("");
  const [diffPair, setDiffPair] = useState<[string, string] | null>(null);
  const [compareFrom, setCompareFrom] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState("");

  // Tell the Electron main process which snip project Resolve actions
  // should target. Without this it doesn't know where to file snapshots.
  useEffect(() => {
    void api.resolve.setActiveProject({ projectId });
  }, [projectId]);

  // Probe Resolve on mount and any time the user retries.
  const probeResolve = useCallback(async () => {
    setBusy("status");
    setError(null);
    try {
      const status = await api.resolve.status();
      setResolveStatus(status);
      if (!status.ok && status.message) {
        // Don't blast as red error on first probe — Resolve might just
        // not be open yet. We show it as a soft hint in the header card.
      }
    } catch (e) {
      setResolveStatus({
        ok: false,
        error: "internal",
        message: e instanceof Error ? e.message : "Couldn't reach Resolve.",
      });
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void probeResolve();
  }, [probeResolve]);

  const handleSave = async () => {
    if (!resolveStatus?.ok) return;
    setBusy("save");
    setError(null);
    setInfo(null);
    try {
      await api.resolve.snapshot({
        message: saveMessage.trim() || "Update from Resolve",
        branch: filterBranch ?? undefined,
      });
      setSaveMessage("");
      setInfo(
        `Saved “${saveMessage.trim() || "Update from Resolve"}” to snip.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleOpenSnapshot = async (
    snapshotId: string,
    source: SnapshotRow["source"],
  ) => {
    if (!client) return;
    setBusyRowId(snapshotId);
    setError(null);
    setInfo(null);
    try {
      const got = (await client.query(
        "timelines:get" as unknown as Parameters<typeof client.query>[0],
        { snapshotId } as unknown as Parameters<typeof client.query>[1],
      )) as { fcpxml: string | null; message: string } | null;
      if (!got?.fcpxml) {
        setError("That save doesn't have project data attached.");
        return;
      }
      if (source === "resolve") {
        const result = await api.resolve.restore({ fcpxml: got.fcpxml });
        if (result.ok) {
          setInfo(`Opened in Resolve as “${result.imported_as ?? "new timeline"}”.`);
        } else {
          setError("Resolve refused to open this version.");
        }
      } else if (source === "premiere") {
        const result = await api.premiere.restoreDownload({
          fcpxml: got.fcpxml,
          suggestedName: `${(got.message || "restored")
            .replace(/[^a-zA-Z0-9._-]+/g, "_")
            .slice(0, 60)}.prproj`,
        });
        if (result.ok && result.path) {
          setInfo(
            `Saved restored .prproj to ${result.path}. Open it in Premiere.`,
          );
        } else if (!result.cancelled) {
          setError("Couldn't write the .prproj file.");
        }
      } else {
        setError("Manual milestones don't have a restorable file.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Open failed.");
    } finally {
      setBusyRowId(null);
    }
  };

  const handlePremiereSnapshot = async () => {
    setError(null);
    setInfo(null);
    let chosenPath = premierePath;
    if (!chosenPath) {
      chosenPath = await api.premiere.pickFile();
      if (!chosenPath) return;
      setPremierePath(chosenPath);
    }
    setBusy("prproj");
    try {
      await api.premiere.snapshot({
        filePath: chosenPath,
        message: saveMessage.trim() || "Update from Premiere",
        branch: filterBranch ?? undefined,
      });
      setSaveMessage("");
      setInfo(
        `Saved Premiere project (${chosenPath.split("/").pop()}) to snip.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Premiere save failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleStartNewThread = () => {
    const trimmed = newBranchName.trim();
    if (!trimmed) return;
    setFilterBranch(trimmed);
    setNewBranchName("");
    setInfo(
      `Switched to thread “${trimmed}”. Your next save lands here even if it doesn't exist yet.`,
    );
  };

  const filtered = filterBranch
    ? (snapshots ?? []).filter((s) => s.branch === filterBranch)
    : snapshots ?? [];

  const resolveBadge = renderResolveBadge(resolveStatus);

  return (
    <section style={{ border: "2px solid #1a1a1a", marginTop: 14 }}>
      <header
        style={{
          padding: "10px 14px",
          borderBottom: "2px solid #1a1a1a",
          background: "#1a1a1a",
          color: "#f0f0e8",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: "0.05em" }}>
            RESOLVE HISTORY
          </div>
          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-0.01em" }}>
            {resolveStatus?.ok
              ? resolveStatus.timeline_name ?? "No timeline open"
              : "Resolve not connected"}
          </div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 1, fontFamily: '"SF Mono", monospace' }}>
            {resolveStatus?.ok
              ? `${resolveStatus.project_name ?? "—"} · ${resolveStatus.resolve_product ?? "Resolve"} ${resolveStatus.resolve_version ?? ""}`
              : resolveStatus?.message ?? "Open DaVinci Resolve to enable saving."}
          </div>
        </div>
        {resolveBadge}
        <button
          onClick={() => void probeResolve()}
          disabled={busy !== null}
          style={{
            background: "transparent",
            color: "#f0f0e8",
            border: "1px solid #f0f0e8",
            padding: "4px 8px",
            fontSize: 11,
          }}
        >
          {busy === "status" ? "Checking…" : "Refresh"}
        </button>
      </header>

      {/* Save current Resolve timeline */}
      <div
        style={{
          padding: "10px 14px",
          background: resolveStatus?.ok ? "#dde6dd" : "#e8e8e0",
          borderBottom: "2px solid #1a1a1a",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <input
          value={saveMessage}
          onChange={(e) => setSaveMessage(e.target.value)}
          placeholder="What did you change? (e.g. 'tightened cold open by 4s')"
          style={{
            flex: 1,
            fontSize: 13,
            background: "#f0f0e8",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && resolveStatus?.ok && busy === null) {
              void handleSave();
            }
          }}
        />
        <button
          onClick={() => void handleSave()}
          disabled={busy !== null || !resolveStatus?.ok}
          title={
            !resolveStatus?.ok
              ? "Open Resolve first"
              : `Save the timeline currently open in Resolve to snip (thread: ${filterBranch ?? "main"})`
          }
        >
          {busy === "save" ? "Saving…" : "Save current Resolve timeline"}
        </button>
        <button
          className="ghost"
          onClick={() => void handlePremiereSnapshot()}
          disabled={busy !== null}
          title={
            premierePath
              ? `Re-read ${premierePath.split("/").pop()} and save`
              : "Pick a .prproj file to snapshot"
          }
        >
          {busy === "prproj"
            ? "Saving…"
            : premierePath
              ? "Save Premiere project (same file)"
              : "Save Premiere project file…"}
        </button>
      </div>

      {premierePath ? (
        <div
          style={{
            padding: "4px 14px",
            borderBottom: "1px solid #ccc",
            background: "#f5e9d8",
            color: "#7c4400",
            fontSize: 11,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            Tracking Premiere project:{" "}
            <code style={{ fontFamily: '"SF Mono", monospace' }}>
              {premierePath.split("/").slice(-3).join("/")}
            </code>
          </span>
          <button
            className="ghost"
            style={{ fontSize: 10 }}
            onClick={() => setPremierePath(null)}
          >
            Pick a different file
          </button>
        </div>
      ) : null}

      {/* Thread picker + create */}
      <div
        style={{
          padding: "8px 14px",
          borderBottom: "1px solid #ccc",
          display: "flex",
          gap: 8,
          alignItems: "center",
          fontSize: 12,
          background: "#f0f0e8",
        }}
      >
        <span style={{ color: "#888", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10 }}>
          Thread
        </span>
        <ThreadPicker
          branches={branches ?? []}
          selected={filterBranch}
          onSelect={setFilterBranch}
        />
        <span style={{ color: "#888" }}>or start a new one:</span>
        <input
          value={newBranchName}
          onChange={(e) => setNewBranchName(e.target.value)}
          placeholder="e.g. color_pass_b"
          style={{ flex: 1, fontSize: 12, padding: "3px 6px" }}
        />
        <button
          className="ghost"
          onClick={handleStartNewThread}
          disabled={!newBranchName.trim()}
          style={{ fontSize: 11 }}
        >
          Start
        </button>
      </div>

      {/* Notice strip */}
      {error ? (
        <div
          style={{
            padding: "6px 14px",
            background: "#fff",
            color: "#7f1d1d",
            borderBottom: "2px solid #dc2626",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : info ? (
        <div
          style={{
            padding: "6px 14px",
            background: "#dde6dd",
            color: "#2d5a2d",
            borderBottom: "2px solid #2d5a2d",
            fontSize: 12,
          }}
        >
          {info}
        </div>
      ) : null}

      {/* Snapshot list */}
      {snapshots === undefined ? (
        <div style={{ padding: 14, color: "#888", fontSize: 12 }}>
          Loading history…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 16, color: "#666", fontSize: 13 }}>
          <div style={{ fontWeight: 700 }}>
            No saves yet on this thread.
          </div>
          <div style={{ color: "#888", marginTop: 4 }}>
            Open a timeline in Resolve, then click <strong>Save current Resolve timeline</strong> above.
          </div>
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", maxHeight: 360, overflowY: "auto" }}>
          {filtered.map((s, i) => (
            <li
              key={s._id}
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid #ccc",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <SourceDot source={s.source} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#1a1a1a",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 340,
                    }}
                  >
                    {s.message}
                  </span>
                  {i === 0 ? (
                    <span
                      style={{
                        background: "#2d5a2d",
                        color: "#f0f0e8",
                        fontSize: 9,
                        fontWeight: 800,
                        padding: "1px 4px",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      LATEST
                    </span>
                  ) : null}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontFamily: '"SF Mono", monospace',
                    color: "#666",
                    marginTop: 2,
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span>thread: {s.branch}</span>
                  <span>·</span>
                  <span>{s.createdByName}</span>
                  <span>·</span>
                  <span>{formatRelativeTime(s._creationTime)}</span>
                  {s.sizeBytes != null ? (
                    <>
                      <span>·</span>
                      <span>{formatBytes(s.sizeBytes)}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                <button
                  className="ghost"
                  onClick={() => void handleOpenSnapshot(s._id, s.source)}
                  disabled={
                    busyRowId !== null ||
                    s.source === "manual" ||
                    (s.source === "resolve" && !resolveStatus?.ok)
                  }
                  title={
                    s.source === "manual"
                      ? "Manual milestone — no project data attached"
                      : s.source === "resolve"
                        ? !resolveStatus?.ok
                          ? "Open Resolve first"
                          : "Re-open this version as a new timeline in Resolve"
                        : "Download this version as a .prproj you can open in Premiere"
                  }
                  style={{ fontSize: 11 }}
                >
                  {busyRowId === s._id
                    ? s.source === "premiere"
                      ? "Saving…"
                      : "Opening…"
                    : s.source === "premiere"
                      ? "Download .prproj"
                      : "Open in Resolve"}
                </button>
                <button
                  className="ghost"
                  onClick={() => {
                    if (compareFrom && compareFrom !== s._id) {
                      setDiffPair([compareFrom, s._id]);
                      setCompareFrom(null);
                    } else {
                      setCompareFrom(s._id);
                    }
                  }}
                  style={{
                    fontSize: 10,
                    background: compareFrom === s._id ? "#1a1a1a" : "transparent",
                    color: compareFrom === s._id ? "#f0f0e8" : "#1a1a1a",
                  }}
                  title="Click two saves to see what changed between them"
                >
                  {compareFrom === s._id ? "Picked ✓" : "Compare"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {diffPair && client ? (
        <DiffView
          client={client}
          fromId={diffPair[0]}
          toId={diffPair[1]}
          onClose={() => setDiffPair(null)}
        />
      ) : null}
    </section>
  );
}

function ThreadPicker({
  branches,
  selected,
  onSelect,
}: {
  branches: BranchInfo[];
  selected: string | null;
  onSelect: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  return (
    <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          background: selected ? "#2d5a2d" : "#f0f0e8",
          color: selected ? "#f0f0e8" : "#1a1a1a",
          padding: "2px 10px",
          fontSize: 11,
          fontWeight: 700,
          fontFamily: '"SF Mono", monospace',
        }}
      >
        {selected ?? "main"} ▾
      </button>
      {open ? (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            background: "#f0f0e8",
            border: "2px solid #1a1a1a",
            minWidth: 200,
            zIndex: 10,
          }}
        >
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setOpen(false);
            }}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 700,
              background: "transparent",
              color: "#1a1a1a",
              border: "none",
            }}
          >
            main
          </button>
          {branches.map((b) => (
            <button
              key={b.branch}
              type="button"
              onClick={() => {
                onSelect(b.branch);
                setOpen(false);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "4px 10px",
                fontSize: 11,
                fontFamily: '"SF Mono", monospace',
                background: "transparent",
                color: "#1a1a1a",
                border: "none",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>{b.branch}</span>
              <span style={{ color: "#888" }}>{b.count}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function renderResolveBadge(status: ResolveStatus | null) {
  if (!status) {
    return (
      <div
        style={{
          background: "#888",
          color: "#f0f0e8",
          padding: "3px 8px",
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        CHECKING
      </div>
    );
  }
  if (status.ok) {
    return (
      <div
        style={{
          background: "#2d5a2d",
          color: "#f0f0e8",
          padding: "3px 8px",
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        CONNECTED
      </div>
    );
  }
  const colorByCategory: Record<string, string> = {
    not_running: "#888",
    api_unavailable: "#dc2626",
    scripting_off: "#b45309",
  };
  return (
    <div
      style={{
        background: colorByCategory[status.error ?? ""] ?? "#dc2626",
        color: "#f0f0e8",
        padding: "3px 8px",
        fontSize: 10,
        fontWeight: 700,
      }}
    >
      {(status.error ?? "OFFLINE").toUpperCase()}
    </div>
  );
}

function SourceDot({ source }: { source: SnapshotRow["source"] }) {
  const color =
    source === "resolve"
      ? "#2d5a2d"
      : source === "premiere"
        ? "#b45309"
        : "#888";
  const label = source === "resolve" ? "R" : source === "premiere" ? "P" : "M";
  return (
    <div
      style={{
        width: 22,
        height: 22,
        background: color,
        color: "#f0f0e8",
        fontWeight: 900,
        fontSize: 11,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        marginTop: 2,
      }}
      title={`Source: ${source}`}
    >
      {label}
    </div>
  );
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
