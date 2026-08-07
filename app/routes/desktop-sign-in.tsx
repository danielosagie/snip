import { useSignIn } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { seoHead } from "@/lib/seo";

export const Route = createFileRoute("/desktop-sign-in")({
  head: () =>
    seoHead({
      title: "Desktop sign-in",
      description: "Finish signing in to snip desktop.",
      path: "/desktop-sign-in",
      noIndex: true,
    }),
  validateSearch: (search: Record<string, unknown>) => ({
    ticket:
      typeof search.__clerk_ticket === "string"
        ? search.__clerk_ticket
        : undefined,
  }),
  component: DesktopSignInRoute,
});

type Phase = "redeeming" | "error";

function DesktopSignInRoute() {
  const { ticket } = Route.useSearch();
  const { signIn, setActive, isLoaded } = useSignIn();
  const [phase, setPhase] = useState<Phase>("redeeming");
  const [message, setMessage] = useState("Finishing sign-in.");
  const firedRef = useRef(false);

  useEffect(() => {
    if (!ticket) {
      setPhase("error");
      setMessage("Sign-in ticket missing. Start again.");
      return;
    }
    if (!isLoaded || !signIn || !setActive || firedRef.current) return;

    firedRef.current = true;
    void signIn
      .create({ strategy: "ticket", ticket })
      .then(async (attempt) => {
        if (attempt.status !== "complete" || !attempt.createdSessionId) {
          throw new Error("Ticket sign-in did not create a session.");
        }
        await setActive({ session: attempt.createdSessionId });
        window.location.replace("/dashboard");
      })
      .catch((error: unknown) => {
        setPhase("error");
        setMessage(ticketErrorMessage(error));
      });
  }, [isLoaded, setActive, signIn, ticket]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FAFAFA] p-6 text-[#131315]">
      <section className="w-full max-w-md overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white">
        <header className="border-b border-[#E8E8EC] px-5 py-4 text-sm font-semibold tracking-[-0.01em]">
          snip<span className="text-[#FF6600]">.</span> desktop
        </header>
        <div className="p-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#FF6600]">
            {phase === "error" ? "Stopped" : "Signing in"}
          </p>
          <h1 className="mt-3 text-balance text-[22px] font-semibold leading-7 tracking-[-0.02em]">
            {phase === "error" ? "Could not sign in" : "Finishing sign-in"}
            <span className="text-[#FF6600]">.</span>
          </h1>
          <p className="mt-2 text-pretty text-sm leading-relaxed text-[#6E6E73]">
            {message}
          </p>

          {phase === "error" ? (
            <div className="mt-6 flex flex-wrap gap-2.5">
              <a
                href="/sign-in?desktop_pairing=1"
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#131315] px-5 text-[13px] font-medium text-white transition-[transform,background-color] duration-150 ease-out hover:bg-[#2A2A2E] active:scale-[0.96]"
              >
                Start again
              </a>
              <a
                href="/sign-in?desktop_email=1"
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 text-[13px] font-medium text-[#131315] shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_1px_2px_-1px_rgba(0,0,0,0.06)] transition-[transform,background-color] duration-150 ease-out hover:bg-[#F5F5F6] active:scale-[0.96]"
              >
                Use email
              </a>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function ticketErrorMessage(error: unknown): string {
  const codes =
    typeof error === "object" &&
    error !== null &&
    "errors" in error &&
    Array.isArray(error.errors)
      ? error.errors.flatMap((item) =>
          typeof item === "object" &&
          item !== null &&
          "code" in item &&
          typeof item.code === "string"
            ? [item.code]
            : [],
        )
      : [];

  if (codes.some((code) => code.includes("expired"))) {
    return "Sign-in expired. Start again.";
  }
  if (codes.some((code) => code.includes("used"))) {
    return "Sign-in already used. Start again.";
  }
  return "Sign-in could not finish. Start again.";
}
