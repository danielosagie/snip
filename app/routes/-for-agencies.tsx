import { Link } from "@tanstack/react-router";
import { MarketingLayout } from "@/components/MarketingLayout";

const painPoints = [
  {
    id: "01",
    title: "Adding a freelancer shouldn't cost $19/mo",
    description:
      'You hired them for a two-week project. Why are you paying a monthly seat fee? snip starts at $25/month total. Unlimited seats. Add your whole roster, full-timers, freelancers, and that one intern who\'s "really good at Premiere."',
  },
  {
    id: "02",
    title: "Clients need no-account review",
    description:
      "Your client doesn't want to create an account. They want to watch the video, leave a comment at 0:47 that says \"make it pop more,\" and move on with their day. Send a link. That's it.",
  },
  {
    id: "03",
    title: "Managing 12 clients shouldn't require a PM tool",
    description:
      "Unlimited projects, organized by team. No per-project limits, no storage gotchas. Every client gets their own space. You get your sanity back.",
  },
  {
    id: "04",
    title: "Fast turnaround means fast tools",
    description:
      "Client says \"I need to see it by 3pm.\" It's 2:47pm. You upload the cut, it plays instantly. No transcoding queue. No \"processing your video\" spinner. Just playback.",
  },
];

const comparisons = [
  {
    size: "5-person team",
    competitor: "$95",
    snip: "$25",
    saved: "$840",
    commentary: "That's a lot of coffee.",
  },
  {
    size: "10-person team",
    competitor: "$190",
    snip: "$25",
    saved: "$1,980",
    commentary: "A nice camera lens, actually.",
  },
  {
    size: "15 + freelancers",
    competitor: "$285+",
    snip: "$25",
    saved: "$3,120+",
    commentary: "Almost enough for one more freelancer.",
  },
];

