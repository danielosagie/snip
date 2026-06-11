/**
 * Shared Clerk appearance for the client-surface look (see `.surface-client`
 * in app.css). Colors flow through the same CSS variables the scope class
 * redefines, so this object only pins geometry and type: pill buttons,
 * rounded cards, sentence case. Used by both sign-in and sign-up.
 */
export const clientAuthAppearance = {
  elements: {
    formButtonPrimary:
      "!bg-none !bg-[var(--foreground)] hover:!opacity-90 !text-[var(--background)] !border-[var(--foreground)] rounded-full font-medium text-sm normal-case tracking-tight transition-opacity !shadow-none",
    card: "bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[0_1px_2px_rgba(19,19,21,0.04),0_12px_32px_-16px_rgba(19,19,21,0.12)]",
    headerTitle:
      "text-[var(--foreground)] font-semibold tracking-tight text-2xl normal-case",
    headerSubtitle: "text-[var(--foreground-muted)]",
    socialButtonsBlockButton:
      "border border-[var(--border)] bg-transparent hover:bg-[var(--surface-alt)] text-[var(--foreground)] rounded-full transition-colors shadow-none",
    socialButtonsBlockButtonText: "!text-current font-medium normal-case",
    socialButtonsBlockButtonArrow: "text-current",
    formFieldLabel: "text-[var(--foreground)] font-medium normal-case",
    formFieldInput:
      "bg-transparent border border-[var(--border)] text-[var(--foreground)] focus:border-[#FF6600] focus:ring-2 focus:ring-[#FF6600]/15 rounded-xl shadow-none",
    // OTP one-character cells: mono digits, soft corners, theme-following
    // color (the !important flags survive Clerk's own specificity).
    otpCodeFieldInput:
      "!text-[var(--foreground)] !bg-transparent !border !border-[var(--border)] focus:!border-[#FF6600] !rounded-xl font-mono",
    footerActionLink:
      "text-[#FF6600] hover:text-[var(--foreground)] font-medium",
    footerActionText: "text-[var(--foreground-muted)]",
    dividerLine: "bg-[var(--border)]",
    dividerText: "text-[var(--foreground-muted)]",
    identityPreviewText: "text-[var(--foreground)]",
    identityPreviewEditButton: "text-[#FF6600] hover:text-[var(--foreground)]",
    formFieldInputShowPasswordButton:
      "text-[var(--foreground-muted)] hover:text-[var(--foreground)]",
    footer: "hidden",
    internal: "text-[var(--foreground)]",
  },
  variables: {
    // Ink, not orange: Clerk layers a colorPrimary gradient over the primary
    // button that muddies any class-level background override. Orange stays
    // on links via the element classes above.
    colorPrimary: "#131315",
    colorBackground: "var(--surface)",
    colorInputBackground: "transparent",
    colorInputText: "var(--foreground)",
    colorText: "var(--foreground)",
    colorTextSecondary: "var(--foreground-muted)",
    colorTextOnPrimaryBackground: "#ffffff",
    colorNeutral: "var(--border)",
    borderRadius: "0.75rem",
  },
} as const;
