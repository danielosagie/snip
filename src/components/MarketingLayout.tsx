import type { ReactNode } from "react";
import { MarketingNav } from "./MarketingNav";
import { MarketingFooter } from "./MarketingFooter";

const lightModeVars = {
  "--background": "#FFFFFF",
  "--background-alt": "#131315",
  "--surface": "#FFFFFF",
  "--surface-alt": "#FAFAFA",
  "--surface-strong": "#131315",
  "--surface-muted": "#F1F1F3",
  "--foreground": "#131315",
  "--foreground-muted": "#6E6E73",
  "--foreground-subtle": "#A0A0A5",
  "--foreground-inverse": "#FFFFFF",
  "--border": "#E8E8EC",
  "--border-subtle": "#F1F1F3",
  "--button-border": "#D8D8DE",
  "--accent": "#FF6600",
  "--accent-hover": "#D14E00",
  "--accent-light": "#FFF0E6",
  "--shadow-color": "#131315",
  "--shadow-accent": "#FF6600",
} as React.CSSProperties;

export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen font-['Inter_Tight',system-ui,sans-serif] selection:bg-[#FF6600] selection:text-white"
      style={{
        ...lightModeVars,
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <MarketingNav />
      <main className="pt-16">{children}</main>
      <MarketingFooter />
    </div>
  );
}
