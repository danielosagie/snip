import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { ClerkProvider } from "@clerk/tanstack-react-start";
import type { ReactNode } from "react";

import { ConvexClientProvider } from "@/lib/convex";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { ToastProvider } from "@/components/ui/toast";
import { ThemeProvider } from "@/components/theme/ThemeToggle";
import { NotFound } from "@/components/ui/NotFound";
import appCss from "../app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "snip — video review for creative teams" },
      {
        name: "description",
        content:
          "Video review and collaboration for creative teams. Frame-accurate comments, unlimited seats, flat pricing from $25/month. The open source Frame.io alternative.",
      },
      { property: "og:site_name", content: "snip" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg?v=1" },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico?v=5" },
      { rel: "shortcut icon", href: "/favicon.ico?v=5" },
      { rel: "preconnect", href: "https://stream.mux.com", crossOrigin: "anonymous" },
      { rel: "preconnect", href: "https://image.mux.com", crossOrigin: "anonymous" },
      { rel: "dns-prefetch", href: "//stream.mux.com" },
      { rel: "dns-prefetch", href: "//image.mux.com" },
    ],
  }),
  component: RootComponent,
  errorComponent: ({ error }) => {
    return (
      <main className="pt-16 p-4 container mx-auto">
        <h1>Error</h1>
        <p>{error instanceof Error ? error.message : "An unexpected error occurred."}</p>
        {import.meta.env.DEV && error instanceof Error && error.stack ? (
          <pre className="w-full p-4 overflow-x-auto">
            <code>{error.stack}</code>
          </pre>
        ) : null}
      </main>
    );
  },
  notFoundComponent: () => <NotFound />,
});

function RootComponent() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  // Same lazy pattern as ConvexClientProvider: prerender workers build
  // marketing pages without the publishable key in env. Marketing routes
  // don't gate on auth, so rendering the document shell unwrapped is
  // fine. In the browser a missing key still indicates a misconfigured
  // deploy and should crash loudly.
  if (!publishableKey) {
    if (typeof window !== "undefined") {
      throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
    }
    return <RootDocument>{children}</RootDocument>;
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <RootDocument>{children}</RootDocument>
    </ClerkProvider>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  const themeInitScript = `
    (() => {
      try {
        // "classic" is retired; a stale stored value must not resurrect it.
        document.documentElement.setAttribute("data-style", "soft");
        if (localStorage.getItem("snip-style") === "classic") {
          localStorage.removeItem("snip-style");
        }
        const stored = localStorage.getItem("snip-theme") || localStorage.getItem("lawn-theme");
        if (stored === "light" || stored === "dark") {
          document.documentElement.setAttribute("data-theme", stored);
          return;
        }
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (prefersDark) {
          document.documentElement.setAttribute("data-theme", "dark");
        }
      } catch {}
    })();
  `;

  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        {/* Canonical-host enforcement is a server-side redirect in
            vercel.json (snipfilm.vercel.app -> www.snip.film). It must NOT
            be a client script: the desktop shell's will-navigate guard
            cancels JS navigation to a foreign origin, which blanked the
            whole app window. HTTP redirects during load bypass that guard. */}
        <HeadContent />
      </head>
      <body className="h-full antialiased" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <ConvexClientProvider>
          <ThemeProvider>
            <TooltipProvider>
              <ToastProvider>
                <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
              </ToastProvider>
            </TooltipProvider>
          </ThemeProvider>
        </ConvexClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
