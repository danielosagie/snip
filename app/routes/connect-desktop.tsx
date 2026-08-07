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
    <main className="flex min-h-screen items-center justify-center bg-[#FAFAFA] p-6 text-[#131315]">
      <div className="w-full max-w-md overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white">
        <div className="border-b border-[#E8E8EC] bg-white px-5 py-4 text-sm font-semibold tracking-[-0.01em] text-[#131315]">
          snip<span className="text-[#FF6600]">.</span> desktop
        </div>
        <div className="p-8">
          {!code ? (
            <Block
              title="Open this from the app"
              body="This page connects the snip desktop app to your account. Start the connection from the desktop app, and it'll bring you back here automatically."
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
                className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-[#131315] px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#26262A]"
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
              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#F2FBF5] text-[#225B36]">
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
              <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.02em]">
                Device connected
                <span className="text-[#FF6600]">.</span>
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[#6E6E73]">
                Return to the snip desktop app. It&apos;s finishing setup and
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
      <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.02em] text-[#131315]">
        {title}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[#6E6E73]">{body}</p>
    </div>
  );
}
