import { Link } from "@tanstack/react-router";
import { MarketingLayout } from "@/components/MarketingLayout";

/**
 * Illustrative LucidLink seat rate for the “seat math” cards only.
 * LucidLink bills by plan + included capacity + overages. See their site for
 * current list pricing. This constant is a mid-tier Business-plan-ish
 * round number so the chart reads as “directionally cheaper,” not a quote.
 */
const LUCIDLINK_ILLUSTRATIVE_PER_USER = 27;
const SNIP_PRICE_FLAT = 25;

const comparisonRows = [
  {
    feature: "Primary job",
    lucidlink: "Cloud NAS / Filespace",
    snip: "Video review + contracts + delivery",
    note: "Different products. snip mounts your bucket so editors still get a drive letter.",
  },
  {
    feature: "Desktop mount",
    lucidlink: "Native LucidLink client",
    snip: "snip desktop: one-click rclone + FUSE",
    note: "Same mental model: files appear local; data lives in the cloud.",
  },
  {
    feature: "Where files live",
    lucidlink: "LucidLink-managed storage",
    snip: "Your R2 / S3 bucket (you own keys + egress math)",
    note: "Bring-your-own-object-storage vs bundled Filespace.",
  },
  {
    feature: "Sequential / NLE playback",
    lucidlink: "Highly tuned streaming cache",
    snip: "rclone VFS: large read-ahead + write cache (tuned for big media)",
    note: "We bias rclone toward read-ahead and chunky range reads like a NAS client.",
  },
  {
    feature: "Frame-accurate review",
    lucidlink: "Not the product focus",
    snip: "Built-in (Mux + comments + share links)",
    note: "snip is for review; LucidLink is for shared project media.",
  },
  {
    feature: "Open source",
    lucidlink: "No",
    snip: "Yes",
    note: "Read the mount + desktop code; no black box.",
  },
  {
    feature: "snip subscription",
    lucidlink: "Per user + capacity tiers / overages",
    snip: "$25/mo flat (Pro storage tier $50)",
    note: "Object storage is still billed by your provider, as with any NAS client.",
  },
];

const teamSizes = [3, 5, 10, 25];

function annualSeatSavingsIllustrative(teamSize: number) {
  return (LUCIDLINK_ILLUSTRATIVE_PER_USER * teamSize - SNIP_PRICE_FLAT) * 12;
}

const savingsCommentary: Record<number, string> = {
  3: "That's a few months of object storage for a small team.",
  5: "Enough to pay for a serious R2 bucket and still pocket the difference.",
  10: "Real money, but add your own storage math on both sides.",
  25: "At agency scale, seat + capacity lines add up fast.",
};

