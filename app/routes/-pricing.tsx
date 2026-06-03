import { Link, useSearch } from "@tanstack/react-router";
import { MarketingLayout } from "@/components/MarketingLayout";

export default function PricingPage() {
  // Hide the enterprise PAYG strip from the default marketing page —
  // it's still wired up in code (billing dashboard, daily Stripe meter
  // cron), but most visitors should see the three flat tiers and
  // nothing else. `?show=enterprise` reveals it for sales conversations.
  const search = useSearch({ strict: false }) as { show?: string };
  const showEnterprise = search.show === "enterprise";

  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="px-6 pt-24 pb-16 md:pt-32 md:pb-24 bg-[#f0f0e8] border-b-2 border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-7xl md:text-9xl font-black uppercase tracking-tighter leading-[0.85]">
            PRICING.
          </h1>
          <p className="text-2xl md:text-3xl font-bold mt-8 max-w-2xl">
            Start free. Upgrade when you need more space.{" "}
            <span className="text-[#888]">Never per user.</span>
          </p>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="px-6 py-24 md:py-32 bg-[#e8e8e0] border-b-2 border-[#1a1a1a]">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
            {/* Free */}
            <div className="bg-[#f0f0e8] border-2 border-[#1a1a1a] shadow-[8px_8px_0px_0px_#1a1a1a] p-8 flex flex-col hover:-translate-y-2 hover:translate-x-2 hover:shadow-[4px_4px_0px_0px_#1a1a1a] transition-all">
              <div className="text-xl font-bold uppercase tracking-widest text-[#888] mb-2">
                Free
              </div>
              <div className="text-6xl font-black tracking-tighter mb-4">
                $0<span className="text-2xl text-[#888]">/mo</span>
              </div>
              <p className="text-lg font-medium text-[#1a1a1a] mb-8">
                Kick the tires. Real review, real exports, capped storage.
              </p>

              <ul className="space-y-4 text-lg font-bold flex-grow mb-8">
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600] text-2xl">&#10003;</span>{" "}
                  Unlimited seats
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600] text-2xl">&#10003;</span>{" "}
                  Unlimited projects
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600] text-2xl">&#10003;</span>{" "}
                  Unlimited clients
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600] text-2xl">&#10003;</span>{" "}
                  50 GB Storage
                </li>
              </ul>

              <Link
                to="/sign-up"
                className="bg-[#1a1a1a] text-[#f0f0e8] text-center py-4 border-2 border-[#1a1a1a] font-black uppercase hover:bg-[#FF6600] transition-colors"
              >
                Start Free
              </Link>
            </div>

            {/* Basic */}
            <div className="bg-[#f0f0e8] border-2 border-[#1a1a1a] shadow-[8px_8px_0px_0px_#1a1a1a] p-8 flex flex-col hover:-translate-y-2 hover:translate-x-2 hover:shadow-[4px_4px_0px_0px_#1a1a1a] transition-all">
              <div className="text-xl font-bold uppercase tracking-widest text-[#888] mb-2">
                Basic
              </div>
              <div className="text-6xl font-black tracking-tighter mb-4">
                $20<span className="text-2xl text-[#888]">/mo</span>
              </div>
              <p className="text-lg font-medium text-[#1a1a1a] mb-8">
                Real projects, real footage, no babysitting.
              </p>

              <ul className="space-y-4 text-lg font-bold flex-grow mb-8">
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600] text-2xl">&#10003;</span>{" "}
                  Unlimited seats
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600] text-2xl">&#10003;</span>{" "}
                  Unlimited projects
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600] text-2xl">&#10003;</span>{" "}
                  Unlimited clients
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FF6600] text-2xl">&#10003;</span>{" "}
                  2 TB Storage
                </li>
              </ul>

              <Link
                to="/sign-up"
                className="bg-[#1a1a1a] text-[#f0f0e8] text-center py-4 border-2 border-[#1a1a1a] font-black uppercase hover:bg-[#FF6600] transition-colors"
              >
                Get Basic
              </Link>
            </div>

            {/* Pro */}
            <div className="bg-[#1a1a1a] text-[#f0f0e8] border-2 border-[#1a1a1a] shadow-[8px_8px_0px_0px_#1a1a1a] p-8 flex flex-col transform md:-translate-y-4 hover:-translate-y-6 hover:translate-x-2 hover:shadow-[4px_4px_0px_0px_#1a1a1a] transition-all">
              <div className="flex justify-between items-start mb-2">
                <div className="text-xl font-bold uppercase tracking-widest text-[#FFB380]">
                  Pro
                </div>
                <div className="bg-[#FF6600] text-xs font-black px-2 py-1 uppercase tracking-wider -rotate-3">
                  Big files
                </div>
              </div>
              <div className="text-6xl font-black tracking-tighter mb-4">
                $50<span className="text-2xl text-[#888]">/mo</span>
              </div>
              <p className="text-lg font-medium mb-8">
                Literally the exact same thing but more space.
              </p>

              <ul className="space-y-4 text-lg font-bold flex-grow mb-8">
                <li className="flex items-center gap-3">
                  <span className="text-[#FFB380] text-2xl">&#10003;</span>{" "}
                  Unlimited seats
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FFB380] text-2xl">&#10003;</span>{" "}
                  Unlimited projects
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FFB380] text-2xl">&#10003;</span>{" "}
                  Unlimited clients
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-[#FFB380] text-2xl">&#10003;</span> 5 TB
                  Storage
                </li>
              </ul>

              <Link
                to="/sign-up"
                className="bg-[#f0f0e8] text-[#1a1a1a] text-center py-4 border-2 border-[#f0f0e8] font-black uppercase hover:bg-[#d8d8d0] transition-colors"
              >
                Get Pro
              </Link>
            </div>
          </div>

          {/* Enterprise PAYG — hidden by default. Visible via ?show=enterprise
              for sales conversations and direct outreach. */}
          {showEnterprise ? (
            <div className="mt-16 bg-[#f0f0e8] border-2 border-[#1a1a1a] shadow-[8px_8px_0px_0px_#1a1a1a] p-8 md:p-12">
              <div className="flex flex-col md:flex-row md:items-end gap-6 md:gap-12 mb-10">
                <div className="flex-1">
                  <div className="text-xl font-bold uppercase tracking-widest text-[#888] mb-2">
                    Enterprise
                  </div>
                  <div className="text-6xl md:text-7xl font-black tracking-tighter">
                    Pay-as-you-go
                  </div>
                  <p className="text-lg md:text-xl font-medium text-[#1a1a1a] mt-4 max-w-2xl">
                    Zero base. Pay only for what you actually store, ship, and
                    transcribe. Built for teams whose footage volume swings wildly
                    month to month.
                  </p>
                </div>
                <a
                  href="mailto:hi@snip.app?subject=Enterprise%20pricing"
                  className="inline-block bg-[#1a1a1a] text-[#f0f0e8] text-center px-8 py-4 border-2 border-[#1a1a1a] font-black uppercase hover:bg-[#C2410C] transition-colors whitespace-nowrap"
                >
                  Talk to sales
                </a>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 border-t-2 border-[#1a1a1a] pt-8">
                <div className="border-2 border-[#1a1a1a] p-5 bg-[#FFEDD5]">
                  <div className="text-xs font-bold uppercase tracking-widest text-[#888]">
                    Storage
                  </div>
                  <div className="text-3xl font-black tracking-tighter mt-2">
                    $0.05<span className="text-base text-[#888]"> / GB-mo</span>
                  </div>
                </div>
                <div className="border-2 border-[#1a1a1a] p-5 bg-[#FFEDD5]">
                  <div className="text-xs font-bold uppercase tracking-widest text-[#888]">
                    Egress
                  </div>
                  <div className="text-3xl font-black tracking-tighter mt-2">
                    $0.10<span className="text-base text-[#888]"> / GB</span>
                  </div>
                </div>
                <div className="border-2 border-[#1a1a1a] p-5 bg-[#FFEDD5]">
                  <div className="text-xs font-bold uppercase tracking-widest text-[#888]">
                    Seats
                  </div>
                  <div className="text-3xl font-black tracking-tighter mt-2">
                    $5<span className="text-base text-[#888]"> / seat / mo</span>
                  </div>
                </div>
                <div className="border-2 border-[#1a1a1a] p-5 bg-[#FFEDD5]">
                  <div className="text-xs font-bold uppercase tracking-widest text-[#888]">
                    Transcription
                  </div>
                  <div className="text-3xl font-black tracking-tighter mt-2">
                    $1<span className="text-base text-[#888]"> / 1k min</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 py-24 md:py-32 bg-[#f0f0e8] border-b-2 border-[#1a1a1a]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-5xl md:text-7xl font-black uppercase tracking-tighter leading-none mb-16">
            FAQ.
          </h2>

          <div className="divide-y-2 divide-[#1a1a1a] border-y-2 border-[#1a1a1a]">
            {[
              {
                q: "What counts as a seat?",
                a: "Anyone on your team. Invite everyone — editors, producers, clients. No extra charge.",
              },
              {
                q: "Can clients review without an account?",
                a: "Yes. Send a share link. They click, watch, and comment. No sign-up required.",
              },
              {
                q: "What happens if I hit the storage limit?",
                a: "Upgrade to Basic ($20/mo, 2 TB) or Pro ($50/mo, 5 TB) for more space, or delete old projects to free up room.",
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
                <h3 className="text-xl md:text-2xl font-black uppercase tracking-tight mb-3">
                  {item.q}
                </h3>
                <p className="text-lg font-medium text-[#888]">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-32 bg-[#1a1a1a] text-[#f0f0e8]">
        <div className="max-w-4xl mx-auto text-center flex flex-col items-center">
          <h2 className="text-5xl md:text-7xl font-black uppercase tracking-tighter leading-none mb-4">
            Still reading?
          </h2>
          <p className="text-xl text-[#888] font-medium mb-12">
            Just try it. No credit card. No commitment.
          </p>
          <Link
            to="/sign-up"
            className="bg-[#f0f0e8] text-[#1a1a1a] px-12 py-6 border-2 border-[#f0f0e8] text-2xl font-black uppercase tracking-wider hover:bg-[#FF6600] hover:text-[#f0f0e8] hover:border-[#FF6600] transition-colors shadow-[8px_8px_0px_0px_var(--shadow-accent)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[4px_4px_0px_0px_var(--shadow-accent)]"
          >
            START FREE TRIAL
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
