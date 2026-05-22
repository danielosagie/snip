import { useEffect, useState } from "react";
import { api, DesktopSettings, UpdateState } from "./api";

interface Props {
  settings: DesktopSettings;
  onChange: (next: DesktopSettings) => Promise<void>;
}

export function SettingsView({ settings, onChange }: Props) {
  const [draft, setDraft] = useState<DesktopSettings>(settings);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      // Final sanitization pass before persistence — catches any
      // out-of-range or non-integer value that slipped past the onChange
      // handler (paste, devtools edit, programmatic setDraft).
      const port = draft.features.lanCache.port;
      const safePort = Number.isInteger(port)
        ? Math.min(65535, Math.max(1024, port))
        : 17900;
      const sanitized: DesktopSettings = {
        ...draft,
        features: {
          ...draft.features,
          lanCache: { ...draft.features.lanCache, port: safePort },
        },
      };
      await onChange(sanitized);
    } finally {
      setSaving(false);
    }
  };

  const setField = <K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const setStorage = <K extends keyof DesktopSettings["storage"]>(
    key: K,
    value: DesktopSettings["storage"][K],
  ) => {
    setDraft((d) => ({ ...d, storage: { ...d.storage, [key]: value } }));
  };
  const setFeature = <K extends keyof DesktopSettings["features"]>(
    key: K,
    patch: Partial<DesktopSettings["features"][K]>,
  ) => {
    setDraft((d) => ({
      ...d,
      features: {
        ...d.features,
        [key]: { ...d.features[key], ...patch } as DesktopSettings["features"][K],
      },
    }));
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <UpdatesSection />

      <Section title="Convex">
        <Field label="Deployment URL">
          <input
            type="url"
            placeholder="https://your-app.convex.cloud"
            value={draft.convexUrl}
            onChange={(e) => setField("convexUrl", e.target.value.trim())}
            style={{ width: "100%" }}
          />
        </Field>
        <Field label="Session token (Clerk JWT from web app)">
          <textarea
            placeholder="eyJhbGc..."
            rows={3}
            value={draft.convexAuthToken}
            onChange={(e) => setField("convexAuthToken", e.target.value.trim())}
            style={{ width: "100%", resize: "vertical", fontFamily: "monospace", fontSize: 11 }}
          />
        </Field>
        <p style={{ fontSize: 11, color: "#888", margin: "4px 0 0" }}>
          Get a token by opening the web app's developer tools → Application → Cookies
          → look for the Clerk session token. Future versions will deep-link.
        </p>
      </Section>

      <Section title="Object storage">
        <Field label="Provider">
          <select
            value={draft.storage.provider}
            onChange={(e) => setStorage("provider", e.target.value as "r2" | "railway")}
          >
            <option value="r2">Cloudflare R2</option>
            <option value="railway">Railway S3</option>
          </select>
        </Field>
        <Field label="Bucket name">
          <input
            value={draft.storage.bucket}
            onChange={(e) => setStorage("bucket", e.target.value.trim())}
            style={{ width: "100%" }}
          />
        </Field>
        <Field label="Endpoint URL">
          <input
            value={draft.storage.endpoint}
            placeholder={
              draft.storage.provider === "r2"
                ? "https://<account>.r2.cloudflarestorage.com"
                : "https://bucket-production.up.railway.app"
            }
            onChange={(e) => setStorage("endpoint", e.target.value.trim())}
            style={{ width: "100%" }}
          />
        </Field>
        <Field label="Access key ID">
          <input
            value={draft.storage.accessKeyId}
            onChange={(e) => setStorage("accessKeyId", e.target.value.trim())}
            style={{ width: "100%" }}
          />
        </Field>
        <Field label="Secret access key">
          <input
            type="password"
            value={draft.storage.secretAccessKey}
            onChange={(e) => setStorage("secretAccessKey", e.target.value.trim())}
            style={{ width: "100%" }}
          />
        </Field>
        <Field label="Region">
          <input
            value={draft.storage.region}
            onChange={(e) => setStorage("region", e.target.value.trim())}
            placeholder={draft.storage.provider === "r2" ? "auto" : "us-east-1"}
            style={{ width: 180 }}
          />
        </Field>
      </Section>

      <Section title="Local mirror">
        <Field label="Root folder">
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={draft.rootDir}
              onChange={(e) => setField("rootDir", e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              className="ghost"
              onClick={async () => {
                const picked = await api.dialog.pickFolder();
                if (picked) setField("rootDir", picked);
              }}
            >
              Choose…
            </button>
          </div>
          <p style={{ fontSize: 11, color: "#888", margin: "4px 0 0" }}>
            Each project mirrors as <code>&lt;rootDir&gt;/&lt;project&gt;/&lt;folderName&gt;/</code>. Point this at your mount path below if you go that route.
          </p>
        </Field>
      </Section>

      <Section title="Features (beta)">
        <p style={{ fontSize: 12, color: "#1a1a1a", margin: "0 0 10px" }}>
          LucidLink-parity work, each individually toggleable. All start
          off until you flip them on; turning one off stops its background
          loop on the next save.
        </p>
        <FeatureToggle
          label="File presence + soft locks"
          description="Surface 'Alex has seq_03.prproj open' across the team. Polls lsof on the mount path every few seconds."
          enabled={draft.features.presence.enabled}
          onChange={(enabled) => setFeature("presence", { enabled })}
        />
        <FeatureToggle
          label="Predictive prefetch"
          description="When a .prproj is opened, parse it and warm the rclone VFS cache for the referenced clips before the editor scrubs."
          enabled={draft.features.prefetch.enabled}
          onChange={(enabled) => setFeature("prefetch", { enabled })}
        />
        <FeatureToggle
          label="LAN peer cache"
          description="Transparent peer-first reads — when a teammate on your network has already cached a clip, your editor reads it from them over LAN instead of S3. snip Desktop layers a rclone union remote at mount time with discovered peers as upstreams; the rclone serve subprocess exposes your VFS cache directory to them. Browse + manual pull also available from the LAN Peers panel in the Mount tab."
          enabled={draft.features.lanCache.enabled}
          onChange={(enabled) => setFeature("lanCache", { enabled })}
          rightSlot={
            <input
              type="number"
              min={1024}
              max={65535}
              value={draft.features.lanCache.port}
              onChange={(e) => {
                // Sanitize: must be an integer in [1024, 65535]; fall
                // back to the default for blanks / NaN / out-of-range.
                // The HTML `min`/`max` attributes are advisory only,
                // they don't prevent programmatic or paste-driven
                // bad values from reaching us.
                const raw = Number(e.target.value);
                const safe = Number.isInteger(raw)
                  ? Math.min(65535, Math.max(1024, raw))
                  : 17900;
                setFeature("lanCache", { port: safe });
              }}
              disabled={!draft.features.lanCache.enabled}
              style={{ width: 80, fontFamily: "monospace", fontSize: 11 }}
              title="Local HTTP cache server port"
            />
          }
        />
        <FeatureToggle
          label="Folder ACLs"
          description="Enforce team-scoped folder permissions at mount time. Grants are configured in the web app (Team settings → Folder permissions). Enabling here makes snip Desktop fetch your effective allow-list and pass it as an rclone --filter-from when mounting."
          enabled={draft.features.acls.enabled}
          onChange={(enabled) => setFeature("acls", { enabled })}
        />
      </Section>

      <Section title="Mount as drive (advanced)">
        <p style={{ fontSize: 12, color: "#1a1a1a", margin: "0 0 8px" }}>
          Mount the whole bucket so Finder / Premiere / Resolve see your
          projects without an explicit pull. See{" "}
          <code>docs/MOUNTING.md</code> for the full setup. Quick recipe
          using your saved credentials:
        </p>
        <MountCommandPreview settings={draft} />
        <p style={{ fontSize: 11, color: "#888", margin: "8px 0 0" }}>
          Run this in Terminal after installing rclone + macFUSE
          (<code>brew install rclone macfuse</code>) and approving the
          macFUSE kernel extension in System Settings.
        </p>
      </Section>

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button className="primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        <button className="ghost" onClick={() => setDraft(settings)} disabled={saving}>
          Discard
        </button>
      </div>
    </div>
  );
}

function MountCommandPreview({ settings }: { settings: DesktopSettings }) {
  const s = settings.storage;
  const endpoint = s.endpoint || "<endpoint>";
  const bucket = s.bucket || "<bucket>";
  const accessKey = s.accessKeyId || "<R2_ACCESS_KEY_ID>";
  const secretKey = s.secretAccessKey ? "<SECRET-FROM-SETTINGS>" : "<R2_SECRET_ACCESS_KEY>";
  const mountAt = settings.rootDir || "~/snip";

  const lines = [
    "# 1. Configure rclone remote (one-time, run rclone config interactively or this scripted form):",
    `rclone config create snip s3 \\`,
    `  provider Cloudflare \\`,
    `  access_key_id "${accessKey}" \\`,
    `  secret_access_key "${secretKey}" \\`,
    `  region auto \\`,
    `  endpoint "${endpoint}"`,
    "",
    "# 2. Mount it:",
    `mkdir -p "${mountAt}"`,
    `rclone mount "snip:${bucket}/projects" "${mountAt}" \\`,
    `  --vfs-cache-mode writes \\`,
    `  --vfs-cache-max-size 50G \\`,
    `  --vfs-write-back 5s \\`,
    `  --vfs-read-ahead 128M \\`,
    `  --vfs-read-chunk-size 32M \\`,
    `  --buffer-size 32M \\`,
    `  --dir-cache-time 60s \\`,
    `  --transfers 4 \\`,
    `  --daemon`,
    "",
    "# 3. Unmount when done:",
    `umount "${mountAt}"`,
  ];

  const text = lines.join("\n");
  return (
    <div style={{ position: "relative" }}>
      <pre
        style={{
          fontFamily: '"SF Mono", Menlo, Consolas, monospace',
          fontSize: 11,
          background: "#1a1a1a",
          color: "#f0f0e8",
          padding: 12,
          border: "2px solid #1a1a1a",
          overflowX: "auto",
          margin: 0,
        }}
      >
        {text}
      </pre>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(text);
        }}
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          padding: "2px 8px",
          fontSize: 11,
        }}
      >
        Copy
      </button>
    </div>
  );
}

