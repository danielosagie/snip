import { createFileRoute, Link } from "@tanstack/react-router";
import { useUser } from "@clerk/tanstack-react-start";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  CreditCard,
  ExternalLink,
  Hash,
  Video,
  HardDrive,
  Calendar,
  AlertCircle,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { seoHead } from "@/lib/seo";

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

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-black tracking-tight text-[#1a1a1a]">
            Settings
          </h1>
          <p className="text-sm text-[#666] mt-1">
            Manage your account, notification preferences, and connected
            integrations. Team-scoped settings live in the team settings page.
          </p>

          {/* Brutalist tab strip — matches the team settings page. */}
          <nav className="border-b-2 border-[#1a1a1a] mt-6">
            <div className="flex gap-1">
              {SETTINGS_TABS.map((tab) => {
                const isActive = activeTab === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setActiveTab(tab.value)}
                    className={
                      isActive
                        ? "px-4 py-2 text-sm font-bold border-2 border-[#1a1a1a] border-b-0 bg-[#f0f0e8] text-[#1a1a1a] -mb-[2px] relative z-10"
                        : "px-4 py-2 text-sm font-bold text-[#666] hover:text-[#1a1a1a] border-2 border-transparent"
                    }
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="mt-4">
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
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-2 border-[#1a1a1a] bg-[#f0f0e8] p-6 mb-4">
      <h2 className="font-black text-lg tracking-tight">{title}</h2>
      {description ? (
        <p className="text-xs text-[#666] mt-0.5">{description}</p>
      ) : null}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.15em] text-[#888] font-bold mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}

function ProfileTab({ name, email }: { name: string; email: string }) {
  return (
    <>
      <Section
        title="Profile"
        description="Identity comes from Clerk. To change your name or email, use the avatar menu in the bottom of the sidebar."
      >
        <Field label="Name">
          <Input value={name} readOnly />
        </Field>
        <Field label="Email">
          <Input value={email} readOnly type="email" />
        </Field>
      </Section>
      <Section
        title="Appearance"
        description="Theme follows the toggle in the sidebar footer. Other appearance settings will land here later."
      >
        <div className="text-sm text-[#666]">
          Nothing else to tune yet.
        </div>
      </Section>
    </>
  );
}

function NotificationsTab() {
  const prefs = useQuery(api.notifications.getMyPrefs, {});
  const update = useMutation(api.notifications.updateMyPrefs);
  const loading = prefs === undefined;
  return (
    <Section
      title="Notifications"
      description="Email cadence for comments, contract status, and uploads."
    >
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
      <p className="pt-2 text-xs text-[#888] font-mono">
        Emails send via Resend when configured; until then preferences
        still save and in-app activity is unaffected.
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
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[#FF6600] disabled:opacity-50"
      />
      <div className="flex-1">
        <div className="font-bold text-sm text-[#1a1a1a]">{label}</div>
        {help ? (
          <div className="text-xs text-[#666] mt-0.5">{help}</div>
        ) : null}
      </div>
    </label>
  );
}

function IntegrationsTab() {
  const featureStatus = useQuery(api.featureFlags.getFeatureStatus, {});

  return (
    <>
      <Section
        title="Connected services"
        description="Service status across this deployment. Per-team integrations like Stripe Connect link out to the team they belong to."
      >
        <IntegrationRow
          icon={<CreditCard className="h-4 w-4" />}
          label="Stripe Connect"
          description="Receive client payments on paywalled delivery links. Each team has its own connected account."
          status={
            featureStatus?.stripeConnect
              ? "configured"
              : "not-configured"
          }
          configuredHint="Stripe API keys detected — set up payouts in Billing to enable receiving money."
          notConfiguredHint="Set STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET in your Convex env to enable."
          action={
            <Link
              to="/dashboard/billing"
              className="inline-flex items-center gap-1 text-xs font-bold text-[#FF6600] hover:text-[#FF7A1F] underline underline-offset-2"
            >
              Set up payouts in Billing
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
              ? "Signed playback enabled — paywalled deliveries can stream."
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

      <Section
        title="Personal integrations"
        description="Account-scoped automations. Each one lights up when its env or OAuth credentials are present."
      >
        <IntegrationRow
          icon={<Hash className="h-4 w-4" />}
          label="Slack"
          description="DM mentions when someone @-tags you on a comment, plus a daily digest of project activity."
          status="coming-soon"
          notConfiguredHint="Connector ships once we wire Slack OAuth — tracked separately."
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
    <div className="border-2 border-[#1a1a1a] p-4 flex flex-col sm:flex-row gap-3">
      <div className="w-9 h-9 flex items-center justify-center border-2 border-[#1a1a1a] bg-[#e8e8e0] flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-black text-sm tracking-tight">{label}</h3>
          <StatusBadge status={status} />
        </div>
        <p className="text-xs text-[#666] mt-1">{description}</p>
        {hint ? (
          <p
            className={cn(
              "text-[11px] font-mono mt-2 flex items-start gap-1.5",
              status === "configured" ? "text-[#FF6600]" : "text-[#888]",
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
  if (status === "configured") return <Badge variant="success">Connected</Badge>;
  if (status === "coming-soon")
    return <Badge variant="secondary">Coming soon</Badge>;
  return <Badge variant="warning">Not configured</Badge>;
}
