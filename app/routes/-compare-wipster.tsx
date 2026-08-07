import { Link } from "@tanstack/react-router";
import { MarketingLayout } from "@/components/MarketingLayout";

const WIPSTER_PRICE_PER_USER = 15;
const SNIP_PRICE_FLAT = 25;

const comparisonRows = [
  {
    feature: "Pricing",
    wipster: "Per-user/month",
    snip: "$25/month. Total.",
    note: "Your accountant will love you.",
  },
  {
    feature: "Open source",
    wipster: "No",
    snip: "Yes",
    note: "You can literally read our code.",
  },
  {
    feature: "Speed",
    wipster: "Solid, no complaints",
    snip: "Instant Mux playback",
    note: "We're unreasonably competitive about this.",
  },
  {
    feature: "Sharing",
    wipster: "Invite to workspace",
    snip: "Just a link",
    note: "Your clients don't want another login.",
  },
  {
    feature: "Simplicity",
    wipster: "Full-featured platform",
    snip: "Fewer features (on purpose)",
    note: "We call this a feature, not a bug.",
  },
  {
    feature: "Approvals",
    wipster: "Built-in workflows",
    snip: "Comments + thumbs up",
    note: "If that's not enough, we respect that.",
  },
];

const teamSizes = [3, 5, 10, 25];

function annualSavings(teamSize: number) {
  return (WIPSTER_PRICE_PER_USER * teamSize - SNIP_PRICE_FLAT) * 12;
}

const savingsCommentary: Record<number, string> = {
  3: "A very nice dinner for the team.",
  5: "That's a new camera lens.",
  10: "A weekend at a cabin to celebrate shipping.",
  25: "Genuinely, that's a lot of money.",
};

