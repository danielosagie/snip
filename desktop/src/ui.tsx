/**
 * snip desktop design system.
 *
 * Brutalist, typographic, minimal — the same language as the web app
 * (see the repo CLAUDE.md). Cream paper, near-black ink, burnt-orange as
 * a punctuation accent, hard 2px borders, square corners, 4px offset
 * shadows. This is the single source of truth for the desktop renderer;
 * views compose these primitives instead of hand-rolling inline styles.
 */

import type { CSSProperties, ReactNode } from "react";

export const C = {
  bg: "#f0f0e8",
  fg: "#1a1a1a",
  muted: "#888888",
  accent: "#c2410c",
  accentHover: "#9a3412",
  wash: "#ffedd5",
  washStrong: "#fdba74",
  border: "#1a1a1a",
  borderSubtle: "#cccccc",
  cell: "#e8e8e0",
  danger: "#dc2626",
  ok: "#2d5a2d",
} as const;

export const mono = '"SF Mono", Menlo, Consolas, monospace';

/** Wordmark — `snip` with the period in burnt orange. The one place the
 *  accent reads as identity rather than as a control. */
export function Wordmark({
  size = 16,
  sub,
}: {
  size?: number;
  sub?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        fontWeight: 900,
        letterSpacing: "-0.03em",
        fontSize: size,
        lineHeight: 1,
      }}
    >
      <span>
        snip<span style={{ color: C.accent }}>.</span>
      </span>
      {sub ? (
        <span
          style={{
            fontFamily: mono,
            fontWeight: 700,
            fontSize: Math.max(9, size * 0.42),
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: C.muted,
          }}
        >
          {sub}
        </span>
      ) : null}
    </div>
  );
}

/** Small monospace eyebrow label that sits above headings. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: mono,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: C.muted,
      }}
    >
      {children}
    </div>
  );
}

/** Bordered card. `dark` inverts it (ink fill, paper text) for the
 *  alternating-section rhythm the design language calls for. */
export function Card({
  children,
  dark,
  pad = 16,
  style,
}: {
  children: ReactNode;
  dark?: boolean;
  pad?: number;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        border: `2px solid ${C.border}`,
        background: dark ? C.fg : C.bg,
        color: dark ? C.bg : C.fg,
        padding: pad,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

/** Card with an inverted title strip across the top — the workhorse
 *  container for grouped settings / panels. */
export function PanelCard({
  title,
  right,
  children,
  style,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section style={{ border: `2px solid ${C.border}`, ...style }}>
      <header
        style={{
          background: C.fg,
          color: C.bg,
          padding: "7px 14px",
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span>{title}</span>
        {right ? <span style={{ fontFamily: mono, opacity: 0.7 }}>{right}</span> : null}
      </header>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}

/** Labelled form field — uppercase mono caption over the control. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label style={{ display: "block" }}>
      <div
        style={{
          fontFamily: mono,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: C.muted,
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      {children}
      {hint ? (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
          {hint}
        </div>
      ) : null}
    </label>
  );
}

type Tone = "neutral" | "ok" | "warn" | "danger" | "accent";

const TONE: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: C.cell, fg: C.fg, border: C.border },
  ok: { bg: "#dde6dd", fg: "#1f3d1f", border: C.ok },
  warn: { bg: "#f5e9d8", fg: "#7a4a12", border: "#b45309" },
  danger: { bg: "#fff", fg: "#7f1d1d", border: C.danger },
  accent: { bg: C.wash, fg: "#7a2a08", border: C.accent },
};

/** Status pill with a hard border — used for prereq / mount state. */
export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: `2px solid ${t.border}`,
        background: t.bg,
        color: t.fg,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 700,
        fontFamily: mono,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

/** Square status chip (the brutalist "dot"). */
export function Square({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        background: color,
        border: `2px solid ${C.border}`,
        flexShrink: 0,
      }}
    />
  );
}

export function Banner({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div
      style={{
        border: `2px solid ${t.border}`,
        background: t.bg,
        color: t.fg,
        padding: 12,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

/** Minimal functional glyphs as inline SVG — no icon dependency, no
 *  decorative art (design language: functional icons only). */
export function Glyph({
  name,
  size = 16,
}: {
  name: "check" | "arrow-right" | "arrow-left" | "x" | "external" | "folder" | "refresh";
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.25,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "check":
      return (
        <svg {...common}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg {...common}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case "arrow-left":
      return (
        <svg {...common}>
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      );
    case "external":
      return (
        <svg {...common}>
          <path d="M15 3h6v6M10 14 21 3M18 13v8H3V6h8" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 7h6l2 3h10v9H3z" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />
        </svg>
      );
  }
}
