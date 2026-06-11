import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SnipMark } from "@/components/SnipMark";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="surface-client min-h-screen flex items-center justify-center bg-[#f0f0e8] relative">
      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(#1a1a1a 1px, transparent 1px),
            linear-gradient(90deg, #1a1a1a 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 w-full max-w-md px-4">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2.5">
            <span className="rounded-lg overflow-hidden inline-flex">
              <SnipMark size={32} />
            </span>
            <span className="text-3xl font-semibold tracking-tight text-[#1a1a1a]">
              snip<span className="text-[#FF6600]">.</span>
            </span>
          </Link>
          <p className="mt-3 text-sm text-[#888]">
            Video collaboration, simplified
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

export default AuthShell;
