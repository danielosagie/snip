import { Link } from "@tanstack/react-router";
import { MarketingLayout } from "@/components/MarketingLayout";

const FRAMEIO_PRICE_PER_USER = 19;
const SNIP_PRICE_FLAT = 25;

const comparisonRows = [
  {
    feature: "Price",
    frameio: "$19/user/month",
    snip: "$25/month. Total.",
    note: "Math is hard, but not that hard.",
  },
  {
    feature: "Seats",
    frameio: "Limited by plan tier",
    snip: "Unlimited",
    note: "Your intern deserves access too.",
  },
  {
    feature: "Speed",
    frameio: "It's... fine",
    snip: "Actually fast",
    note: "We obsess over this so you don't wait.",
  },
  {
    feature: "Open source",
    frameio: "No",
    snip: "Yes",
    note: "Read our code. Judge us.",
  },
  {
    feature: "Sharing",
    frameio: "Account required",
    snip: "Just a link",
    note: "Your clients don't want another login.",
  },
  {
    feature: "Setup",
    frameio: "Call sales for enterprise",
    snip: "Sign up and upload",
    note: "Under 60 seconds or your money back.",
  },
];

const teamSizes = [3, 5, 10, 20];

function annualSavings(teamSize: number) {
  return (FRAMEIO_PRICE_PER_USER * teamSize - SNIP_PRICE_FLAT) * 12;
}

const savingsCommentary: Record<number, string> = {
  3: "That's a lot of burritos.",
  5: "A nice weekend trip for the team.",
  10: "A used car. A really used car.",
  20: "You could hire another freelancer with that.",
};

