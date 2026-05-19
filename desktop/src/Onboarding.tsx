/**
 * First-run onboarding — a full-screen, stepped flow modeled on the web
 * app's contract wizard (one focused thing per screen, a top stepper,
 * dominant typography, keyboard advance). Replaces the old "drop the
 * user straight into a settings form" experience.
 *
 *   Connect → Prerequisites → Mount → Done
 *
 * Commit 1 (this): the visual shell + the steps wired to the existing
 * IPC (manual credential entry, prereq probe, mount). The "Connect"
 * step is still credential entry, but framed as the thing one-click
 * sign-in will replace — commit 2 swaps its body for device pairing
 * and demotes manual entry to a real "Advanced" escape hatch.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSignIn } from "@clerk/clerk-react";
import { api, DesktopSettings, MountPrereqs, MountState } from "./api";
import { runPairing, PairingStorage } from "./pairing";
import { CONVEX_URL } from "./config";
import { C, mono, Wordmark, Eyebrow, Field, Pill, Banner, Glyph, Square } from "./ui";

type Step = "connect" | "prereqs" | "mount" | "done";
const STEPS: { id: Step; label: string }[] = [
  { id: "connect", label: "Connect" },
  { id: "prereqs", label: "Prerequisites" },
  { id: "mount", label: "Mount" },
  { id: "done", label: "Done" },
];

interface Props {
  settings: DesktopSettings;
  onChange: (next: DesktopSettings) => Promise<void>;
  isSignedIn: boolean;
  onDone: () => void;
}

export function Onboarding({ settings, onChange, isSignedIn, onDone }: Props) {
  const [step, setStep] = useState<Step>("connect");
  const [draft, setDraft] = useState<DesktopSettings>(settings);
  const [saving, setSaving] = useState(false);

  const [prereqs, setPrereqs] = useState<MountPrereqs | null>(null);
  const [mount, setMount] = useState<MountState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.mount.prereqs().then(setPrereqs);
    void api.mount.status().then(setMount);
    return api.mount.onStatus(setMount);
  }, []);

  const connectComplete = Boolean(
    isSignedIn && draft.storage.bucket && draft.storage.accessKeyId,
  );
  const hasPrereqs = Boolean(prereqs?.rclone && prereqs?.fuse);
  const isMounted = mount?.status === "mounted";

  const canAdvance =
    step === "connect"
      ? connectComplete
      : step === "prereqs"
        ? hasPrereqs
        : step === "mount"
          ? isMounted
          : true;

  const idx = STEPS.findIndex((s) => s.id === step);
  const stageProgress =
    step === "connect"
      ? connectComplete
        ? 1
        : 0.4
      : step === "prereqs"
        ? hasPrereqs
          ? 1
          : 0.4
        : step === "mount"
          ? isMounted
            ? 1
            : 0.4
          : 1;

  const persist = async () => {
    setSaving(true);
    try {
      await onChange(draft);
    } finally {
      setSaving(false);
    }
  };

  // Pairing delivered the bucket bootstrap — fold it into settings.
  const commitStorage = async (s: PairingStorage) => {
    const next: DesktopSettings = {
      ...draft,
      convexUrl: CONVEX_URL,
      storage: {
        ...draft.storage,
        provider: s.provider,
        bucket: s.bucket,
        endpoint: s.endpoint,
        accessKeyId: s.accessKeyId,
        secretAccessKey: s.secretAccessKey,
        region: s.region,
      },
    };
    setDraft(next);
    await onChange(next);
  };

  const advance = async () => {
    if (!canAdvance) return;
    if (step === "connect") {
      await persist();
      setStep("prereqs");
      return;
    }
    if (step === "prereqs") {
      setStep("mount");
      return;
    }
    if (step === "mount") {
      setStep("done");
      return;
    }
    onDone();
  };

  const back = () => {
    const order: Step[] = ["connect", "prereqs", "mount", "done"];
    const i = order.indexOf(step);
    if (i > 0) setStep(order[i - 1]);
  };

  const recheck = () => void api.mount.prereqs().then(setPrereqs);

  const handleMount = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.mount.start({ mountPath: draft.rootDir });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mount failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: C.bg,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top bar: wordmark + stepper */}
      <header
        style={{
          flexShrink: 0,
          borderBottom: `2px solid ${C.border}`,
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          gap: 20,
          WebkitAppRegion: "drag",
        } as React.CSSProperties}
      >
        <div style={{ paddingLeft: 56 }}>
          <Wordmark size={17} sub="setup" />
        </div>
        <div style={{ flex: 1, WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <Stepper currentIndex={idx} stageProgress={stageProgress} />
        </div>
      </header>

      {/* Body — single focused panel, generous whitespace */}
      <main
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "48px 24px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: 620 }}>
          {step === "connect" ? (
            <ConnectStep
              draft={draft}
              setDraft={setDraft}
              isSignedIn={isSignedIn}
              commitStorage={commitStorage}
            />
          ) : step === "prereqs" ? (
            <PrereqStep prereqs={prereqs} onRecheck={recheck} />
          ) : step === "mount" ? (
            <MountStep
              draft={draft}
              mount={mount}
              busy={busy}
              error={error}
              onMount={() => void handleMount()}
            />
          ) : (
            <DoneStep
              rootDir={draft.rootDir}
              onOpenFolder={() => void api.shell.openFolder(draft.rootDir)}
            />
          )}
        </div>
      </main>

      {/* Action bar */}
      <footer
        style={{
          flexShrink: 0,
          borderTop: `2px solid ${C.border}`,
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <button
          className="ghost"
          onClick={back}
          disabled={step === "connect" || saving || busy}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Glyph name="arrow-left" size={14} /> Back
          </span>
        </button>
        <div
          style={{
            fontFamily: mono,
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: C.muted,
          }}
        >
          Step {idx + 1} of {STEPS.length}
        </div>
        <button
          className="primary"
          onClick={() => void advance()}
          disabled={!canAdvance || saving || busy}
          title={
            !canAdvance
              ? step === "connect"
                ? "Fill in the connection fields to continue"
                : step === "prereqs"
                  ? "Install rclone + the FUSE driver to continue"
                  : "Mount the drive to continue"
              : undefined
          }
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {step === "done"
              ? "Open snip"
              : step === "mount"
                ? "Finish"
                : saving
                  ? "Saving…"
                  : "Next"}
            {step !== "done" ? <Glyph name="arrow-right" size={14} /> : null}
          </span>
        </button>
      </footer>
    </div>
  );
}

// ─── Stepper ────────────────────────────────────────────────────────────────

function Stepper({
  currentIndex,
  stageProgress,
}: {
  currentIndex: number;
  stageProgress: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {STEPS.map((s, i) => {
        const isPast = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <div
            key={s.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flex: 1,
              minWidth: 0,
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 800,
                border: `2px solid ${C.border}`,
                flexShrink: 0,
                background: isPast ? C.accent : isCurrent ? C.fg : C.bg,
                color: isPast || isCurrent ? C.bg : C.muted,
              }}
            >
              {isPast ? <Glyph name="check" size={13} /> : i + 1}
            </div>
            <div
              style={{
                fontFamily: mono,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                color: isCurrent ? C.fg : C.muted,
              }}
            >
              {s.label}
            </div>
            {i < STEPS.length - 1 ? (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  background: C.borderSubtle,
                  position: "relative",
                  overflow: "hidden",
                  minWidth: 16,
                }}
              >
                {isPast ? (
                  <div style={{ position: "absolute", inset: 0, background: C.accent }} />
                ) : isCurrent ? (
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: 0,
                      background: C.accent,
                      width: `${Math.round(stageProgress * 100)}%`,
                      transition: "width 0.2s ease",
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ─── Steps ──────────────────────────────────────────────────────────────────

function StepHead({
  eyebrow,
  title,
  blurb,
}: {
  eyebrow: string;
  title: string;
  blurb: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 style={{ fontSize: 34, marginTop: 8, lineHeight: 1.05 }}>{title}</h1>
      <p
        style={{
          fontSize: 14,
          color: "#555",
          marginTop: 10,
          maxWidth: "52ch",
          lineHeight: 1.55,
        }}
      >
        {blurb}
      </p>
    </div>
  );
}

type ConnectPhase = "idle" | "pairing" | "redeeming" | "done" | "error";

function ConnectStep({
  draft,
  setDraft,
  isSignedIn,
  commitStorage,
}: {
  draft: DesktopSettings;
  setDraft: (fn: (d: DesktopSettings) => DesktopSettings) => void;
  isSignedIn: boolean;
  commitStorage: (s: PairingStorage) => Promise<void>;
}) {
  const { signIn, setActive, isLoaded: clerkLoaded } = useSignIn();
  const [phase, setPhase] = useState<ConnectPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [openedUrl, setOpenedUrl] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const alreadyConnected =
    isSignedIn && Boolean(draft.storage.bucket && draft.storage.accessKeyId);

  const setS = <K extends keyof DesktopSettings["storage"]>(
    k: K,
    v: DesktopSettings["storage"][K],
  ) => setDraft((d) => ({ ...d, storage: { ...d.storage, [k]: v } }));
  const set = <K extends keyof DesktopSettings>(k: K, v: DesktopSettings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const handleConnect = async () => {
    setError(null);
    setOpenedUrl(null);
    setPhase("pairing");
    cancelRef.current = { cancelled: false };
    try {
      const result = await runPairing({
        deviceLabel:
          typeof navigator !== "undefined" && navigator.platform
            ? `snip desktop · ${navigator.platform}`
            : "snip desktop",
        onOpened: (u) => setOpenedUrl(u),
        signal: cancelRef.current,
      });

      setPhase("redeeming");
      if (!clerkLoaded || !signIn) {
        throw new Error("Auth not ready — try again in a moment.");
      }
      const res = await signIn.create({
        strategy: "ticket",
        ticket: result.signInToken,
      });
      if (res.status !== "complete" || !res.createdSessionId) {
        throw new Error("Could not establish a session from the sign-in.");
      }
      await setActive({ session: res.createdSessionId });

      if (result.storage) {
        await commitStorage(result.storage);
      }
      setPhase("done");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Connection failed.");
    }
  };

  const cancel = () => {
    cancelRef.current.cancelled = true;
    setPhase("idle");
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Wordmark size={40} />
      </div>
      <StepHead
        eyebrow="Step 1 — Connect"
        title={
          alreadyConnected || phase === "done"
            ? "Account connected."
            : "Sign in to snip."
        }
        blurb={
          <>
            snip streams your team's cloud bucket as a real Mac volume, so
            Finder, Premiere, and Resolve see project files natively — no
            manual pulls. One click connects this machine to your account —
            nothing to copy or paste.
          </>
        }
      />

      {alreadyConnected || phase === "done" ? (
        <Banner tone="ok">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Glyph name="check" size={15} />
            Connected. Continue to set up your drive.
          </span>
        </Banner>
      ) : phase === "pairing" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Banner tone="accent">
            Approve this device in your browser. We opened the snip web app —
            sign in there if needed, and it'll connect back automatically.
          </Banner>
          {openedUrl ? (
            <div
              style={{
                fontFamily: mono,
                fontSize: 11,
                color: C.muted,
                wordBreak: "break-all",
              }}
            >
              {openedUrl}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Pill tone="neutral">Waiting for approval…</Pill>
            <button className="ghost" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : phase === "redeeming" ? (
        <Banner tone="accent">Finishing sign-in…</Banner>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <button
            className="primary"
            onClick={() => void handleConnect()}
            style={{ alignSelf: "flex-start" }}
          >
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              Connect snip account
              <Glyph name="external" size={15} />
            </span>
          </button>
          {phase === "error" && error ? (
            <Banner tone="danger">{error}</Banner>
          ) : null}
        </div>
      )}

      {/* Advanced escape hatch — self-host / debugging only. */}
      <div style={{ marginTop: 28 }}>
        <button
          className="ghost"
          onClick={() => setAdvanced((v) => !v)}
          style={{ fontSize: 12 }}
        >
          {advanced ? "Hide advanced" : "Advanced — connect manually"}
        </button>
        {advanced ? (
          <div
            style={{
              marginTop: 14,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              border: `2px solid ${C.border}`,
              padding: 16,
            }}
          >
            <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.5 }}>
              For self-hosted deployments. Paste a Convex session token and
              bucket credentials instead of pairing.
            </p>
            <Field label="Convex deployment URL">
              <input
                type="url"
                placeholder="https://your-app.convex.cloud"
                value={draft.convexUrl}
                onChange={(e) => set("convexUrl", e.target.value.trim())}
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="Session token">
              <textarea
                placeholder="eyJhbGc…"
                rows={3}
                value={draft.convexAuthToken}
                onChange={(e) => set("convexAuthToken", e.target.value.trim())}
                style={{
                  width: "100%",
                  resize: "vertical",
                  fontFamily: mono,
                  fontSize: 11,
                }}
              />
            </Field>
            <div
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
            >
              <Field label="Storage provider">
                <select
                  value={draft.storage.provider}
                  onChange={(e) =>
                    setS("provider", e.target.value as "r2" | "railway")
                  }
                  style={{ width: "100%" }}
                >
                  <option value="r2">Cloudflare R2</option>
                  <option value="railway">Railway S3</option>
                </select>
              </Field>
              <Field label="Region">
                <input
                  value={draft.storage.region}
                  onChange={(e) => setS("region", e.target.value.trim())}
                  placeholder={
                    draft.storage.provider === "r2" ? "auto" : "us-east-1"
                  }
                  style={{ width: "100%" }}
                />
              </Field>
            </div>
            <Field label="Bucket name">
              <input
                value={draft.storage.bucket}
                onChange={(e) => setS("bucket", e.target.value.trim())}
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="Endpoint URL">
              <input
                value={draft.storage.endpoint}
                onChange={(e) => setS("endpoint", e.target.value.trim())}
                style={{ width: "100%" }}
              />
            </Field>
            <div
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
            >
              <Field label="Access key ID">
                <input
                  value={draft.storage.accessKeyId}
                  onChange={(e) => setS("accessKeyId", e.target.value.trim())}
                  style={{ width: "100%" }}
                />
              </Field>
              <Field label="Secret access key">
                <input
                  type="password"
                  value={draft.storage.secretAccessKey}
                  onChange={(e) =>
                    setS("secretAccessKey", e.target.value.trim())
                  }
                  style={{ width: "100%" }}
                />
              </Field>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PrereqStep({
  prereqs,
  onRecheck,
}: {
  prereqs: MountPrereqs | null;
  onRecheck: () => void;
}) {
  const ok = Boolean(prereqs?.rclone && prereqs?.fuse);
  return (
    <div>
      <StepHead
        eyebrow="Step 2 — Prerequisites"
        title={ok ? "You're all set." : "Two tools, installed once."}
        blurb={
          <>
            The drive is backed by <code>rclone</code> + a FUSE filesystem
            driver. Install them once; snip handles everything else.
          </>
        }
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <PrereqRow
          label="rclone"
          present={Boolean(prereqs?.rclone)}
          loading={!prereqs}
        />
        <PrereqRow
          label={
            prereqs?.platform === "darwin"
              ? "macFUSE"
              : prereqs?.platform === "win32"
                ? "WinFsp"
                : "FUSE"
          }
          present={Boolean(prereqs?.fuse)}
          loading={!prereqs}
          note={
            prereqs?.platform === "darwin"
              ? "Requires kernel-extension approval in System Settings → Privacy & Security after install."
              : undefined
          }
        />
      </div>

      {!ok && prereqs ? (
        <div style={{ marginTop: 18 }}>
          <Eyebrow>Install command</Eyebrow>
          <pre
            style={{
              marginTop: 8,
              marginBottom: 0,
              background: C.fg,
              color: C.bg,
              fontFamily: mono,
              fontSize: 12,
              padding: 14,
              border: `2px solid ${C.border}`,
              whiteSpace: "pre-wrap",
              lineHeight: 1.6,
            }}
          >
            {prereqs.installHint}
          </pre>
        </div>
      ) : null}

      <div style={{ marginTop: 18 }}>
        <button onClick={onRecheck}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Glyph name="refresh" size={14} /> Re-check
          </span>
        </button>
      </div>
    </div>
  );
}

function PrereqRow({
  label,
  present,
  loading,
  note,
}: {
  label: string;
  present: boolean;
  loading: boolean;
  note?: string;
}) {
  return (
    <div
      style={{
        border: `2px solid ${C.border}`,
        background: present ? "#dde6dd" : C.bg,
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <Square
        color={loading ? C.muted : present ? C.ok : C.danger}
        size={16}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>{label}</div>
        {note ? (
          <div style={{ fontSize: 11, color: "#666", marginTop: 2, lineHeight: 1.4 }}>
            {note}
          </div>
        ) : null}
      </div>
      <Pill tone={loading ? "neutral" : present ? "ok" : "danger"}>
        {loading ? "checking" : present ? "installed" : "missing"}
      </Pill>
    </div>
  );
}

function MountStep({
  draft,
  mount,
  busy,
  error,
  onMount,
}: {
  draft: DesktopSettings;
  mount: MountState | null;
  busy: boolean;
  error: string | null;
  onMount: () => void;
}) {
  const status = mount?.status ?? "unmounted";
  const mounted = status === "mounted";
  return (
    <div>
      <StepHead
        eyebrow="Step 3 — Mount"
        title={mounted ? "Drive is live." : "Mount your drive."}
        blurb={
          <>
            One mount per machine. snip uses the same tuned rclone VFS flags
            as the manual recipe — read-ahead and chunk sizing tuned for big
            sequential video reads.
          </>
        }
      />

      <div
        style={{
          border: `2px solid ${C.border}`,
          background: mounted ? "#dde6dd" : C.cell,
          padding: 16,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <Square
          color={
            mounted
              ? C.ok
              : status === "mounting"
                ? "#b45309"
                : status === "error"
                  ? C.danger
                  : C.muted
          }
          size={18}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>
            {mount?.mountPath ?? draft.rootDir}
          </div>
          <div
            style={{
              fontFamily: mono,
              fontSize: 11,
              color: "#666",
              marginTop: 3,
            }}
          >
            {draft.storage.provider}:{draft.storage.bucket || "(no bucket)"}/projects
          </div>
        </div>
        {mounted ? (
          <Pill tone="ok">mounted</Pill>
        ) : (
          <button
            className="primary"
            onClick={onMount}
            disabled={busy || status === "mounting"}
          >
            {busy || status === "mounting" ? "Mounting…" : "Mount drive"}
          </button>
        )}
      </div>

      {error || mount?.lastError ? (
        <div style={{ marginTop: 12 }}>
          <Banner tone="danger">{error || mount?.lastError}</Banner>
        </div>
      ) : null}

      {mount?.log?.length ? (
        <pre
          style={{
            marginTop: 12,
            marginBottom: 0,
            background: C.fg,
            color: C.bg,
            fontFamily: mono,
            fontSize: 11,
            padding: 12,
            border: `2px solid ${C.border}`,
            maxHeight: 160,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {mount.log.slice(-12).join("\n")}
        </pre>
      ) : null}
    </div>
  );
}

function DoneStep({
  rootDir,
  onOpenFolder,
}: {
  rootDir: string;
  onOpenFolder: () => void;
}) {
  return (
    <div style={{ textAlign: "center", paddingTop: 24 }}>
      <div
        style={{
          width: 56,
          height: 56,
          margin: "0 auto 24px",
          border: `2px solid ${C.border}`,
          background: C.accent,
          color: C.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Glyph name="check" size={30} />
      </div>
      <Eyebrow>All done</Eyebrow>
      <h1 style={{ fontSize: 38, marginTop: 10 }}>
        Your drive is mounted<span style={{ color: C.accent }}>.</span>
      </h1>
      <p
        style={{
          fontSize: 14,
          color: "#555",
          marginTop: 12,
          lineHeight: 1.55,
        }}
      >
        Project files now live at{" "}
        <code style={{ fontSize: 13 }}>{rootDir}</code>. Open it in Finder
        or jump into the app.
      </p>
      <div
        style={{
          marginTop: 24,
          display: "flex",
          gap: 10,
          justifyContent: "center",
        }}
      >
        <button onClick={onOpenFolder}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Glyph name="folder" size={14} /> Open in Finder
          </span>
        </button>
      </div>
    </div>
  );
}
