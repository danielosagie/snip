import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SnipMark } from "@/components/SnipMark";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    // `surface-client surface-soft` pins the light variable scope the Clerk
    // appearance reads from (see src/lib/clerk-appearance.ts). Without it the
    // card follows the app theme and renders dark inside this light frame.
    <div className="surface-client surface-soft relative flex min-h-screen items-center justify-center bg-[#FAFAFA] text-[#131315]">
      {/* Subtle grid pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: `
            linear-gradient(#E8E8EC 1px, transparent 1px),
            linear-gradient(90deg, #E8E8EC 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 w-full max-w-md px-4">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2.5">
            <span className="inline-flex overflow-hidden rounded-[9px]">
              <SnipMark size={32} />
            </span>
            <span className="text-3xl font-semibold tracking-[-0.03em] text-[#131315]">
              snip<span className="text-[#FF6600]">.</span>
            </span>
          </Link>
          <p className="sr-only">
            Video collaboration, simplified
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

export default AuthShell;
