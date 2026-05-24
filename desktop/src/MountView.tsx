import { useEffect, useRef, useState } from "react";
import type { ConvexClient } from "convex/browser";
import { api, DesktopSettings, LanCachePeer, MountPrereqs, MountState } from "./api";
import { useConvexQuery } from "./useConvex";
import { C, mono, Eyebrow, Pill, Square, Banner, Glyph } from "./ui";

interface PresenceLock {
  _id: string;
  clientId: string;
  userName?: string;
  mountPath: string;
  files: { path: string; process?: string; pid?: number }[];
  lastSeen: number;
}

interface Props {
  settings: DesktopSettings;
  client: ConvexClient | null;
}

/**
 * One-click mount UI. Wraps the rclone subprocess managed by the Electron
 * main process and surfaces its lifecycle as Mount / Unmount with a live
 * log tail. The same drive layout you'd get from the manual rclone
 * recipe in docs/MOUNTING.md — minus the Terminal commands.
 */
export function MountView({ settings, client }: Props) {
  const [state, setState] = useState<MountState | null>(null);
  const [prereqs, setPrereqs] = useState<MountPrereqs | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proxyOn, setProxyOn] = useState(
    settings.features.proxy?.enabled !== false,
  );
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    void api.mount.status().then(setState);
    void api.mount.prereqs().then(setPrereqs);
    return api.mount.onStatus((next) => setState(next));
  }, []);

  useEffect(() => {
    // Auto-scroll log to bottom.
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state?.log]);

  const status = state?.status ?? "unmounted";
  const mountPath = state?.mountPath ?? settings.rootDir;
  const isActive = status === "mounted" || status === "mounting";
  const hasPrereqs = Boolean(prereqs?.rclone && prereqs?.fuse);
  const canMount = hasPrereqs && Boolean(
    settings.storage.bucket &&
      settings.storage.accessKeyId &&
      settings.storage.secretAccessKey &&
      settings.storage.endpoint,
  );

  const handleMount = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.mount.start({ mountPath });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mount failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleUnmount = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.mount.stop();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unmount failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleOpenInFinder = async () => {
    if (mountPath) await api.shell.openFolder(mountPath);
  };

  // Flip proxy mode and, if currently mounted, remount so the new filter (which
  // hides/shows `originals/`) takes effect. Optimistic; reverts on failure.
  const handleToggleProxy = async (next: boolean) => {
    setProxyOn(next);
    setBusy(true);
    setError(null);
    try {
      await api.settings.set({
        ...settings,
        features: { ...settings.features, proxy: { enabled: next } },
      });
      if (status === "mounted") {
        await api.mount.stop();
        await api.mount.start({ mountPath });
      }
    } catch (e) {
      setProxyOn(!next);
      setError(e instanceof Error ? e.message : "Couldn't change proxy mode.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <header style={{ marginBottom: 16 }}>
        <Eyebrow>Mount as drive</Eyebrow>
        <h2 style={{ fontSize: 28, margin: "6px 0 6px" }}>
          {labelForStatus(status)}
        </h2>
        <p style={{ margin: 0, color: "#555", fontSize: 13, lineHeight: 1.55 }}>
          Streams your S3 / R2 bucket as a real Mac volume so Finder,
          Premiere, and Resolve see project files natively — no manual pull.
          One mount per machine. Uses the same tuned rclone VFS flags as{" "}
          <code style={{ fontSize: 12 }}>docs/MOUNTING.md</code> (read-ahead +
          chunk size for big sequential reads).
        </p>
      </header>

      <PrereqPanel prereqs={prereqs} />

      <section
        style={{
          border: "2px solid #1a1a1a",
          background: isActive ? "#dde6dd" : "#e8e8e0",
          padding: 14,
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <StatusDot status={status} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {state?.mountPath ?? "Not mounted"}
            </div>
            <div
              style={{
                fontFamily: '"SF Mono", Menlo, monospace',
                fontSize: 11,
                color: "#666",
                marginTop: 2,
              }}
            >
              {settings.storage.provider}:{settings.storage.bucket || "(no bucket)"}/projects
              {state?.pid ? ` · pid ${state.pid}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {status === "mounted" || status === "mounting" ? (
              <button onClick={() => void handleUnmount()} disabled={busy}>
                {status === "mounting" ? "Cancel" : "Unmount"}
              </button>
            ) : (
              <button
                className="primary"
                onClick={() => void handleMount()}
                disabled={busy || !canMount}
                title={
                  !canMount
                    ? hasPrereqs
                      ? "Configure storage credentials first"
                      : "Install rclone + FUSE driver first"
                    : undefined
                }
              >
                {busy ? "Mounting…" : "Mount"}
              </button>
            )}
            {status === "mounted" ? (
              <button className="ghost" onClick={() => void handleOpenInFinder()}>
                Open in Finder
              </button>
            ) : null}
          </div>
        </div>

        {error || state?.lastError ? (
          <div
            style={{
              marginTop: 10,
              padding: 8,
              border: "1px solid #dc2626",
              color: "#7f1d1d",
              fontSize: 12,
              background: "#fff",
            }}
          >
            {error || state?.lastError}
          </div>
        ) : null}
      </section>

      <section
        style={{
          border: "2px solid #1a1a1a",
          background: "#e8e8e0",
          padding: 14,
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>
            Proxy mode {proxyOn ? "ON" : "OFF"}
          </div>
          <div
            style={{ fontSize: 11, color: "#666", marginTop: 2, lineHeight: 1.5 }}
          >
            {proxyOn
              ? "Streaming lightweight proxies — full-res originals hidden. Fast + cache-friendly for editing."
              : "Showing full-res originals too — heavier, for conform / online."}
            {status === "mounted" ? " Toggling remounts the drive." : ""}
          </div>
        </div>
        <button
          className={proxyOn ? "" : "primary"}
          onClick={() => void handleToggleProxy(!proxyOn)}
          disabled={busy}
        >
          {proxyOn ? "Switch to full-res" : "Switch to proxies"}
        </button>
      </section>

      <section style={{ border: "2px solid #1a1a1a" }}>
        <header
          style={{
            background: "#1a1a1a",
            color: "#f0f0e8",
            padding: "6px 12px",
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: "0.05em",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>RCLONE LOG</span>
          <span style={{ fontFamily: "monospace", fontWeight: 600, opacity: 0.6 }}>
            tail -30
          </span>
        </header>
        <pre
          ref={logRef}
          style={{
            margin: 0,
            padding: 10,
            fontSize: 11,
            fontFamily: '"SF Mono", Menlo, monospace',
            background: "#f0f0e8",
            color: "#1a1a1a",
            maxHeight: 220,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {state?.log?.length
            ? state.log.join("\n")
            : "(no log yet — click Mount to start)"}
        </pre>
      </section>

      {settings.features.presence.enabled ? (
        <LivePresencePanel
          client={client}
          activeProjectId={settings.activeProjectId}
        />
      ) : null}

      {settings.features.lanCache.enabled ? <LanCachePeersPanel /> : null}

      <p style={{ fontSize: 11, color: "#888", marginTop: 14 }}>
        See <code>docs/MOUNTING.md</code> for performance tuning + alternatives
        (Mountpoint for S3, LucidLink). Mounts use FUSE under the hood — same
        caveats as any FUSE volume: no file locking across machines, random
        seek perf depends on local cache.
      </p>
    </div>
  );
}

function labelForStatus(s: MountState["status"]): string {
  switch (s) {
    case "mounted":
      return "Drive is mounted.";
    case "mounting":
      return "Mounting…";
    case "unmounting":
      return "Unmounting…";
    case "error":
      return "Mount error.";
    case "unmounted":
    default:
      return "Not mounted.";
  }
}

function StatusDot({ status }: { status: MountState["status"] }) {
  const color =
    status === "mounted"
      ? "#2d5a2d"
      : status === "mounting" || status === "unmounting"
        ? "#b45309"
        : status === "error"
          ? "#dc2626"
          : "#888";
  return (
    <div
      style={{
        width: 16,
        height: 16,
        background: color,
        border: "2px solid #1a1a1a",
        flexShrink: 0,
      }}
    />
  );
}

function PrereqPanel({ prereqs }: { prereqs: MountPrereqs | null }) {
  if (!prereqs) {
    return null;
  }
  const fuseLabel =
    prereqs.platform === "darwin"
      ? "macFUSE"
      : prereqs.platform === "win32"
        ? "WinFsp"
        : "FUSE";
  if (prereqs.rclone && prereqs.fuse) {
    return (
      <div style={{ marginBottom: 14 }}>
        <Banner tone="ok">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Glyph name="check" size={15} />
            Prerequisites installed — rclone + {fuseLabel}.
          </span>
        </Banner>
      </div>
    );
  }
  return (
    <section
      style={{
        border: `2px solid ${C.border}`,
        marginBottom: 14,
      }}
    >
      <header
        style={{
          background: C.fg,
          color: C.bg,
          padding: "7px 14px",
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        Install once before mounting
      </header>
      <div style={{ padding: 14 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <Pill tone={prereqs.rclone ? "ok" : "danger"}>
            <Square
              color={prereqs.rclone ? C.ok : C.danger}
              size={10}
            />
            rclone
          </Pill>
          <Pill tone={prereqs.fuse ? "ok" : "danger"}>
            <Square color={prereqs.fuse ? C.ok : C.danger} size={10} />
            {fuseLabel}
          </Pill>
        </div>
        {prereqs.platform === "darwin" ? (
          <p style={{ fontSize: 11, color: "#666", margin: "0 0 10px", lineHeight: 1.5 }}>
            macFUSE needs kernel-extension approval in System Settings →
            Privacy & Security after install.
          </p>
        ) : null}
        <pre
          style={{
            background: C.fg,
            color: C.bg,
            fontFamily: mono,
            fontSize: 11,
            padding: 12,
            margin: 0,
            border: `2px solid ${C.border}`,
            whiteSpace: "pre-wrap",
            lineHeight: 1.6,
          }}
        >
          {prereqs.installHint}
        </pre>
      </div>
    </section>
  );
}


function LivePresencePanel({
  client,
  activeProjectId,
}: {
  client: ConvexClient | null;
  activeProjectId?: string;
}) {
  // No project selected → don't render. The desktop runs the presence
  // poll regardless (so other team members in the same project can see
  // YOU), but rendering the panel without a project would give us
  // nothing useful to list.
  const locks =
    useConvexQuery<PresenceLock[]>(
      client,
      "desktopPresence:listForProject",
      activeProjectId ? { projectId: activeProjectId } : "skip",
    ) ?? [];

  return (
    <section style={{ border: "2px solid #1a1a1a", marginTop: 14, padding: 14 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 10,
        }}
      >
        <strong style={{ fontSize: 13 }}>LIVE PRESENCE</strong>
        <span style={{ fontSize: 11, color: "#888", fontFamily: "monospace" }}>
          {activeProjectId ? `${locks.length} active` : "no project selected"}
        </span>
      </header>
      {!activeProjectId ? (
        <p style={{ fontSize: 11, color: "#888", margin: 0 }}>
          Pick an active project in the Projects tab to see who has which
          files open across the team.
        </p>
      ) : locks.length === 0 ? (
        <p style={{ fontSize: 11, color: "#888", margin: 0 }}>
          No teammates currently have files open under this mount.
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {locks.map((row) => (
            <li
              key={row._id}
              style={{
                borderTop: "1px solid #ccc",
                padding: "8px 0",
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 700 }}>
                {row.userName || row.clientId.slice(0, 8)}
                <span
                  style={{
                    color: "#888",
                    fontWeight: 400,
                    fontSize: 10,
                    marginLeft: 8,
                  }}
                >
                  {row.files.length} file{row.files.length === 1 ? "" : "s"} open
                </span>
              </div>
              <ul
                style={{
                  margin: "4px 0 0",
                  paddingLeft: 16,
                  fontFamily: "monospace",
                  fontSize: 11,
                  color: "#555",
                }}
              >
                {row.files.slice(0, 6).map((f, i) => (
                  <li key={i}>
                    {f.path}
                    {f.process ? (
                      <span style={{ color: "#888" }}> — {f.process}</span>
                    ) : null}
                  </li>
                ))}
                {row.files.length > 6 ? (
                  <li style={{ color: "#888" }}>
                    + {row.files.length - 6} more…
                  </li>
                ) : null}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LanCachePeersPanel() {
  const [peers, setPeers] = useState<LanCachePeer[]>([]);
  // The peer browser is per-peer ("Browse alice-mac's mount"). null
  // means the top-level peer list is showing.
  const [browsing, setBrowsing] = useState<LanCachePeer | null>(null);
  const [dir, setDir] = useState<string>("");
  const [entries, setEntries] = useState<{ name: string; isDirectory: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPullPath, setLastPullPath] = useState<string | null>(null);

  useEffect(() => {
    void api.lanCache.peers().then(setPeers);
    return api.lanCache.onPeers(setPeers);
  }, []);

  useEffect(() => {
    if (!browsing) return;
    setBusy(true);
    setError(null);
    api.lanCache
      .listFromPeer({ clientId: browsing.clientId, dir })
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, [browsing, dir]);

  return (
    <section style={{ border: "2px solid #1a1a1a", marginTop: 14, padding: 14 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 10,
        }}
      >
        <strong style={{ fontSize: 13 }}>LAN PEERS</strong>
        <span style={{ fontSize: 11, color: "#888", fontFamily: "monospace" }}>
          {peers.length} discovered
        </span>
      </header>

      {!browsing ? (
        peers.length === 0 ? (
          <p style={{ fontSize: 11, color: "#888", margin: 0 }}>
            No other snip Desktop instances visible on this network yet. mDNS
            discovery can take 5–10s after a peer comes online.
          </p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {peers.map((p) => (
              <li
                key={p.clientId}
                style={{
                  borderTop: "1px solid #ccc",
                  padding: "8px 0",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: "#666", fontFamily: "monospace" }}>
                    {p.host}:{p.port} · {p.mountPath || "(no mount)"}
                  </div>
                </div>
                <button
                  className="ghost"
                  onClick={() => {
                    setBrowsing(p);
                    setDir("");
                    setEntries([]);
                  }}
                  disabled={!p.mountPath}
                >
                  Browse
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <button
              className="ghost"
              onClick={() => {
                setBrowsing(null);
                setDir("");
                setEntries([]);
                setError(null);
              }}
            >
              ← back
            </button>
            <span style={{ fontWeight: 700, fontSize: 12 }}>{browsing.name}</span>
            <span style={{ fontFamily: "monospace", fontSize: 11, color: "#666" }}>
              /{dir}
            </span>
          </div>
          {dir ? (
            <button
              className="ghost"
              onClick={() => setDir(dir.split("/").slice(0, -1).join("/"))}
              style={{ fontSize: 11, marginBottom: 6 }}
            >
              ../
            </button>
          ) : null}
          {error ? (
            <p style={{ fontSize: 11, color: "#7f1d1d", margin: "0 0 6px" }}>{error}</p>
          ) : null}
          {busy ? (
            <p style={{ fontSize: 11, color: "#888", margin: 0 }}>Loading…</p>
          ) : (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                maxHeight: 240,
                overflowY: "auto",
                border: "1px solid #ccc",
              }}
            >
              {entries.map((e) => (
                <li
                  key={e.name}
                  style={{
                    padding: "6px 10px",
                    borderBottom: "1px solid #eee",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontFamily: "monospace",
                    fontSize: 11,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {e.isDirectory ? "📁 " : ""}
                    {e.name}
                  </span>
                  {e.isDirectory ? (
                    <button
                      className="ghost"
                      onClick={() => setDir(dir ? `${dir}/${e.name}` : e.name)}
                    >
                      open
                    </button>
                  ) : (
                    <button
                      className="ghost"
                      onClick={async () => {
                        setError(null);
                        setLastPullPath(null);
                        try {
                          const remotePath = dir ? `${dir}/${e.name}` : e.name;
                          const r = await api.lanCache.pullFromPeer({
                            clientId: browsing.clientId,
                            remotePath,
                          });
                          setLastPullPath(r.path);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err));
                        }
                      }}
                    >
                      pull
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {lastPullPath ? (
            <p style={{ fontSize: 11, color: "#2d5a2d", margin: "8px 0 0" }}>
              Saved to <code>{lastPullPath}</code>
            </p>
          ) : null}
        </div>
      )}

      <p style={{ fontSize: 10, color: "#888", margin: "10px 0 0", lineHeight: 1.5 }}>
        Peer-to-peer file pulls over LAN — saves S3 egress for files a
        teammate has already downloaded. Rclone reads through the mount
        still consult S3 directly; transparent peer caching would need a
        custom rclone backend.
      </p>
    </section>
  );
}