function UpdatesSection() {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({
    status: "idle",
    version: null,
    percent: 0,
    error: null,
  });
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);

  useEffect(() => {
    void api.app.version().then(setVersion).catch(() => setVersion(null));
    // Seed from the current state — the first background check may have already
    // resolved before this panel mounted, and onStatus only carries future
    // transitions.
    void api.update.state().then(setUpdate).catch(() => {});
    return api.update.onStatus(setUpdate);
  }, []);

  const check = async () => {
    setChecking(true);
    setCheckNote(null);
    try {
      const res = await api.update.check();
      if (!res.ok) {
        setCheckNote(
          res.reason === "dev"
            ? "Updates only run in the installed app, not in dev."
            : `Couldn't check: ${res.reason ?? "unknown error"}`,
        );
      }
    } catch (e) {
      setCheckNote(
        `Couldn't check: ${e instanceof Error ? e.message : "unexpected error"}`,
      );
    } finally {
      setChecking(false);
    }
  };

  const install = async () => {
    try {
      const res = await api.update.install();
      if (!res.ok) {
        setCheckNote(
          res.reason === "no-update"
            ? "No downloaded update to install yet."
            : `Couldn't install: ${res.reason ?? "unknown error"}`,
        );
      }
    } catch (e) {
      setCheckNote(
        `Couldn't install: ${e instanceof Error ? e.message : "unexpected error"}`,
      );
    }
  };

  const statusLabel = (() => {
    switch (update.status) {
      case "checking":
        return "Checking for updates…";
      case "available":
        return `Update ${update.version ?? ""} found — downloading…`;
      case "downloading":
        return `Downloading update… ${update.percent}%`;
      case "downloaded":
        return `Update ${update.version ?? ""} ready to install.`;
      case "none":
        return "You're on the latest version.";
      case "error":
        return `Update error: ${update.error ?? "unknown"}`;
      default:
        return "Up to date.";
    }
  })();

  const downloaded = update.status === "downloaded";

  return (
    <Section title="Updates">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#1a1a1a" }}>
            snip Desktop{" "}
            <span style={{ fontFamily: "monospace", color: "#888" }}>
              v{version ?? "—"}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
            {statusLabel}
          </div>
          {checkNote ? (
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{checkNote}</div>
          ) : null}
        </div>
        {downloaded ? (
          <button className="primary" onClick={() => void install()}>
            Restart &amp; install
          </button>
        ) : (
          <button
            className="ghost"
            onClick={() => void check()}
            disabled={
              checking ||
              update.status === "checking" ||
              update.status === "available" ||
              update.status === "downloading"
            }
          >
            {checking || update.status === "checking" ? "Checking…" : "Check for updates"}
          </button>
        )}
      </div>
      <p style={{ fontSize: 11, color: "#888", margin: "4px 0 0" }}>
        New versions download in the background and install when you quit, or
        immediately via Restart &amp; install.
      </p>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: "2px solid #1a1a1a", padding: 14, marginBottom: 14 }}>
      <h3 style={{ margin: "0 0 10px", fontWeight: 900, letterSpacing: "-0.01em" }}>{title}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 4, fontWeight: 700 }}>
        {label.toUpperCase()}
      </div>
      {children}
    </label>
  );
}

function FeatureToggle({
  label,
  description,
  enabled,
  onChange,
  rightSlot,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: "8px 0",
        borderTop: "1px solid #ccc",
      }}
    >
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#1a1a1a" }}>{label}</div>
        <div style={{ fontSize: 11, color: "#666", marginTop: 2, lineHeight: 1.4 }}>
          {description}
        </div>
      </div>
      {rightSlot ? <div style={{ flexShrink: 0 }}>{rightSlot}</div> : null}
    </div>
  );
}

