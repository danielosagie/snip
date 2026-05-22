"use client";

import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/tanstack-react-start";
import { ReactNode } from "react";

const convexUrl = import.meta.env.VITE_CONVEX_URL;

// Lazy: don't crash at module-load if the URL isn't baked in. Vercel
// preview builds without a Convex deploy key go through prerender for the
// static marketing pages (/, /compare/*, /pricing, /for/*) and never need
// a Convex client. Throwing here would crash that step and block the
// whole deploy from going Ready. In the browser, however, a missing URL
// always indicates a real misconfiguration — surface it loudly there.
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convex) {
    if (typeof window !== "undefined") {
      throw new Error("Missing VITE_CONVEX_URL");
    }
    return <>{children}</>;
  }
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}

export { convex };
