import { createFileRoute } from "@tanstack/react-router";
import { useUser } from "@clerk/tanstack-react-start";
import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import { seoHead } from "@/lib/seo";

export const Route = createFileRoute("/connect-desktop")({
  head: () =>
    seoHead({
      title: "Connect desktop",
      description: "Connect the snip desktop app.",
      path: "/connect-desktop",
      noIndex: true,
    }),
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === "string" ? search.code : undefined,
  }),
  component: ConnectDesktopRoute,
});

type Phase = "idle" | "approving" | "connected" | "error";

function ConnectDesktopRoute() {
  const { code } = Route.useSearch();
  const { user, isLoaded } = useUser();
  const approve = useAction(api.desktopAuth.approvePairing);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!isLoaded || !user || !code || firedRef.current) return;
    firedRef.current = true;
    setPhase("approving");
    approve({ code })
      .then(() => setPhase("connected"))
      .catch((e: unknown) => {
        setPhase("error");
        setError(
          e instanceof Error ? e.message : "Could not connect this device.",
        );
      });
  }, [isLoaded, user, code, approve]);

  return (
    <main className="min-h-screen bg-[#f0f0e8] text-[#1a1a1a] flex items-center justify-center p-6">
      <div className="w-full max-w-md border-2 border-[#1a1a1a] bg-[#f0f0e8] shadow-[6px_6px_0px_0px_#1a1a1a]">
        <div className="bg-[#1a1a1a] text-[#f0f0e8] px-5 py-3 text-xs font-black uppercase tracking-[0.12em]">
          snip<span className="text-[#c2410c]">.</span> desktop
        </div>
        <div className="p-8">
          {!code ? (
            <Block
              title="Open this from the app"
              body="This page connects the snip desktop app to your account. Start the connection from the desktop app — it'll bring you back here automatically."
            />
          ) : !isLoaded ? (
            <Block title="Loading…" body="One moment." />
          ) : !user ? (
            <div>
              <Block
                title="Sign in to connect"
                body="Sign in to your snip account to authorize the desktop app on this machine."
              />
              <a
                href={`/sign-in?redirect_url=${encodeURIComponent(
                  `/connect-desktop?code=${encodeURIComponent(code)}`,
                )}`}
                className="mt-6 inline-flex items-center justify-center w-full px-4 py-2.5 border-2 border-[#1a1a1a] bg-[#c2410c] text-[#f0f0e8] font-bold uppercase text-sm tracking-wide shadow-[4px_4px_0px_0px_#1a1a1a] hover:bg-[#9a3412] transition-colors"
              >
                Sign in
              </a>
            </div>
          ) : phase === "approving" || phase === "idle" ? (
            <Block
              title="Connecting…"
              body="Authorizing this device. Keep this tab open for a moment."
            />
          ) : phase === "connected" ? (
            <div>
              <div className="inline-flex items-center justify-center w-12 h-12 border-2 border-[#1a1a1a] bg-[#c2410c] text-[#f0f0e8] mb-5">
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <h1 className="text-2xl font-black tracking-tight leading-tight">
                Device connected
                <span className="text-[#c2410c]">.</span>
              </h1>
              <p className="text-sm text-[#555] mt-2 leading-relaxed">
                Return to the snip desktop app — it's finishing setup and
                mounting your drive now. You can close this tab.
              </p>
            </div>
          ) : (
            <div>
              <Block
                title="Couldn't connect"
                body={error ?? "Something went wrong. Restart the connection from the desktop app."}
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h1 className="text-2xl font-black tracking-tight leading-tight">
        {title}
      </h1>
      <p className="text-sm text-[#555] mt-2 leading-relaxed">{body}</p>
    </div>
  );
}
