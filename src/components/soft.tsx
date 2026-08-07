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
  "shrink-0 rounded-full border border-[#D8D8DE] bg-white px-4 py-2 text-[13px] font-medium leading-[18px] text-[#131315] transition-colors hover:bg-[#F1F1F3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315] disabled:cursor-not-allowed disabled:opacity-50";

export const softButtonPrimary =
  "shrink-0 rounded-full border border-[#131315] bg-[#131315] px-4 py-2 text-[13px] font-medium leading-[18px] text-white transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315] disabled:cursor-not-allowed disabled:opacity-50";

export const softButtonDanger =
  "shrink-0 rounded-full border border-[#F0D2D4] bg-white px-4 py-2 text-[13px] font-medium leading-[18px] text-[#D8434F] transition-colors hover:bg-[#FFF5F5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D8434F] disabled:cursor-not-allowed disabled:opacity-50";

export const softFieldLabel =
  "mb-1 block text-[13px] font-medium leading-[18px] text-[#6E6E73]";

export const softHelperText =
  "text-[13px] font-normal leading-[18px] text-[#A0A0A5]";

export const softRow =
  "flex flex-wrap items-center gap-3 border-t border-[#F1F1F3] py-3.5 first:border-t-0";

export const softInput =
  "rounded-[10px] border border-[#E8E8EC] bg-white font-sans text-sm text-[#131315] shadow-none placeholder:text-[#A0A0A5] focus-visible:border-[#FF6600] focus-visible:shadow-none";

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
  ...rest
}: {
  className?: string;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        softRow,
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function SoftField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className={softFieldLabel}>{label}</span>
      {children}
    </label>
  );
}

export function SoftPill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium leading-[18px]",
        tone === "accent"
          ? "bg-[#FFF0E6] text-[#D14E00]"
          : "bg-[#F1F1F3] text-[#6E6E73]",
        className,
      )}
    >
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
