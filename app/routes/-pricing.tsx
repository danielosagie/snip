import { Link, useSearch } from "@tanstack/react-router";
import { MarketingLayout } from "@/components/MarketingLayout";

export default function PricingPage() {
  // Hide the enterprise PAYG strip from the default marketing page.
  // it's still wired up in code (billing dashboard, daily Stripe meter
  // cron), but most visitors should see the three flat tiers and
  // nothing else. `?show=enterprise` reveals it for sales conversations.
  const search = useSearch({ strict: false }) as { show?: string };
  const showEnterprise = search.show === "enterprise";

  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="border-b border-[#E8E8EC] bg-white px-6 pb-16 pt-24 md:pb-24 md:pt-32">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-[38px] font-semibold leading-[1.15] tracking-[-0.055em] text-[#131315] sm:text-[51px] sm:leading-[60px]">
            Simple pricing.
          </h1>
          <p className="mt-6 max-w-2xl text-[19px] leading-[29px] text-[#6E6E73]">
            Start free. Upgrade when you need more space.{" "}
            Never per user.
          </p>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="border-b border-[#E8E8EC] bg-[#FAFAFA] px-6 py-24 md:py-32">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-3">
            {/* Free */}
            <div className="flex h-full flex-col rounded-[14px] border border-[#E8E8EC] bg-white p-8">
              <div className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                Free
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-[48px] font-semibold leading-none tracking-[-1.2px] text-[#131315]">$0</span>
                <span className="text-[18px] leading-7 text-[#A0A0A5]">/mo</span>
              </div>
              <p className="mt-3 text-[15px] leading-[22px] text-[#6E6E73]">
                Kick the tires. Real review, real exports, capped storage.
              </p>

              <ul className="mt-7 flex-grow space-y-3 text-[15px] leading-[22px] text-[#131315]">
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600]">&#10003;</span>{" "}
                  Owner + 1 collaborator
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600]">&#10003;</span>{" "}
                  Unlimited projects
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600]">&#10003;</span>{" "}
                  Unlimited clients
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600]">&#10003;</span>{" "}
                  25 GB storage
                </li>
              </ul>

              <Link
                to="/sign-up"
                className="mt-8 flex w-full items-center justify-center rounded-full bg-[#131315] px-5 py-3 text-[14px] font-medium leading-5 text-white transition-opacity hover:opacity-90"
              >
                Start free
              </Link>
            </div>

            {/* Basic */}
            <div className="flex h-full flex-col rounded-[14px] border border-[#E8E8EC] bg-white p-8">
              <div className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                Basic
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-[48px] font-semibold leading-none tracking-[-1.2px] text-[#131315]">$25</span>
                <span className="text-[18px] leading-7 text-[#A0A0A5]">/mo</span>
              </div>
              <p className="mt-3 text-[15px] leading-[22px] text-[#6E6E73]">
                Unlimited everything, except storage.
              </p>

              <ul className="mt-7 flex-grow space-y-3 text-[15px] leading-[22px] text-[#131315]">
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600]">&#10003;</span>{" "}
                  Unlimited seats
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600]">&#10003;</span>{" "}
                  Unlimited projects
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600]">&#10003;</span>{" "}
                  Unlimited clients
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600]">&#10003;</span>{" "}
                  500 GB storage
                </li>
              </ul>

              <Link
                to="/sign-up"
                className="mt-8 flex w-full items-center justify-center rounded-full bg-[#131315] px-5 py-3 text-[14px] font-medium leading-5 text-white transition-opacity hover:opacity-90"
              >
                Get Basic
              </Link>
            </div>

            {/* Pro */}
            <div className="flex h-full flex-col rounded-[14px] bg-[#0A0A0B] p-8 text-white">
              <div className="flex items-center justify-between">
                <div className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                  Pro
                </div>
                <div className="rounded-full bg-[#FF6600] px-2.5 py-1 font-['Geist_Mono',system-ui,monospace] text-[10px] font-medium uppercase leading-[15px] tracking-[0.5px] text-white">
                  PRO
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-[48px] font-semibold leading-none tracking-[-1.2px] text-white">$50</span>
                <span className="text-[18px] leading-7 text-white/45">/mo</span>
              </div>
              <p className="mt-3 text-[15px] leading-[22px] text-white/70">
                Literally the same thing, but more space.
              </p>

              <ul className="mt-7 flex-grow space-y-3 text-[15px] leading-[22px] text-white/85">
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600]">&#10003;</span>{" "}
                  Unlimited seats
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600]">&#10003;</span>{" "}
                  Unlimited projects
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600]">&#10003;</span>{" "}
                  Unlimited clients
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600]">&#10003;</span> 2 TB storage
                </li>
              </ul>

              <Link
                to="/sign-up"
                className="mt-8 flex w-full items-center justify-center rounded-full bg-white px-5 py-3 text-[14px] font-medium leading-5 text-[#131315] transition-opacity hover:opacity-90"
              >
                Get Pro
              </Link>
            </div>
          </div>

          {/* Enterprise PAYG is hidden by default. Visible via ?show=enterprise
              for sales conversations and direct outreach. */}
          {showEnterprise ? (
            <div className="mt-16 rounded-[14px] border border-[#E8E8EC] bg-white p-8 md:p-12">
              <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:gap-12">
                <div className="flex-1">
                  <div className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                    Enterprise
                  </div>
                  <div className="mt-3 text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">
                    Pay-as-you-go
                  </div>
                  <p className="mt-4 max-w-2xl text-[15px] leading-6 text-[#6E6E73]">
                    Zero base. Pay only for what you actually store, ship, and
                    transcribe. Built for teams whose footage volume swings wildly
                    month to month.
                  </p>
                </div>
                <a
                  href="mailto:hi@snip.app?subject=Enterprise%20pricing"
                  className="inline-block whitespace-nowrap rounded-full bg-[#131315] px-6 py-3 text-center text-[14px] font-medium text-white transition-opacity hover:opacity-90"
                >
                  Talk to sales
                </a>
              </div>

              <div className="grid grid-cols-1 gap-4 border-t border-[#F1F1F3] pt-8 md:grid-cols-4">
                <div className="rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-5">
                  <div className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                    Storage
                  </div>
                  <div className="mt-2 text-3xl font-semibold tracking-tight text-[#131315]">
                    $0.05<span className="text-base font-normal text-[#6E6E73]"> / GB-mo</span>
                  </div>
                </div>
                <div className="rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-5">
                  <div className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                    Egress
                  </div>
                  <div className="mt-2 text-3xl font-semibold tracking-tight text-[#131315]">
                    $0.10<span className="text-base font-normal text-[#6E6E73]"> / GB</span>
                  </div>
                </div>
                <div className="rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-5">
                  <div className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                    Seats
                  </div>
                  <div className="mt-2 text-3xl font-semibold tracking-tight text-[#131315]">
                    $5<span className="text-base font-normal text-[#6E6E73]"> / seat / mo</span>
                  </div>
                </div>
                <div className="rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-5">
                  <div className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                    Transcription
                  </div>
                  <div className="mt-2 text-3xl font-semibold tracking-tight text-[#131315]">
                    $1<span className="text-base font-normal text-[#6E6E73]"> / 1k min</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* FAQ */}
      <section className="border-b border-[#E8E8EC] bg-white px-6 py-24 md:py-32">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-12 text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">
            Questions
          </h2>

          <div className="divide-y divide-[#F1F1F3] border-y border-[#E8E8EC]">
            {[
              {
                q: "Do you charge per collaborator?",
                a: "No. Basic and Pro include unlimited collaborators. Free includes the owner and one collaborator.",
              },
              {
                q: "Can clients review without an account?",
                a: "Yes. Send a share link. They click, watch, and comment. No sign-up required.",
              },
              {
                q: "What happens if I hit the storage limit?",
                a: "Upgrade to Basic ($25/mo, 500 GB) or Pro ($50/mo, 2 TB), or delete old projects to free up room.",
              },
              {
                q: "Is there a free trial?",
                a: "Yes. Sign up and try it. No credit card required to start.",
              },
              {
                q: "Is snip really open source?",
                a: "Fully. Check our GitHub. Read the code, fork it, whatever you want.",
              },
            ].map((item, i) => (
              <div key={i} className="py-8">
                <h3 className="mb-2 text-[16px] font-semibold leading-[22px] text-[#131315]">
                  {item.q}
                </h3>
                <p className="text-[14px] leading-5 text-[#6E6E73]">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-[#0A0A0B] px-6 py-32 text-white">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <h2 className="mb-4 text-[36px] font-medium leading-[1.25] tracking-[-1.8px] text-white sm:text-[60px]">
            Still reading?
          </h2>
          <p className="mb-10 text-[16px] leading-6 text-[#A0A0A5]">
            Just try it. No credit card. No commitment.
          </p>
          <Link
            to="/sign-up"
            className="rounded-full bg-white px-6 py-3 text-[14px] font-medium leading-5 text-[#131315] transition-opacity hover:opacity-90"
          >
            Start free
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