export default function CompareFrameio() {
  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="border-b border-[#E8E8EC] bg-white px-6 pb-24 pt-20 md:pb-32 md:pt-28">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-[42px] font-semibold leading-[1.05] tracking-[-0.055em] text-[#131315] sm:text-[54px] md:text-[64px]">
            snip vs
            <br />
            Frame.io
          </h1>
          <div className="mt-10 max-w-2xl md:mt-14">
            <p className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[#131315] md:text-[32px]">
              We're not better.
              <br />
              We're cheaper and faster.
              <br />
              <span className="text-[#6E6E73]">
                That might be better.
              </span>
            </p>
            <p className="mt-6 max-w-lg text-[16px] leading-6 text-[#6E6E73]">
              Frame.io is a great product built for enterprise teams with
              enterprise budgets. snip is a scrappy little tool that does the
              important stuff for $25/month flat. No per-seat math. No PhD in
              procurement required.
            </p>
          </div>
        </div>
      </section>

      {/* Side-by-side comparison table */}
      <section className="border-b border-[#E8E8EC] bg-[#FAFAFA] px-6 py-24 md:py-32">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">
            Feature
            <br />
            fight.
          </h2>

          <div className="overflow-x-auto rounded-[14px] border border-[#E8E8EC] bg-white">
            {/* Header row */}
            <div className="grid min-w-[680px] grid-cols-3 border-b border-[#F1F1F3] bg-[#FAFAFA]">
              <div className="p-4 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5] md:p-6">
                Feature
              </div>
              <div className="p-4 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5] md:p-6">
                Frame.io
              </div>
              <div className="p-4 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5] md:p-6">
                snip
              </div>
            </div>

            {/* Data rows */}
            {comparisonRows.map((row, i) => (
              <div
                key={row.feature}
                className={`grid min-w-[680px] grid-cols-3 ${i < comparisonRows.length - 1 ? "border-b border-[#F1F1F3]" : ""}`}
              >
                <div className="flex flex-col justify-center p-4 md:p-6">
                  <span className="text-[14px] font-semibold leading-5 text-[#131315]">
                    {row.feature}
                  </span>
                  <span className="mt-1 hidden text-[12px] leading-[18px] text-[#6E6E73] md:block">
                    {row.note}
                  </span>
                </div>
                <div className="flex items-center gap-2 p-4 text-[14px] leading-5 text-[#6E6E73] before:text-[#A0A0A5] before:content-['×'] md:p-6">
                  {row.frameio}
                </div>
                <div className="flex items-center gap-2 p-4 text-[14px] font-medium leading-5 text-[#131315] before:text-[#FF6600] before:content-['✓'] md:p-6">
                  {row.snip}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-6 text-center text-[13px] leading-5 text-[#6E6E73] md:hidden">
            * Frame.io pricing based on their Team plan at $19/user/month.
          </p>
        </div>
      </section>

      {/* Cost savings calculator */}
      <section className="border-b border-[#E8E8EC] bg-white px-6 py-24 md:py-32">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-center text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">
            Do the
            <br />
            math.
          </h2>
          <p className="mx-auto mb-16 max-w-lg text-center text-[15px] leading-6 text-[#6E6E73]">
            Frame.io charges $19 per user per month. snip starts at $25 per month.
            Not per user. Flat pricing. Here's what that means annually.
          </p>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {teamSizes.map((size) => {
              const savings = annualSavings(size);
              const frameioAnnual = FRAMEIO_PRICE_PER_USER * size * 12;
              const snipAnnual = SNIP_PRICE_FLAT * 12;

              return (
                <div
                  key={size}
                  className="flex flex-col overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white"
                >
                  <div className="border-b border-[#F1F1F3] bg-[#FAFAFA] p-5">
                    <span className="text-4xl font-semibold tracking-tight text-[#131315]">{size}</span>
                    <span className="ml-2 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                      {size === 1 ? "person" : "people"}
                    </span>
                  </div>
                  <div className="flex flex-grow flex-col p-5">
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                        Frame.io
                      </span>
                      <span className="font-medium tabular-nums text-[#6E6E73] line-through">
                        ${frameioAnnual.toLocaleString()}/yr
                      </span>
                    </div>
                    <div className="mb-4 flex items-baseline justify-between gap-3">
                      <span className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                        snip
                      </span>
                      <span className="font-semibold tabular-nums text-[#D14E00]">
                        ${snipAnnual}/yr
                      </span>
                    </div>
                    <div className="mt-auto border-t border-[#F1F1F3] pt-4">
                      <div className="text-3xl font-semibold tracking-tight tabular-nums text-[#D14E00]">
                        ${savings.toLocaleString()}
                      </div>
                      <div className="mt-1 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                        saved per year
                      </div>
                      <p className="mt-2 text-[13px] leading-5 text-[#6E6E73]">
                        {savingsCommentary[size]}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Honest "who should use what" */}
      <section className="border-b border-[#E8E8EC] bg-[#FAFAFA] px-6 py-24 md:py-32">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-center text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">
            Honest
            <br />
            advice.
          </h2>
          <p className="mx-auto mb-16 max-w-lg text-center text-[15px] leading-6 text-[#6E6E73]">
            We could trash-talk Frame.io but that would be dishonest and also
            they have way more employees than us. Here's the real deal.
          </p>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {/* Use Frame.io if... */}
            <div className="overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white">
              <div className="border-b border-[#F1F1F3] p-6">
                <h3 className="text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#131315]">
                  Use Frame.io if...
                </h3>
              </div>
              <div className="p-6">
                <ul className="space-y-5">
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#A0A0A5]">
                      ×
                    </span>
                    <span className="font-medium">
                      You need enterprise compliance docs (SOC 2, etc.) for your
                      procurement team to approve anything
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#A0A0A5]">
                      ×
                    </span>
                    <span className="font-medium">
                      You're deeply embedded in Adobe Premiere and After Effects
                      and need native panel integration
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#A0A0A5]">
                      ×
                    </span>
                    <span className="font-medium">
                      You have 100+ people with complex multi-stage approval
                      workflows and version trees
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#A0A0A5]">
                      ×
                    </span>
                    <span className="font-medium">
                      Budget isn't a concern and you want every feature
                      imaginable, even the ones you'll never use
                    </span>
                  </li>
                </ul>
                <p className="mt-6 border-t border-[#F1F1F3] pt-4 text-[13px] leading-5 text-[#6E6E73]">
                  Genuinely, Frame.io is solid software. If this is you, go use
                  it. We won't be offended. (Okay maybe a little.)
                </p>
              </div>
            </div>

            {/* Use snip if... */}
            <div className="overflow-hidden rounded-[14px] bg-[#0A0A0B] text-white">
              <div className="border-b border-[#26262A] p-6">
                <h3 className="text-[20px] font-semibold leading-7 tracking-[-0.5px] text-white">
                  Use snip if...
                </h3>
              </div>
              <div className="p-6">
                <ul className="space-y-5">
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#FF6600]">
                      ✓
                    </span>
                    <span className="font-medium">
                      You're a small-to-mid team that just needs to share cuts
                      and collect feedback without a NASA control panel
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#FF6600]">
                      ✓
                    </span>
                    <span className="font-medium">
                      You're an agency tired of doing per-seat multiplication
                      every time you onboard a client
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#FF6600]">
                      ✓
                    </span>
                    <span className="font-medium">
                      You're a freelancer who just needs to show a cut to a
                      client without making them create yet another account
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#FF6600]">
                      ✓
                    </span>
                    <span className="font-medium">
                      You value speed and simplicity over a feature checklist
                      that makes the marketing site look impressive
                    </span>
                  </li>
                </ul>
                <p className="mt-6 border-t border-[#26262A] pt-4 text-[13px] leading-5 text-[#A0A0A5]">
                  We do less than Frame.io. Proudly. Turns out "upload, share,
                  comment" is 90% of what anyone actually needs.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-[#0A0A0B] px-6 py-32 text-white">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <h2 className="mb-4 text-[36px] font-medium leading-[1.25] tracking-[-1.8px] text-white sm:text-[60px]">
            Start
            <br />
            now.
          </h2>
          <p className="mb-10 max-w-md text-[16px] leading-6 text-[#A0A0A5]">
            $25/month. Unlimited seats. No sales call required. No credit card to
            start.
          </p>
          <Link
            to="/sign-up"
            className="rounded-full bg-white px-6 py-3 text-[14px] font-medium leading-5 text-[#131315] transition-opacity hover:opacity-90"
          >
            Try snip free
          </Link>
          <p className="mt-6 text-[13px] leading-5 text-[#A0A0A5]">
            Or keep paying $19/user/month. We don't judge.
            <br />
            (We judge a little.)
          </p>
        </div>
      </section>
    </MarketingLayout>
  );
}
