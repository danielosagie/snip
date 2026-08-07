import { useCallback, useEffect, useState } from "react";

interface LocalVersion {
  id: string;
  file: string;
  mtime: number;
  observedAt: number;
  hash: string;
  sizeBytes: number;
  sourceFormat: string;
}

interface VersionHistoryBridge {
  list: () => Promise<LocalVersion[]>;
  restoreCopy: (id: string) => Promise<{ ok: boolean; cancelled?: boolean }>;
  onChanged: (handler: () => void) => () => void;
}

declare global {
  interface Window {
    versionHistory: VersionHistoryBridge;
  }
}

const mono = '"SF Mono", Menlo, Consolas, monospace';
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function savedAt(value: number) {
  return dateFormatter.format(new Date(value));
}

export function VersionHistory() {
  const [versions, setVersions] = useState<LocalVersion[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setVersions(await window.versionHistory.list());
    } catch {
      setVersions([]);
      setStatus("History unavailable.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    return window.versionHistory.onChanged(() => void refresh());
  }, [refresh]);

  const restore = async (id: string) => {
    setBusyId(id);
    setStatus(null);
    try {
      const result = await window.versionHistory.restoreCopy(id);
      if (result.ok) setStatus("Copy saved.");
    } catch {
      setStatus("Restore failed.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main style={{ minHeight: "100vh", padding: "58px 20px 24px" }}>
      <header
        style={{
          display: "flex",
          alignItems: "end",
          gap: 16,
          paddingBottom: 14,
          borderBottom: "2px solid #1a1a1a",
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              color: "#888888",
              fontFamily: mono,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            Local saves
          </div>
          <h1 style={{ fontSize: 28, letterSpacing: "-0.03em", margin: "4px 0 0" }}>
            File history<span style={{ color: "#c2410c" }}>.</span>
          </h1>
        </div>
        <div style={{ color: "#888888", fontFamily: mono, fontSize: 11 }}>
          {versions === null
            ? "Loading..."
            : `${versions.length} ${versions.length === 1 ? "save" : "saves"}`}
        </div>
      </header>

      {status ? (
        <div
          role="status"
          style={{
            borderBottom: "1px solid #cccccc",
            color: "#7a2a08",
            fontSize: 12,
            fontWeight: 700,
            padding: "9px 0",
          }}
        >
          {status}
        </div>
      ) : null}

      {versions?.length === 0 ? (
        <div style={{ color: "#888888", fontSize: 13, padding: "28px 0" }}>
          No saves yet.
        </div>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {(versions ?? []).map((version) => (
            <li
              key={version.id}
              style={{
                alignItems: "center",
                borderBottom: "1px solid #cccccc",
                display: "grid",
                gap: 14,
                gridTemplateColumns: "minmax(0, 1fr) auto",
                padding: "13px 0",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  title={version.file}
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {version.file}
                </div>
                <div style={{ color: "#888888", fontSize: 11, marginTop: 3 }}>
                  <time dateTime={new Date(version.observedAt).toISOString()}>
                    {savedAt(version.observedAt)}
                  </time>
                  <span style={{ margin: "0 6px" }}>·</span>
                  <code title={version.hash} style={{ fontFamily: mono }}>
                    {version.hash.slice(0, 16)}
                  </code>
                </div>
              </div>
              <button
                disabled={busyId !== null}
                onClick={() => void restore(version.id)}
                type="button"
              >
                {busyId === version.id ? "Restoring..." : "Restore copy"}
              </button>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