export default function CompareWipster() {
  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="border-b border-[#E8E8EC] bg-white px-6 pb-24 pt-20 md:pb-32 md:pt-28">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-[42px] font-semibold leading-[1.05] tracking-[-0.055em] text-[#131315] sm:text-[54px] md:text-[64px]">
            snip vs
            <br />
            Wipster
          </h1>
          <div className="mt-10 max-w-2xl md:mt-14">
            <p className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[#131315] md:text-[32px]">
              Two video review tools
              <br />
              walk into a bar.
              <br />
              <span className="text-[#6E6E73]">
                One costs less. That's the whole joke.
              </span>
            </p>
            <p className="mt-6 max-w-lg text-[16px] leading-6 text-[#6E6E73]">
              Wipster is a solid tool with real approval workflows and a proper
              feature set. snip is smaller, cheaper, and open source. We do less
              for less money, and that's the whole pitch.
            </p>
          </div>
        </div>
      </section>

      {/* Side-by-side comparison table */}
      <section className="border-b border-[#E8E8EC] bg-[#FAFAFA] px-6 py-24 md:py-32">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">
            Side by
            <br />
            side.
          </h2>

          <div className="overflow-x-auto rounded-[14px] border border-[#E8E8EC] bg-white">
            {/* Header row */}
            <div className="grid min-w-[680px] grid-cols-3 border-b border-[#F1F1F3] bg-[#FAFAFA]">
              <div className="p-4 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5] md:p-6">
                Feature
              </div>
              <div className="p-4 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5] md:p-6">
                Wipster
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
                  {row.wipster}
                </div>
                <div className="flex items-center gap-2 p-4 text-[14px] font-medium leading-5 text-[#131315] before:text-[#FF6600] before:content-['✓'] md:p-6">
                  {row.snip}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-6 text-center text-[13px] leading-5 text-[#6E6E73] md:hidden">
            * Wipster pricing based on their per-user model. Actual pricing may
            vary by plan.
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
            Wipster charges per user. snip starts at $25 per month total. Not per
            user. Flat pricing. The math gets increasingly silly as your team grows.
          </p>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {teamSizes.map((size) => {
              const savings = annualSavings(size);
              const wipsterAnnual = WIPSTER_PRICE_PER_USER * size * 12;
              const snipAnnual = SNIP_PRICE_FLAT * 12;

              return (
                <div
                  key={size}
                  className="flex flex-col overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white"
                >
                  <div className="border-b border-[#F1F1F3] bg-[#FAFAFA] p-5">
                    <span className="text-4xl font-semibold tracking-tight text-[#131315]">{size}</span>
                    <span className="ml-2 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                      people
                    </span>
                  </div>
                  <div className="flex flex-grow flex-col p-5">
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                        Wipster
                      </span>
                      <span className="font-medium tabular-nums text-[#6E6E73] line-through">
                        ${wipsterAnnual.toLocaleString()}/yr
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

          {/* Open source callout */}
          <div className="mt-16 rounded-[14px] border border-[#E8E8EC] bg-[#FAFAFA] p-8">
            <p className="mb-3 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
              Open source
            </p>
            <p className="mb-3 text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#131315] md:text-[24px]">
              You can literally read our code.
            </p>
            <p className="max-w-2xl text-[15px] leading-6 text-[#6E6E73]">
              snip is fully open source. Every line. The elegant parts and the
              parts where we left a TODO from three months ago. No black box. No
              trust required. Just code you can read, fork, and judge silently.
            </p>
            <a
              href="https://github.com/danielosagie/snip"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-block rounded-full border border-[#D8D8DE] bg-white px-4 py-2 text-[13px] font-medium leading-[18px] text-[#131315] transition-colors hover:bg-[#F1F1F3]"
            >
              View on GitHub
            </a>
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
            Wipster is genuinely good software built by people who care about
            video review. We just think there's room for something simpler. Here
            are the facts.
          </p>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {/* Use Wipster if... */}
            <div className="overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white">
              <div className="border-b border-[#F1F1F3] p-6">
                <h3 className="text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#131315]">
                  Use Wipster if...
                </h3>
              </div>
              <div className="p-6">
                <ul className="space-y-5">
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#A0A0A5]">
                      ×
                    </span>
                    <span className="font-medium">
                      You need built-in approval workflows with multiple review
                      stages, status tracking, and the whole production pipeline
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#A0A0A5]">
                      ×
                    </span>
                    <span className="font-medium">
                      You're an established media team that's already invested in
                      a full review ecosystem and switching costs are real
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#A0A0A5]">
                      ×
                    </span>
                    <span className="font-medium">
                      You want deep review stages with version comparisons,
                      granular permissions, and structured feedback rounds
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#A0A0A5]">
                      ×
                    </span>
                    <span className="font-medium">
                      Per-user pricing is fine because your budget is already
                      approved and nobody's counting
                    </span>
                  </li>
                </ul>
                <p className="mt-6 border-t border-[#F1F1F3] pt-4 text-[13px] leading-5 text-[#6E6E73]">
                  Seriously, Wipster is good. If this is you, go use it. We'll
                  be here if you change your mind later.
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
                      You're a small team or agency that just needs to share cuts
                      and collect feedback without a 45-minute onboarding
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#FF6600]">
                      ✓
                    </span>
                    <span className="font-medium">
                      You hate per-seat pricing with a passion that concerns your
                      friends and family
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#FF6600]">
                      ✓
                    </span>
                    <span className="font-medium">
                      You want clients to review with just a link, no account
                      creation, no "please check your email" nonsense
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#FF6600]">
                      ✓
                    </span>
                    <span className="font-medium">
                      You value open source and want to know exactly what
                      software you're trusting with your work
                    </span>
                  </li>
                </ul>
                <p className="mt-6 border-t border-[#26262A] pt-4 text-[13px] leading-5 text-[#A0A0A5]">
                  We do less than Wipster. Proudly. Upload, share, comment. Go
                  home. That's 90% of what anyone actually needs.
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
            $25/month. Unlimited seats. Open source. No per-user nonsense.
          </p>
          <Link
            to="/sign-up"
            className="rounded-full bg-white px-6 py-3 text-[14px] font-medium leading-5 text-[#131315] transition-opacity hover:opacity-90"
          >
            Start free
          </Link>
          <p className="mt-6 text-[13px] leading-5 text-[#A0A0A5]">
            No credit card required. No per-seat gotchas.
            <br />
            Just video review that doesn't require a spreadsheet to budget.
          </p>
        </div>
      </section>
    </MarketingLayout>
  );
}
