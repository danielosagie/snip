import type { ReactNode } from "react";
import { AlertCircle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared primitives for the soft account-level surfaces (billing, team
 * members, settings).
 *
 * These mirror the shapes the Billing & Invoices page established, so the
 * three pages read as one system: hairline cards on #FAFAFA, 14px radius,
 * Inter Tight, #6E6E73 for secondary text. Wrap a page in `SoftPage` to
 * pull in the scoped token block from app.css (`.surface-soft`) rather
 * than hand-setting colors on every child.
 *
 * The brutalist app skin still owns everything else; this is deliberately
 * page-scoped, not global.
 */

export const softCard =
  "rounded-[14px] border border-[#E8E8EC] bg-white px-5 py-5 sm:px-6 sm:py-[22px]";

export const softButton =
  "shrink-0 rounded-full border border-[#DADADD] bg-white px-4 py-2 text-[13px] font-medium transition-colors hover:bg-[#F7F7F8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315] disabled:cursor-not-allowed disabled:opacity-50";

export const softButtonPrimary =
  "shrink-0 rounded-full border border-[#131315] bg-[#131315] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#2A2A2E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315] disabled:cursor-not-allowed disabled:opacity-50";

/** Page shell: scoped soft tokens, page background, and the content column. */
export function SoftPage({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="surface-soft flex-1 overflow-y-auto bg-[#FAFAFA] px-4 py-8 text-[#131315] sm:px-8 lg:px-14 lg:py-10">
      <div className="w-full max-w-[1120px] space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.02em]">
            {title}
          </h1>
          {aside}
        </div>
        {children}
      </div>
    </main>
  );
}

export function SoftCard({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn(softCard, className)} {...rest}>
      {children}
    </section>
  );
}

export function SoftCardHeading({
  id,
  title,
  subtitle,
  aside,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div>
        <h2 id={id} className="text-base font-semibold leading-[22px]">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-sm leading-5 text-[#6E6E73]">{subtitle}</p>
        ) : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}

/** Hairline-separated row, for member lists and settings rows. */
export function SoftRow({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 border-t border-[#F1F1F3] py-3.5 first:border-t-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SoftPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-full bg-[#F1F1F3] px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[#6E6E73]">
      {children}
    </span>
  );
}

export function SoftNotice({
  kind,
  children,
}: {
  kind: "success" | "warning" | "error";
  children: ReactNode;
}) {
  const styles = {
    success: "border-[#BBE2CA] bg-[#F2FBF5] text-[#225B36]",
    warning: "border-[#E7D3AB] bg-[#FFF9EC] text-[#74521D]",
    error: "border-[#E8B9BD] bg-[#FFF5F5] text-[#8A2B34]",
  };
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm",
        styles[kind],
      )}
    >
      {kind === "success" ? (
        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span>{children}</span>
    </div>
  );
}

export function SoftSkeleton() {
  return (
    <div
      className={cn(softCard, "h-28 animate-pulse bg-white")}
      aria-label="Loading"
    />
  );
}

/**
 * Pill tab styling for the soft surface. Returned as a class rather than a
 * component so callers keep using their own router `Link` or `button`.
 */
export function softTabClass(active: boolean): string {
  return cn(
    "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
    active
      ? "bg-[#131315] text-white"
      : "text-[#6E6E73] hover:bg-[#F1F1F3] hover:text-[#131315]",
  );
}
