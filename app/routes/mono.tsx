
import { useState, useEffect } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { SnipMark } from "@/components/SnipMark";

export const Route = createFileRoute("/mono")({
  component: HomepageMono,
});

export default function HomepageMono() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 200);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-white font-['Inter_Tight',system-ui,sans-serif] text-[#131315]">
      {/* Minimal nav */}
      <nav className="sticky top-0 z-50 flex items-center justify-between border-b border-[#E8E8EC] bg-white/95 px-6 py-4 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 transition-opacity duration-200 ${scrolled ? 'opacity-100' : 'opacity-0'}`}>
            <SnipMark size={22} />
            <span className="text-xl font-bold tracking-[-0.03em]">snip.</span>
          </div>
          <span className={`hidden border-l border-[#E8E8EC] pl-4 text-[13px] text-[#6E6E73] transition-opacity duration-200 sm:inline ${scrolled ? 'opacity-100' : 'opacity-0'}`}>Video review</span>
        </div>
        <div className="flex items-center gap-3 text-[14px] font-medium">
          <Link to="/sign-in" className="text-[#6E6E73] transition-colors hover:text-[#131315]">Sign in</Link>
          <Link to="/sign-up" className="rounded-full bg-[#131315] px-4 py-2 text-white transition-opacity hover:opacity-90">Start</Link>
        </div>
      </nav>

      {/* Hero - Massive brand + clear statement */}
      <section className="px-6 pb-20 pt-12">
        <div className="mx-auto max-w-6xl">
          {/* Giant snip */}
          <h1 className="text-[20vw] font-semibold leading-[0.85] tracking-[-0.065em] text-[#131315] sm:text-[18vw]">
            snip.
          </h1>

          {/* What it is - immediately clear */}
          <div className="max-w-2xl mt-8">
            <p className="text-[24px] font-semibold leading-tight tracking-[-0.02em] sm:text-[32px]">
              Video review for creative teams.
              <br />
              <span className="text-[#6E6E73]">Fewer features. More speed.</span>
            </p>
          </div>

          {/* Key differentiator */}
          <div className="mt-12 flex flex-wrap items-center gap-3">
            <div className="rounded-[14px] border border-[#E8E8EC] bg-[#FAFAFA] px-6 py-3">
              <span className="text-[20px] font-semibold text-[#131315]">$25/mo</span>
              <span className="ml-2 text-[13px] text-[#6E6E73]">unlimited seats</span>
            </div>
            <Link to="/sign-up"
              className="rounded-full bg-[#131315] px-6 py-3 text-[14px] font-medium leading-5 text-white transition-opacity hover:opacity-90"
            >
              Get started
            </Link>
          </div>
        </div>
      </section>

      {/* Simple value props */}
      <section className="border-y border-[#E8E8EC] bg-[#FAFAFA]">
        <div className="max-w-6xl mx-auto grid grid-cols-2 lg:grid-cols-4">
          {[
            { title: "Frame-accurate", desc: "Comments on exact frames" },
            { title: "Unlimited seats", desc: "One price for everyone" },
            { title: "0.3s response", desc: "Built for speed" },
            { title: "Any NLE", desc: "No lock-in" },
          ].map((item, i) => (
            <div key={i} className={`p-6 ${i < 3 ? 'border-r border-[#E8E8EC]' : ''} ${i < 2 ? 'lg:border-r' : 'lg:border-r-0'}`}>
              <div className="text-[15px] font-semibold leading-[22px] text-[#131315]">{item.title}</div>
              <div className="mt-1 text-[13px] leading-[18px] text-[#6E6E73]">{item.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison - straightforward */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-2 text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">How snip compares</h2>
          <p className="mb-10 text-[15px] leading-6 text-[#6E6E73]">Frame.io is solid software. Here's where we differ.</p>

          <div className="space-y-6">
            {/* Pricing comparison - the big one */}
            <div className="rounded-[14px] bg-[#0A0A0B] p-8 text-white">
              <div className="mb-4 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">Pricing model</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                <div>
                  <div className="mb-1 text-[13px] text-[#A0A0A5]">Frame.io</div>
                  <div className="text-2xl font-semibold tabular-nums">$19/editor/mo</div>
                  <div className="mt-2 text-[13px] text-[#A0A0A5]">Team of 5 = $1,140/year</div>
                </div>
                <div>
                  <div className="mb-1 text-[13px] text-[#FF6600]">snip</div>
                  <div className="text-2xl font-semibold tabular-nums text-white">$25/mo total</div>
                  <div className="mt-2 text-[13px] text-[#A0A0A5]">Team of 5 = $300/year</div>
                </div>
              </div>
              <div className="mt-6 border-t border-[#26262A] pt-6">
                <span className="text-[13px] text-[#A0A0A5]">Annual savings with 5 users: </span>
                <span className="text-xl font-semibold tabular-nums text-[#FF6600]">$840</span>
              </div>
            </div>

            {/* Other differences */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-[14px] border border-[#E8E8EC] bg-white p-6">
                <div className="mb-2 text-[16px] font-semibold leading-[22px] text-[#131315]">Frame.io</div>
                <ul className="space-y-1 text-[14px] leading-5 text-[#6E6E73]">
                  <li>• Deep Adobe integration</li>
                  <li>• More enterprise features</li>
                  <li>• Larger ecosystem</li>
                </ul>
              </div>
              <div className="rounded-[14px] border border-[#E8E8EC] bg-[#FAFAFA] p-6">
                <div className="mb-2 text-[16px] font-semibold leading-[22px] text-[#D14E00]">snip</div>
                <ul className="space-y-1 text-[14px] leading-5 text-[#131315]">
                  <li>• Works with any software</li>
                  <li>• Simpler, faster interface</li>
                  <li>• No per-seat pricing</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works - visual */}
      <section className="bg-[#0A0A0B] px-6 py-24 text-white">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-12 text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-white sm:text-[44px]">How it works</h2>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">
            {[
              { step: "1", action: "Upload", desc: "your video" },
              { step: "2", action: "Share", desc: "the link" },
              { step: "3", action: "Click", desc: "to comment" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-[9px] bg-[#FF6600] text-[20px] font-semibold text-white">
                  {item.step}
                </span>
                <div>
                  <div className="text-[16px] font-semibold leading-[22px] text-white">{item.action}</div>
                  <div className="mt-1 text-[13px] leading-[18px] text-[#A0A0A5]">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Quote */}
      <section className="border-b border-[#E8E8EC] bg-[#FAFAFA] px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <blockquote className="text-[24px] font-medium leading-tight tracking-[-0.02em] text-[#131315] sm:text-[32px]">
            "I built snip because I got tired of waiting for Frame.io to load.
            Video review should be instant."
          </blockquote>
          <p className="mt-4 text-[14px] text-[#6E6E73]">Casey Lund</p>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-[36px] font-medium leading-[1.25] tracking-[-1.8px] text-[#131315] sm:text-[60px]">
            Pick your plan
          </h2>
          <p className="mb-8 mt-4 text-[16px] leading-6 text-[#6E6E73]">
            Basic is $25/month. Pro is $50/month.
          </p>
          <Link to="/sign-up"
            className="inline-block rounded-full bg-[#131315] px-6 py-3 text-[14px] font-medium leading-5 text-white transition-opacity hover:opacity-90"
          >
            Start with Basic
          </Link>
          <p className="mt-4 text-[13px] leading-5 text-[#6E6E73]">Upgrade to Pro anytime</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#E8E8EC] bg-white px-6 py-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <SnipMark size={20} />
            <span className="text-xl font-bold tracking-[-0.03em]">snip.</span>
          </div>
          <div className="flex gap-6 text-[#6E6E73]">
            <a href="/github" className="transition-colors hover:text-[#131315]">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