export default function ForAgencies() {
  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="border-b border-[#E8E8EC] bg-white px-6 py-24 md:py-32">
        <div className="mx-auto max-w-7xl">
          <div className="mb-6">
            <span className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
              For agencies
            </span>
          </div>
          <h1 className="max-w-4xl text-[42px] font-semibold leading-[1.05] tracking-[-0.055em] text-[#131315] sm:text-[54px] md:text-[64px]">
            Stop paying
            <br />
            per seat.
            <br />
            <span className="text-[#D14E00]">Start shipping</span>
            <br />
            work.
          </h1>
          <div className="mt-12 max-w-2xl">
            <p className="text-[19px] leading-[29px] text-[#131315]">
              You're a 15-person agency with 30 freelancers rotating through.
              Per-seat pricing wasn't built for you. It was built to charge you
              more.
            </p>
            <p className="mt-4 text-[16px] leading-6 text-[#6E6E73]">
              snip is video review for creative teams. Unlimited seats. From $25/month.
              The whole agency, not per editor.
            </p>
          </div>
          <div className="mt-12 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/sign-up"
              className="rounded-full bg-[#131315] px-6 py-3 text-center text-[14px] font-medium leading-5 text-white transition-opacity hover:opacity-90"
            >
              Start your team
            </Link>
            <div className="rounded-[14px] border border-[#E8E8EC] bg-white px-6 py-3">
              <span className="block text-[20px] font-semibold leading-6 text-[#131315]">
                $25/mo
              </span>
              <span className="mt-1 block text-[13px] leading-[18px] text-[#6E6E73]">
                Unlimited seats. Seriously.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Pain Points */}
      <section className="border-b border-[#E8E8EC] bg-[#FAFAFA] px-6 py-24 md:py-32">
        <div className="mx-auto max-w-7xl">
          <h2 className="mb-6 text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">
            Agency life
            <br />
            is hard enough.
          </h2>
          <p className="mb-16 max-w-2xl text-[15px] leading-6 text-[#6E6E73]">
            Your video review tool shouldn't make it harder. Here are the
            problems we actually solve.
          </p>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {painPoints.map((point) => (
              <div
                key={point.id}
                className="flex flex-col overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white"
              >
                <div className="flex items-center gap-4 border-b border-[#F1F1F3] bg-[#FAFAFA] px-6 py-4">
                  <span className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                    /{point.id}
                  </span>
                </div>
                <div className="flex-grow p-6 md:p-8">
                  <h3 className="mb-4 text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#131315]">
                    {point.title}
                  </h3>
                  <p className="text-[15px] leading-6 text-[#6E6E73]">
                    {point.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cost Comparison */}
      <section className="border-b border-[#E8E8EC] bg-white px-6 py-24 md:py-32">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-16 lg:flex-row">
            <div className="lg:w-1/3">
              <h2 className="mb-6 text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">
                Do the
                <br />
                math.
              </h2>
              <p className="max-w-sm text-[15px] leading-6 text-[#6E6E73]">
                Frame.io charges $19/user/month. snip starts at $25/month total.
                Here's what that looks like at agency scale.
              </p>
            </div>

            <div className="flex flex-col gap-5 lg:w-2/3">
              {comparisons.map((row) => (
                <div
                  key={row.size}
                  className="overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white"
                >
                  <div className="flex flex-col md:flex-row">
                    {/* Team size label */}
                    <div className="flex flex-col justify-center border-b border-[#26262A] bg-[#0A0A0B] p-6 text-white md:w-1/3 md:border-b-0 md:border-r md:p-8">
                      <span className="mb-1 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                        Team size
                      </span>
                      <span className="text-2xl font-semibold leading-tight tracking-[-0.02em] md:text-3xl">
                        {row.size}
                      </span>
                    </div>

                    {/* Comparison numbers */}
                    <div className="flex flex-col sm:flex-row flex-grow">
                      <div className="flex-1 border-b border-[#F1F1F3] bg-white p-6 sm:border-b-0 sm:border-r md:p-8">
                        <span className="mb-1 block font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                          Frame.io
                        </span>
                        <span className="text-3xl font-semibold tabular-nums text-[#D8434F]">
                          {row.competitor}
                        </span>
                        <span className="text-sm text-[#6E6E73]">
                          /mo
                        </span>
                      </div>
                      <div className="flex-1 border-b border-[#F1F1F3] bg-[#FAFAFA] p-6 sm:border-b-0 sm:border-r md:p-8">
                        <span className="mb-1 block font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                          snip
                        </span>
                        <span className="text-3xl font-semibold tabular-nums text-[#D14E00]">
                          {row.snip}
                        </span>
                        <span className="text-sm text-[#6E6E73]">
                          /mo
                        </span>
                      </div>
                      <div className="flex-1 bg-[#FAFAFA] p-6 md:p-8">
                        <span className="mb-1 block font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                          You save / year
                        </span>
                        <span className="text-3xl font-semibold tabular-nums text-[#D14E00]">
                          {row.saved}
                        </span>
                        <p className="mt-2 text-[13px] leading-5 text-[#6E6E73]">
                          {row.commentary}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              <div className="rounded-[14px] bg-[#0A0A0B] p-6 text-white md:p-8">
                <p className="text-[15px] leading-6">
                  <span className="font-semibold text-white">The pattern:</span> They
                  charge more as you grow. We don't. Your 50th seat costs the
                  same as your first, $0 extra.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-[#0A0A0B] px-6 py-32 text-white">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <h2 className="mb-6 text-[36px] font-medium leading-[1.25] tracking-[-1.8px] text-white sm:text-[60px]">
            Start your
            <br />
            team.
          </h2>
          <p className="mb-4 max-w-lg text-[16px] leading-6 text-white">
            From $25/month. Unlimited seats. Unlimited projects. No per-user pricing.
            Ever.
          </p>
          <p className="mb-10 text-[14px] leading-5 text-[#A0A0A5]">
            Set up takes about 2 minutes. Your first freelancer will thank you.
          </p>
          <Link
            to="/sign-up"
            className="rounded-full bg-white px-6 py-3 text-[14px] font-medium leading-5 text-[#131315] transition-opacity hover:opacity-90"
          >
            Start your team
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
