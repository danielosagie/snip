import type { ReactNode } from "react";

/**
 * Wrapper for loading fallbacks that would otherwise flash on fast loads.
 * Children stay invisible for `delayMs`, then fade in — so when data arrives
 * quickly the viewer never sees a "Loading…" flicker at all.
 *
 * Uses the global `fade-in` keyframes from app.css with `both` fill mode,
 * which keeps opacity at 0 during the delay.
 */
export function DelayedAppear({
  children,
  delayMs = 150,
  className,
}: {
  children: ReactNode;
  delayMs?: number;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{ animation: `fade-in 0.25s ease-out ${delayMs}ms both` }}
    >
      {children}
    </div>
  );
}
