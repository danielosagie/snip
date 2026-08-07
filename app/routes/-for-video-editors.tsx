import { Link } from "@tanstack/react-router";
import { MarketingLayout } from "@/components/MarketingLayout";

const painPoints = [
  {
    id: "01",
    title: "Clients don't know timecodes",
    description:
      'Your client says "around the middle somewhere, you know, after the thing." With snip, they click on the video and their comment lands on that exact frame. No timecode math. No guessing.',
  },
  {
    id: "02",
    title: "Upload, wait, transcode, wait",
    description:
      "You just exported a 12GB ProRes and now you need to wait 20 minutes for it to process. snip uses Mux-powered playback. Upload your file, get a link, share it. Seconds, not minutes.",
  },
  {
    id: "03",
    title: "Getting notes back into your NLE",
    description:
      "Comments are useless if you have to manually re-type them into your timeline. Export frame-accurate comments with timecodes and bring them straight back to Premiere, Resolve, or Final Cut.",
  },
  {
    id: "04",
    title: "10 reviewers = 10 seats = $$$",
    description:
      "The director, the producer, the client, the client's wife, and the intern who somehow has opinions all need access. snip starts at $25/month flat. Invite literally everyone.",
  },
];

const steps = [
  {
    step: "1",
    action: "Upload your cut",
    description:
      "Drag and drop your export. H.264, ProRes, whatever. We process it instantly through Mux so playback is fast on any device, any connection.",
  },
  {
    step: "2",
    action: "Share a link",
    description:
      "Copy the review link and send it to your client. They don't need an account, they don't need to download anything. They just click and watch.",
  },
  {
    step: "3",
    action: "Collect and export",
    description:
      "Clients click anywhere on the video to leave comments at exact frames. You see every note with precise timecodes, ready to export back to your NLE timeline.",
  },
];

export default function ForVideoEditors() {
  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="border-b border-[#E8E8EC] bg-white px-6 py-24 md:py-32">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
            For video editors
          </div>
          <h1 className="mb-8 max-w-4xl text-[42px] font-semibold leading-[1.05] tracking-[-0.055em] text-[#131315] sm:text-[54px] md:text-[64px]">
            Video review that editors actually want to use.
          </h1>
          <p className="mb-12 max-w-3xl text-[19px] leading-[29px] text-[#6E6E73]">
            Your client said "make it pop" on a 47-minute timeline. You deserve
            a review tool that at least tells you where they meant. snip gives
            you frame-accurate feedback, instant playback, and a workflow that
            doesn't fight your NLE.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              to="/sign-up"
              className="rounded-full bg-[#131315] px-6 py-3 text-center text-[14px] font-medium leading-5 text-white transition-opacity hover:opacity-90"
            >
              Start free
            </Link>
            <div className="flex items-center gap-3 px-4">
              <span className="text-[20px] font-semibold text-[#131315]">$25/mo</span>
              <span className="text-[13px] leading-[18px] text-[#6E6E73]">
                flat, not per seat
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Pain Points */}
      <section className="border-b border-[#E8E8EC] bg-[#FAFAFA] px-6 py-24 md:py-32">
        <div className="mx-auto max-w-7xl">
          <h2 className="mb-4 text-center text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">
            The pain is real.
          </h2>
          <p className="mx-auto mb-16 max-w-2xl text-center text-[15px] leading-6 text-[#6E6E73]">
            Every editor knows these problems. We built snip to fix them.
          </p>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {painPoints.map((point) => (
              <div
                key={point.id}
                className="overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white"
              >
                <div className="flex items-center justify-between border-b border-[#F1F1F3] bg-[#FAFAFA] px-6 py-4">
                  <span className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                    /{point.id}
                  </span>
                  <span className="rounded-full bg-[#FFF0E6] px-2.5 py-1 text-[12px] font-medium leading-[18px] text-[#D14E00]">
                    Solved
                  </span>
                </div>
                <div className="p-6 md:p-8">
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

      {/* How It Works for Editors */}
      <section className="border-b border-[#E8E8EC] bg-white px-6 py-24 md:py-32">
        <div className="mx-auto max-w-7xl">
          <h2 className="mb-4 text-center text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">
            How it works.
          </h2>
          <p className="mx-auto mb-16 max-w-2xl text-center text-[15px] leading-6 text-[#6E6E73]">
            Three steps. No onboarding calls, no training videos, no "schedule a
            demo" buttons.
          </p>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {steps.map((item) => (
              <div
                key={item.step}
                className="flex flex-col overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white"
              >
                <div className="flex items-end justify-between border-b border-[#F1F1F3] bg-[#FAFAFA] p-6">
                  <span className="text-[40px] font-semibold leading-none tracking-tight text-[#131315]">
                    {item.step}
                  </span>
                  <span className="mb-1 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                    Step
                  </span>
                </div>
                <div className="flex flex-grow flex-col p-8">
                  <h3 className="mb-4 text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#131315]">
                    {item.action}
                  </h3>
                  <p className="text-[15px] leading-6 text-[#6E6E73]">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Callout */}
      <section className="border-b border-[#26262A] bg-[#0A0A0B] px-6 py-24 text-white md:py-32">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="mb-8 text-[36px] font-medium leading-[1.25] tracking-[-1.8px] text-white sm:text-[60px]">
            $25/month.
            <br />
            <span className="text-[#FF6600]">Not per user.</span>
            <br />
            Total.
          </h2>
          <p className="mx-auto mb-4 max-w-2xl text-[16px] leading-6 text-white">
            Unlimited seats. Unlimited projects. Unlimited reviewers. Your
            entire team, your clients, and your client's clients all get
            access for one flat price.
          </p>
          <p className="text-[14px] font-medium leading-5 text-[#FF6600]">
            Need 1TB? Pro is $50/month.
          </p>
          <p className="mt-3 text-[14px] font-medium leading-5 text-[#A0A0A5]">
            Stop paying per-seat tax on collaboration.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-white px-6 py-32">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <h2 className="mb-6 text-[36px] font-medium leading-[1.25] tracking-[-1.8px] text-[#131315] sm:text-[60px]">
            Start editing faster.
          </h2>
          <p className="mb-10 max-w-xl text-[16px] leading-6 text-[#6E6E73]">
            Free trial, no credit card. Set up your first review in under a
            minute.
          </p>
          <Link
            to="/sign-up"
            className="rounded-full bg-[#131315] px-6 py-3 text-[14px] font-medium leading-5 text-white transition-opacity hover:opacity-90"
          >
            Start free
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