export default function CompareLucidlink() {
  return (
    <MarketingLayout>
      <section className="border-b border-[#E8E8EC] bg-white px-6 pb-24 pt-20 md:pb-32 md:pt-28">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-[42px] font-semibold leading-[1.05] tracking-[-0.055em] text-[#131315] sm:text-[54px] md:text-[64px]">
            snip vs
            <br />
            LucidLink
          </h1>
          <div className="mt-10 max-w-2xl md:mt-14">
            <p className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[#131315] md:text-[32px]">
              Cloud NAS vs
              <br />
              review-first + your bucket.
              <br />
              <span className="text-[#6E6E73]">
                The desktop mount is the overlap.
              </span>
            </p>
            <p className="mt-6 max-w-lg text-[16px] leading-6 text-[#6E6E73]">
              LucidLink is excellent at making remote media feel local. snip is
              excellent at review, contracts, and share links. The desktop
              companion mounts the same project tree over S3 so Premiere,
              Resolve, and Finder see the same folder layout you get from a
              Filespace-style workflow.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-[#E8E8EC] bg-[#FAFAFA] px-6 py-24 md:py-32">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">
            Side by
            <br />
            side.
          </h2>

          <div className="overflow-x-auto rounded-[14px] border border-[#E8E8EC] bg-white">
            <div className="grid min-w-[680px] grid-cols-3 border-b border-[#F1F1F3] bg-[#FAFAFA]">
              <div className="p-4 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5] md:p-6">
                Feature
              </div>
              <div className="p-4 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5] md:p-6">
                LucidLink
              </div>
              <div className="p-4 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5] md:p-6">
                snip
              </div>
            </div>

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
                  {row.lucidlink}
                </div>
                <div className="flex items-center gap-2 p-4 text-[14px] font-medium leading-5 text-[#131315] before:text-[#FF6600] before:content-['✓'] md:p-6">
                  {row.snip}
                </div>
              </div>
            ))}
          </div>

          <p className="mx-auto mt-6 max-w-2xl text-center text-[13px] leading-5 text-[#6E6E73]">
            * LucidLink pricing and included capacity change by plan. See{" "}
            <a
              href="https://www.lucidlink.com/pricing"
              className="underline underline-offset-2 transition-colors hover:text-[#131315]"
              target="_blank"
              rel="noopener noreferrer"
            >
              lucidlink.com/pricing
            </a>
            . The savings cards below use an illustrative ${LUCIDLINK_ILLUSTRATIVE_PER_USER}
            /user/mo seat figure only (no storage overages on either side).
          </p>
        </div>
      </section>

      <section className="border-b border-[#E8E8EC] bg-white px-6 py-24 md:py-32">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-center text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">
            Seat math
            <br />
            (illustrative)
          </h2>
          <p className="mx-auto mb-16 max-w-lg text-center text-[15px] leading-6 text-[#6E6E73]">
            snip is ${SNIP_PRICE_FLAT}/month flat for the product. LucidLink
            charges per collaborator on published plans. Here is the delta if
            you model LucidLink at ~${LUCIDLINK_ILLUSTRATIVE_PER_USER}/user/mo,
            before any storage overages or your S3/R2 bill.
          </p>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {teamSizes.map((size) => {
              const savings = annualSeatSavingsIllustrative(size);
              const lucidAnnual = LUCIDLINK_ILLUSTRATIVE_PER_USER * size * 12;
              const snipAnnual = SNIP_PRICE_FLAT * 12;

              return (
                <div
                  key={size}
                  className="flex flex-col overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white"
                >
                  <div className="border-b border-[#F1F1F3] bg-[#FAFAFA] p-5">
                    <span className="text-4xl font-semibold tracking-tight text-[#131315]">{size}</span>
                    <span className="ml-2 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                      seats (modeled)
                    </span>
                  </div>
                  <div className="flex flex-grow flex-col p-5">
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                        LucidLink (modeled)
                      </span>
                      <span className="font-medium tabular-nums text-[#6E6E73] line-through">
                        ${lucidAnnual.toLocaleString()}/yr
                      </span>
                    </div>
                    <div className="mb-4 flex items-baseline justify-between gap-3">
                      <span className="font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                        snip
                      </span>
                      <span className="font-semibold tabular-nums text-[#D14E00]">${snipAnnual}/yr</span>
                    </div>
                    <div className="mt-auto border-t border-[#F1F1F3] pt-4">
                      <div className="text-3xl font-semibold tracking-tight tabular-nums text-[#D14E00]">
                        ${savings.toLocaleString()}
                      </div>
                      <div className="mt-1 font-['Geist_Mono',system-ui,monospace] text-[11px] font-medium uppercase leading-[14px] tracking-widest text-[#A0A0A5]">
                        modeled seat delta / yr
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

      <section className="border-b border-[#E8E8EC] bg-[#FAFAFA] px-6 py-24 md:py-32">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-center text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">
            Mount
            <br />
            parity.
          </h2>
          <p className="mx-auto mb-12 max-w-2xl text-center text-[15px] leading-6 text-[#6E6E73]">
            The snip desktop app wraps the same rclone + FUSE recipe documented
            in <code className="text-[#131315]">docs/MOUNTING.md</code>
            : large VFS read-ahead, chunky read sizes, and a 50&nbsp;GB write
            cache so big media behaves more like a purpose-built cloud NAS
            client than a naive S3 browser.
          </p>

          <div className="rounded-[14px] border border-[#E8E8EC] bg-white p-8 md:p-10">
            <h3 className="mb-4 text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#131315]">
              What we tuned for editors
            </h3>
            <ul className="max-w-2xl space-y-3 text-[15px] leading-6 text-[#6E6E73]">
              <li>
                <span className="text-[#FF6600]">✓</span>{" "}
                <strong className="font-semibold text-[#131315]">Read-ahead</strong>{" "}
                so sequential playback and bin scrolling pull fewer tiny HTTP
                ranges off object storage.
              </li>
              <li>
                <span className="text-[#FF6600]">✓</span>{" "}
                <strong className="font-semibold text-[#131315]">Larger read chunks</strong>{" "}
                to match how NLEs read big GOP blocks instead of hammering the
                API with 4&nbsp;KiB requests.
              </li>
              <li>
                <span className="text-[#FF6600]">✓</span>{" "}
                <strong className="font-semibold text-[#131315]">Write-back cache</strong>{" "}
                (existing) so exports land in VFS fast, then flush to S3 in the
                background like you expect from a sync client.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="border-b border-[#E8E8EC] bg-white px-6 py-24 md:py-32">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-center text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">
            Honest
            <br />
            advice.
          </h2>
          <p className="mx-auto mb-16 max-w-lg text-center text-[15px] leading-6 text-[#6E6E73]">
            If you need LucidLink-class collaborative caching across dozens of
            workstations on one Filespace, LucidLink is purpose-built for that.
            If you need frame-accurate review, contracts, and a mount that hits{" "}
            <em>your</em> bucket with open-source tooling, snip is built for
            that combo.
          </p>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white">
              <div className="border-b border-[#F1F1F3] p-6">
                <h3 className="text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#131315]">
                  Use LucidLink if...
                </h3>
              </div>
              <div className="p-6">
                <ul className="space-y-5">
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#A0A0A5]">
                      ×
                    </span>
                    <span className="font-medium">
                      You want a vendor-managed global namespace with their
                      client stack and SLAs across every machine
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#A0A0A5]">
                      ×
                    </span>
                    <span className="font-medium">
                      You are standardizing the entire facility on one Filespace
                      and collaboration inside that volume is the top priority
                    </span>
                  </li>
                </ul>
              </div>
            </div>

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
                      You want review + delivery in snip, but still mount{" "}
                      <code className="text-[#FF6600]">projects/</code>{" "}
                      from your own R2/S3 keys
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#FF6600]">
                      ✓
                    </span>
                    <span className="font-medium">
                      You are comfortable installing rclone + macFUSE / WinFsp
                      once, then using the desktop Mount button forever
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#0A0A0B] px-6 py-32 text-white">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <h2 className="mb-4 text-[36px] font-medium leading-[1.25] tracking-[-1.8px] text-white sm:text-[60px]">
            Try
            <br />
            snip.
          </h2>
          <p className="mb-10 max-w-md text-[16px] leading-6 text-[#A0A0A5]">
            $25/month. Unlimited seats. Mount your bucket from the desktop app
            when you are ready.
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
