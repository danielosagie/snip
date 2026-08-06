import { createFileRoute, Link } from "@tanstack/react-router";
import { useUser } from "@clerk/tanstack-react-start";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Input } from "@/components/ui/input";
import {
  CreditCard,
  ExternalLink,
  Hash,
  Video,
  HardDrive,
  Calendar,
  AlertCircle,
  Check,
  RefreshCw,
  DownloadCloud,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  softButton,
  softButtonPrimary,
  softCard,
  SoftField,
  softHelperText,
  softInput,
  SoftPill,
  softRow,
  softTabClass,
} from "@/components/soft";
import { seoHead } from "@/lib/seo";
import { useIsDesktop } from "@/lib/useIsDesktop";

export const Route = createFileRoute("/dashboard/settings")({
  head: () =>
    seoHead({
      title: "Account settings",
      description: "Manage your account.",
      path: "/dashboard/settings",
      noIndex: true,
    }),
  component: SettingsRoute,
});

/**
 * Account-level settings page. Distinct from team settings (which lives
 * at /dashboard/$teamSlug/settings) — that's where invites and
 * team-scoped Stripe Connect payouts live. This page is for the user
 * themselves: profile, notifications, theme defaults.
 *
 * We intentionally lean on Clerk's `useUser` for name/email rather
 * than mirroring those into Convex — Clerk is the source of truth
 * for identity, snip just tags rows with `clerkId`.
 */
const SETTINGS_TABS = [
  { value: "profile", label: "Profile" },
  { value: "notifications", label: "Notifications" },
  { value: "integrations", label: "Integrations" },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["value"];

function SettingsRoute() {
  const { user } = useUser();
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  return (
    <div className="h-full flex flex-col">
      <DashboardHeader paths={[{ label: "Account settings" }]} />

      <div className="surface-soft flex-1 overflow-y-auto bg-[#FAFAFA] px-4 py-8 text-[#131315] sm:px-8 lg:px-14 lg:py-10">
        <div className="w-full max-w-[1120px]">
          <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.02em]">
            Settings
          </h1>
          {/* Soft pill tabs — matches the team settings page. */}
          <nav className="mt-5">
            <div className="flex flex-wrap gap-1.5">
              {SETTINGS_TABS.map((tab) => {
                const isActive = activeTab === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setActiveTab(tab.value)}
                    className={softTabClass(isActive)}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="mt-3.5 space-y-3.5">
            {activeTab === "profile" ? (
              <ProfileTab
                name={user?.fullName ?? user?.firstName ?? ""}
                email={user?.primaryEmailAddress?.emailAddress ?? ""}
              />
            ) : activeTab === "notifications" ? (
              <NotificationsTab />
            ) : (
              <IntegrationsTab />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  contentClassName,
}: {
  title: string;
  children: React.ReactNode;
  contentClassName?: string;
}) {
  return (
    <section className={cn(softCard, "mb-3.5")}>
      <h2 className="text-base font-semibold leading-[22px]">{title}</h2>
      <div className={cn("mt-4 space-y-3", contentClassName)}>{children}</div>
    </section>
  );
}

function ProfileTab({ name, email }: { name: string; email: string }) {
  return (
    <>
      <Section
        title="Profile"
      >
        <SoftField label="Name">
          <Input value={name} readOnly className={softInput} />
        </SoftField>
        <SoftField label="Email">
          <Input value={email} readOnly type="email" className={softInput} />
        </SoftField>
        <p className={softHelperText}>
          Change your identity from the avatar menu.
        </p>
      </Section>
      <Section title="Appearance">
        <p className={softHelperText}>Use the theme toggle in the sidebar.</p>
      </Section>
    </>
  );
}

function NotificationsTab() {
  const prefs = useQuery(api.notifications.getMyPrefs, {});
  const update = useMutation(api.notifications.updateMyPrefs);
  const loading = prefs === undefined;
  return (
    <Section title="Notifications" contentClassName="space-y-0">
      <NotifyToggle
        label="Comment replies"
        help="Email me when someone replies to a thread I'm in."
        checked={prefs?.commentReply ?? true}
        disabled={loading}
        onChange={(v) => void update({ commentReply: v })}
      />
      <NotifyToggle
        label="Contract signature events"
        help="Email me when a contract on one of my projects is signed."
        checked={prefs?.contractSigned ?? true}
        disabled={loading}
        onChange={(v) => void update({ contractSigned: v })}
      />
      <NotifyToggle
        label="Upload completion"
        help="Email me when a long upload finishes (over 5 minutes)."
        checked={prefs?.uploadFinished ?? false}
        disabled={loading}
        onChange={(v) => void update({ uploadFinished: v })}
      />
      <p className={cn(softHelperText, "pt-2")}>
        Preferences save even when email delivery is unavailable.
      </p>
    </Section>
  );
}

function NotifyToggle({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className={cn(softRow, "cursor-pointer flex-nowrap items-start")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[#FF6600] disabled:opacity-50"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-5 text-[#131315]">{label}</div>
        {help ? (
          <div className="mt-0.5 text-[13px] leading-[18px] text-[#A0A0A5]">{help}</div>
        ) : null}
      </div>
    </label>
  );
}

type DesktopUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "none"
  | "downloading"
  | "downloaded"
  | "error";

type DesktopUpdateSnapshot = {
  status: DesktopUpdateStatus;
  version: string | null;
  percent: number;
  error: string | null;
  requiresManualInstall: boolean;
};

/**
 * snip Desktop version + updates. Only renders inside the desktop shell — in a
 * plain browser window.api is absent and this is null. The native menu's
 * "Check for Updates…" item drives the same flow; this surfaces version,
 * progress, and the "Restart & install" handoff so updating is possible
 * without leaving the app.
 */
function DesktopUpdatesSection() {
  const isDesktop = useIsDesktop();
  const [version, setVersion] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DesktopUpdateSnapshot | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!isDesktop || typeof window === "undefined" || !window.api) return;
    void window.api.app.version().then(setVersion).catch(() => {});
    void window.api.update.state().then((s) => setSnapshot(s)).catch(() => {});
    return window.api.update.onStatus((s) => setSnapshot(s));
  }, [isDesktop]);

  if (!isDesktop) return null;

  const status = snapshot?.status ?? "idle";
  const busy = checking || status === "checking" || status === "downloading";
  const manualUpdateReady =
    Boolean(snapshot?.requiresManualInstall) &&
    (status === "available" || status === "downloaded");

  const check = async () => {
    if (!window.api) return;
    setChecking(true);
    try {
      const res = await window.api.update.check();
      if (!res.ok && res.reason && res.reason !== "dev") {
        setSnapshot((prev) => ({
          status: "error",
          version: prev?.version ?? null,
          percent: prev?.percent ?? 0,
          error: res.reason ?? "Update check failed.",
          requiresManualInstall: prev?.requiresManualInstall ?? false,
        }));
      }
    } finally {
      setChecking(false);
    }
  };

  const statusLine = (() => {
    switch (status) {
      case "checking":
        return "Checking for updates…";
      case "available":
        return snapshot?.requiresManualInstall
          ? `Update available${snapshot.version ? ` (v${snapshot.version})` : ""}.`
          : `Update available${snapshot?.version ? ` (v${snapshot.version})` : ""}. Downloading in the background…`;
      case "downloading":
        return `Downloading update… ${snapshot?.percent ?? 0}%`;
      case "downloaded":
        return snapshot?.requiresManualInstall
          ? `Update ready${snapshot.version ? ` (v${snapshot.version})` : ""}.`
          : `Update ready${snapshot?.version ? ` (v${snapshot.version})` : ""}. Restart to install.`;
      case "none":
        return "You're on the latest version.";
      case "error":
        return snapshot?.error ?? "Update check failed.";
      default:
        return snapshot?.requiresManualInstall
          ? "Updates are checked automatically. You choose when to install them."
          : "Updates download automatically in the background and install on the next quit.";
    }
  })();

  return (
    <Section title="snip Desktop">
      <SoftField label="Installed version">
        <div className="text-sm text-[#131315]">
          {version ? `v${version}` : "Not available"}
        </div>
      </SoftField>
      <p
        className={cn(
          "text-[13px] leading-[18px]",
          status === "error" ? "text-[#D8434F]" : "text-[#A0A0A5]",
        )}
      >
        {statusLine}
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => void check()}
          disabled={busy}
          className={cn(softButton, "inline-flex items-center gap-2")}
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", busy && "animate-spin")}
          />
          Check for updates
        </button>
        {manualUpdateReady || status === "downloaded" ? (
          <button
            type="button"
            onClick={() => void window.api?.update.install()}
            className={cn(softButtonPrimary, "inline-flex items-center gap-2")}
          >
            <DownloadCloud className="h-3.5 w-3.5" />
            {manualUpdateReady ? "Download update" : "Restart & install"}
          </button>
        ) : null}
      </div>
    </Section>
  );
}

function IntegrationsTab() {
  const featureStatus = useQuery(api.featureFlags.getFeatureStatus, {});

  return (
    <>
      <DesktopUpdatesSection />
      <Section title="Connected services">
        <IntegrationRow
          icon={<CreditCard className="h-4 w-4" />}
          label="Stripe Connect"
          description="Receive client payments on paywalled delivery links. Each team has its own connected account."
          status={
            featureStatus?.stripeConnect
              ? "configured"
              : "not-configured"
          }
          configuredHint="Stripe API keys detected. Set up payouts in Billing."
          notConfiguredHint="Set STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET in your Convex env to enable."
          action={
            <Link
              to="/dashboard/billing"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-[#D14E00] underline underline-offset-2"
            >
              Open Billing
              <ExternalLink className="h-3 w-3" />
            </Link>
          }
        />

        <IntegrationRow
          icon={<Video className="h-4 w-4" />}
          label="Mux"
          description="Video ingest, encoding, and HLS playback."
          status={
            featureStatus?.muxIngest ? "configured" : "not-configured"
          }
          configuredHint={
            featureStatus?.muxSignedPlayback
              ? "Signed playback enabled. Paywalled deliveries can stream."
              : "Public playback only. Add a Mux signing key for paywalled streams."
          }
          notConfiguredHint="Set MUX_TOKEN_ID + MUX_TOKEN_SECRET in your Convex env."
        />

        <IntegrationRow
          icon={<HardDrive className="h-4 w-4" />}
          label={featureStatus?.usingR2 ? "Cloudflare R2" : "Object storage"}
          description="S3-compatible storage for source files, .docx contracts, watermarked deliveries."
          status={
            featureStatus?.objectStorage ? "configured" : "not-configured"
          }
          configuredHint={
            featureStatus?.usingR2
              ? "Using R2 (preferred)."
              : "Using Railway S3-compatible storage."
          }
          notConfiguredHint="Set R2_* or RAILWAY_* env vars in Convex to enable cloud-saved contracts and source-file mirroring."
        />
      </Section>

      <Section title="Personal integrations">
        <IntegrationRow
          icon={<Hash className="h-4 w-4" />}
          label="Slack"
          description="DM mentions when someone @-tags you on a comment, plus a daily digest of project activity."
          status="coming-soon"
          notConfiguredHint="Connector ships after Slack OAuth is connected."
        />
        <IntegrationRow
          icon={<Calendar className="h-4 w-4" />}
          label="Calendar sync"
          description="Push contract deadlines + delivery milestones to your Google / Apple calendar."
          status="coming-soon"
          notConfiguredHint="Will surface here once we wire Google + iCloud OAuth."
        />
      </Section>
    </>
  );
}

type IntegrationStatus = "configured" | "not-configured" | "coming-soon";

function IntegrationRow({
  icon,
  label,
  description,
  status,
  configuredHint,
  notConfiguredHint,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  status: IntegrationStatus;
  configuredHint?: string;
  notConfiguredHint?: string;
  action?: React.ReactNode;
}) {
  const hint =
    status === "configured" ? configuredHint : notConfiguredHint;
  return (
    <div className="flex flex-col gap-3 rounded-[11px] border border-[#E8E8EC] bg-white p-4 sm:flex-row">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[9px] border border-[#E8E8EC] bg-[#FAFAFA] text-[#6E6E73]">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold">{label}</h3>
          <StatusBadge status={status} />
        </div>
        <p className="mt-1 text-sm leading-5 text-[#6E6E73]">{description}</p>
        {hint ? (
          <p
            className={cn(
              "mt-2 flex items-start gap-1.5 text-[13px] leading-[18px]",
              status === "configured" ? "text-[#D14E00]" : "text-[#A0A0A5]",
            )}
          >
            {status === "configured" ? (
              <Check className="h-3 w-3 mt-0.5 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
            )}
            <span>{hint}</span>
          </p>
        ) : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: IntegrationStatus }) {
  if (status === "configured") return <SoftPill tone="accent">Connected</SoftPill>;
  if (status === "coming-soon")
    return <SoftPill>Coming soon</SoftPill>;
  return <SoftPill>Not configured</SoftPill>;
}
