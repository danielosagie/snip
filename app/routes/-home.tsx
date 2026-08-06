import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { SnipMark } from "@/components/SnipMark";
import {
  Apple,
  Check,
  CreditCard,
  EyeOff,
  Folder,
  Github,
  Hash,
  KeyRound,
  Lock,
  ScrollText,
  Zap,
} from "lucide-react";

/**
 * Landing page — direct implementation of the Paper artboard
 * 01KTVW7BP98EVMSBJHSWY56FZ0/3-0/1SN-0 (Aug 6, 2026). Layout, copy,
 * and tokens follow that export exactly; only responsiveness, real
 * routes, and the marquee animation are added. Do not restyle without
 * a new Paper export.
 */

const HERO_ASSET = "/landing/hero-frame.jpg";

export default function Homepage() {
  return (
    <div className="[font-synthesis:none] relative bg-white font-['Inter_Tight',system-ui,sans-serif] text-[#131315] antialiased">
      <MarqueeKeyframes />
      <TopNav />

      {/* ── Hero ──────────────────────────────────────────────── */}
      <div className="px-6 pb-16 pt-28 lg:pt-36">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-center gap-14 bg-white lg:flex-row lg:gap-10 lg:px-8 lg:pb-[74px] lg:pt-[86px]">
          <div className="flex flex-col items-start gap-6">
            <h1 className="whitespace-pre-wrap text-[38px] font-semibold leading-[1.15] tracking-[-0.055em] text-black sm:text-[51px] sm:leading-[60px]">
              Simple cloud storage,{"\n"}with a checkout button.
            </h1>
            <p className="max-w-[620px] text-[19px] leading-[29px] text-[#666663]">
              Storage built for people who actually work
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/sign-up"
                className="rounded-full bg-[#FF6600] px-[22px] py-3.5 text-[15px] font-semibold leading-5 text-white transition-opacity hover:opacity-90"
              >
                Start free
              </Link>
              <a
                href="/downloads/snip-desktop.dmg"
                className="flex items-center gap-1.5 rounded-full border border-[#D7D7D2] bg-white px-[21px] py-[13px] text-[15px] font-semibold leading-5 text-black transition-colors hover:bg-[#FAFAFA]"
              >
                <Apple className="h-4 w-4" />
                Download Mac App
              </a>
            </div>
          </div>

          <HeroMockup />
        </div>
      </div>

      {/* ── Feature grid ──────────────────────────────────────── */}
      <div id="features" className="bg-[#FAFAFA] px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="mt-5 max-w-3xl whitespace-pre-wrap text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#131315] sm:text-[44px]">
            A review suite that works like you do.{"\n"}Built by editors, for
            editors.
          </h2>
          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2">
            <FeatureCard
              title="Stream the cloud, locally"
              body="Mount your whole library like a local disk. Bytes stream straight from the edge — open a 40GB master without downloading it first."
            >
              <div className="mt-6 flex flex-col gap-2">
                <FolderRow path="clients/2026/rooftop_wedding/" />
                <FolderRow path="raw_a7siii_cards/" />
              </div>
            </FeatureCard>

            <FeatureCard
              title="Review without the back-and-forth"
              body="Comments pin to the exact frame. Threads resolve in place, and markers export straight to your NLE — no more “the part around two minutes in.”"
            >
              <div className="mt-6 flex flex-wrap gap-2">
                <Chip>
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[#FF6600]" />
                  Matt
                </Chip>
                <Chip>“That's great!”</Chip>
                <Chip>ProRes</Chip>
                <Chip>Cinematic</Chip>
                <span className="flex items-center gap-1.5 rounded-full border-[0.625px] border-solid border-[#37984B] bg-black px-3 py-1.5 text-[12px] font-medium leading-[18px] text-white">
                  ✓ Approved
                </span>
              </div>
            </FeatureCard>

            <FeatureCard
              title="Contracts clients actually sign"
              body="Freeze the terms, verify by one-time code, and keep a court-grade audit trail — consent, hashes, and signatures in the same link as the cut."
            >
              <div className="mt-6 flex items-center justify-between rounded-xl border-[0.625px] border-dashed border-[#D9D9DE] p-4">
                <span className="font-['Instrument_Serif',system-ui,serif] text-[20px] italic leading-7 text-[#131315]">
                  Maya R.
                </span>
                <span className="flex items-center gap-1 rounded-full bg-[#FDF7EE] px-2.5 py-1">
                  <Check className="h-2.5 w-2.5 text-[#B57300]" strokeWidth={2.5} />
                  <span className="font-['Geist_Mono',system-ui,monospace] text-[10px] uppercase leading-[15px] tracking-[0.5px] text-[#B57300]">
                    OTP verified
                  </span>
                </span>
              </div>
            </FeatureCard>

            <FeatureCard
              title="Get paid before the download"
              body="Put final delivery behind a paywall. Clients watch a watermarked preview until the invoice clears — then downloads unlock themselves."
            >
              <div className="mt-6 flex items-center gap-3 rounded-xl bg-[#FAFAFA] px-4 py-3">
                <Lock className="h-[13px] w-[13px] shrink-0 text-[#6E6E73]" />
                <span className="font-['Geist_Mono',system-ui,monospace] text-[11px] leading-4 text-[#6E6E73]">
                  highlights_4k.mp4
                </span>
                <span className="ml-auto rounded-full bg-[#FF6600] px-3 py-1 text-[11px] font-medium leading-4 text-white">
                  $450 to unlock
                </span>
              </div>
            </FeatureCard>
          </div>
        </div>
      </div>

      {/* ── Trust marquee ─────────────────────────────────────── */}
      <div className="overflow-clip bg-[#FAFAFA] py-24">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="whitespace-pre-wrap text-center text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#A0A0A5] sm:text-[44px]">
            Built to protect the work.{"\n"}And make sure you get paid for it.
          </h2>
        </div>
        <div className="relative mt-14">
          <div className="flex w-max gap-5 pr-5 [animation:snip-marquee_50s_linear_infinite] motion-reduce:[animation:none] hover:[animation-play-state:paused]">
            <MarqueeSet />
            <MarqueeSet />
          </div>
          <div
            className="absolute inset-y-0 left-0 w-24"
            style={{ backgroundImage: "linear-gradient(90deg, #FAFAFA 0%, rgba(250,250,250,0) 100%)" }}
          />
          <div
            className="absolute inset-y-0 right-0 w-24"
            style={{ backgroundImage: "linear-gradient(270deg, #FAFAFA 0%, rgba(250,250,250,0) 100%)" }}
          />
        </div>
      </div>

      {/* ── Pricing ───────────────────────────────────────────── */}
      <div id="pricing" className="px-6 py-24">
        <div className="mx-auto flex max-w-5xl flex-col gap-12">
          <h2 className="mt-5 whitespace-pre-wrap text-[32px] font-medium leading-[1.25] tracking-[-1.1px] text-[#A0A0A5] sm:text-[44px]">
            Flat pricing. No seat math.{"\n"}Your whole team, one number.
          </h2>
          <div className="mx-auto mt-2 grid w-full max-w-3xl grid-cols-1 gap-5 md:grid-cols-2">
            {/* Basic */}
            <div className="flex h-full flex-col rounded-2xl border-2 border-[#E8E8EC] bg-white p-8">
              <div className="font-['Geist_Mono',system-ui,monospace] text-[10px] uppercase leading-[15px] tracking-[2px] text-[#A0A0A5]">
                Basic
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-[48px] font-semibold leading-none tracking-[-1.2px] text-[#131315]">
                  $25
                </span>
                <span className="text-[18px] leading-7 text-[#A0A0A5]">/mo</span>
              </div>
              <p className="mt-3 text-[15px] leading-[22px] text-[#6E6E73]">
                Unlimited everything, except storage.
              </p>
              <div className="mt-7 grow">
                <PlanRow>Unlimited seats</PlanRow>
                <PlanRow>Unlimited projects</PlanRow>
                <PlanRow>Unlimited clients</PlanRow>
                <PlanRow last>500 GB storage</PlanRow>
              </div>
              <Link
                to="/sign-up"
                className="mt-8 flex w-full items-center justify-center rounded-full bg-[#131315] px-5 py-3 text-[14px] font-medium leading-5 text-white transition-opacity hover:opacity-90"
              >
                Get Basic
              </Link>
            </div>

            {/* Pro */}
            <div className="flex h-full flex-col rounded-2xl bg-[#0A0A0B] p-8">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-[#FF6600] px-2.5 py-1 font-['Geist_Mono',system-ui,monospace] text-[10px] uppercase leading-[15px] tracking-[0.5px] text-white">
                  PRO
                </span>
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-[48px] font-semibold leading-none tracking-[-1.2px] text-white">
                  $50
                </span>
                <span className="text-[18px] leading-7 text-white/45">/mo</span>
              </div>
              <p className="mt-3 text-[15px] leading-[22px] text-white/70">
                Literally the same thing, but more space.
              </p>
              <div className="mt-7 grow">
                <PlanRow dark>Unlimited seats</PlanRow>
                <PlanRow dark>Unlimited projects</PlanRow>
                <PlanRow dark>Unlimited clients</PlanRow>
                <PlanRow dark last>
                  2TB storage (whoa)
                </PlanRow>
              </div>
              <Link
                to="/sign-up"
                className="mt-8 flex w-full items-center justify-center rounded-full bg-white px-5 py-3 text-[14px] font-medium leading-5 text-[#131315] transition-opacity hover:opacity-90"
              >
                Get Pro
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── CTA ───────────────────────────────────────────────── */}
      <div className="px-6 pb-24">
        <div className="mx-auto max-w-6xl">
          <div className="relative overflow-clip rounded-3xl bg-[#0A0A0B] px-6 pb-52 pt-20">
            <h2 className="mt-6 text-center text-[36px] font-medium leading-[1.25] tracking-[-1.8px] text-white sm:text-[60px]">
              Stop chasing. Start creating.
            </h2>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Link
                to="/sign-up"
                className="flex items-center justify-center rounded-full bg-white px-6 py-3 text-center text-[14px] font-medium leading-5 text-[#131315] transition-opacity hover:opacity-90"
              >
                Start for free
              </Link>
              <Link
                to="/pricing"
                className="flex items-center justify-center rounded-full border-[0.625px] border-solid border-white/25 px-6 py-3 text-center text-[14px] font-medium leading-5 text-white transition-colors hover:bg-white/10"
              >
                See pricing
              </Link>
            </div>
            <div className="absolute -bottom-10 left-1/2 flex w-[90%] -translate-x-1/2 justify-center gap-5">
              <CtaCard src={HERO_ASSET} position="0% 20%" rotate="-5deg" />
              <CtaCard src="/grassy-bg.avif" position="50% 70%" rotate="2deg" />
              <CtaCard src="/sandy-bg.jpg" position="100% 80%" rotate="-2deg" />
              <CtaCard src={HERO_ASSET} position="15% 30%" rotate="5deg" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ────────────────────────────────────────────── */}
      <footer className="border-t-[0.625px] border-solid border-t-[#E8E8EC] bg-white px-6 pb-10 pt-16">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 grid grid-cols-2 gap-10 md:grid-cols-4">
            <FooterCol
              label="Features"
              links={[
                { label: "Client review", to: "/" },
                { label: "Contracts", to: "/" },
                { label: "Paid delivery", to: "/" },
                { label: "Cloud drive", to: "/" },
              ]}
            />
            <FooterCol
              label="Compare"
              links={[
                { label: "[ ] vs Frame.io", to: "/compare/frameio" },
                { label: "[ ] vs Wipster", to: "/compare/wipster" },
                { label: "[ ] vs LucidLink", to: "/compare/lucidlink" },
              ]}
            />
            <FooterCol
              label="Use cases"
              links={[
                { label: "[ ] Video editors", to: "/for/video-editors" },
                { label: "[ ] Agencies", to: "/for/agencies" },
              ]}
            />
            <FooterCol
              label="General"
              links={[
                { label: "[ ] Pricing", to: "/pricing" },
                { label: "[ ] Sign in", to: "/sign-in" },
                { label: "[ ] Start free", to: "/sign-up" },
                {
                  label: "[ ] GitHub",
                  href: "https://github.com/danielosagie/snip",
                },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-5 border-t-[0.625px] border-solid border-t-[#E8E8EC] pt-8">
            <div className="flex items-center gap-2.5">
              <span className="flex overflow-clip rounded-md">
                <SnipMark size={28} />
              </span>
              <span className="text-[24px] font-semibold leading-8 tracking-[-0.6px] text-[#131315]">
                snip.
              </span>
            </div>
            <div className="font-['Geist_Mono',system-ui,monospace] text-[10px] uppercase leading-[15px] tracking-[2px] text-[#A0A0A5]">
              Video review for creative teams — open source forever
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── Nav ─────────────────────────────────────────────────────── */

function TopNav() {
  return (
    <div className="fixed top-0 z-50 w-full border-b-[0.625px] border-solid border-b-[#E8E8EC] bg-white/85 [backdrop-filter:blur(12px)]">
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3.5">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <span className="flex overflow-clip rounded-md">
            <SnipMark size={24} />
          </span>
          <span className="text-[18px] font-semibold leading-7 tracking-[-0.45px] text-[#131315]">
            snip.
          </span>
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          <a href="#features" className="text-[14px] leading-5 text-[#6E6E73] transition-colors hover:text-[#131315]">
            Product
          </a>
          <Link to="/pricing" className="text-[14px] leading-5 text-[#6E6E73] transition-colors hover:text-[#131315]">
            Pricing
          </Link>
          <Link to="/compare/frameio" className="text-[14px] leading-5 text-[#6E6E73] transition-colors hover:text-[#131315]">
            Compare
          </Link>
          <a
            href="/downloads/snip-desktop.dmg"
            className="flex items-center gap-1.5 text-[14px] leading-5 text-[#6E6E73] transition-colors hover:text-[#131315]"
          >
            <Apple className="h-3.5 w-3.5" />
            Download
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-5">
          <Link to="/sign-in" className="text-[14px] leading-5 text-[#6E6E73] transition-colors hover:text-[#131315]">
            Log in
          </Link>
          <Link
            to="/sign-up"
            className="flex items-center justify-center rounded-full bg-[#131315] px-4 py-2 text-[14px] font-medium leading-5 text-white transition-opacity hover:opacity-90"
          >
            Start for free
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ── Hero mockup ─────────────────────────────────────────────── */

function HeroMockup() {
  return (
    <div className="relative hidden h-[520px] flex-col overflow-visible md:flex">
      {/* App window */}
      <div className="relative left-5 top-7 flex h-[448px] w-[536px] shrink-0 flex-col overflow-clip rounded-[22px] border border-solid border-[#DEDED9] bg-[#F7F7F4] [box-shadow:rgba(20,20,20,0.13)_0px_20px_50px]">
        <div className="flex h-[54px] w-full shrink-0 items-center justify-between border-b border-solid border-b-[#DEDED9] bg-[#F7F7F4] px-4">
          <span className="text-[15px] font-bold leading-5 text-[#141414]">snip.</span>
          <span className="flex items-center gap-[7px] rounded-[11px] border border-solid border-[#D6D6D1] bg-[#FDFDFB] px-3 py-2 text-xs font-semibold leading-4 text-[#141414]">
            ↓ Download · $450.00
          </span>
        </div>
        <div className="flex w-full shrink-0 items-end justify-between bg-[#F7F7F4] px-[18px] pb-3 pt-4">
          <div className="flex flex-col gap-[3px]">
            <span className="text-base font-bold leading-5 text-[#141414]">Summer campaign</span>
            <span className="text-xs leading-4 text-[#6F716F]">
              highlights_4k.mp4 · 14 comment threads
            </span>
          </div>
          <span className="flex items-center rounded-full bg-white px-[9px] py-[5px] text-[11px] font-semibold leading-[14px] text-black">
            ✓ Approved
          </span>
        </div>
        <div className="flex min-h-0 w-full grow gap-2.5 px-3.5 pb-3.5">
          {/* Player */}
          <div className="flex h-full w-[310px] shrink-0 flex-col overflow-clip rounded-[14px] border border-solid border-[#D9D9D4] bg-[#1C1C1B]">
            <div className="relative h-[226px] w-full shrink-0 overflow-clip">
              <div
                className="h-full w-full bg-cover bg-center"
                style={{ backgroundImage: `url(${HERO_ASSET})` }}
              />
              <span className="absolute left-3 top-2.5 rounded-[7px] bg-[#141414]/72 px-[7px] py-[5px] text-[9px] font-semibold leading-3 text-[#F7F7F4]">
                client@studio.com
              </span>
              <span className="absolute left-[76px] top-[92px] flex h-12 w-12 items-center justify-center rounded-full bg-[#F7F7F4]/92 text-[17px] font-bold leading-5 text-[#141414]">
                ▶
              </span>
              <span className="absolute bottom-2.5 left-3 rounded-[7px] bg-[#141414]/72 px-[7px] py-[5px] text-[9px] font-semibold uppercase leading-3 tracking-[0.08em] text-[#F7F7F4]">
                Preview · Do not redistribute
              </span>
            </div>
            <div className="flex w-full grow flex-col gap-[9px] bg-[#1C1C1B] px-3.5 py-3">
              <div className="flex h-1 w-full overflow-clip rounded-full bg-[#494946]">
                <div className="h-1 w-[58%] bg-[#FF5A1F]" />
              </div>
              <div className="flex items-center justify-between text-[10px] leading-[13px] text-[#B8B8B1]">
                <span>00:42</span>
                <span>02:14</span>
              </div>
              <div className="rounded-[10px] bg-[#30302E] px-2.5 py-[9px] text-[11px] font-medium leading-[15px] text-[#F7F7F4]">
                “Use the wider shot here.”
              </div>
            </div>
          </div>
          {/* Download panel */}
          <div className="flex h-full grow flex-col overflow-clip rounded-[14px] border border-solid border-[#D9D9D4] bg-[#FDFDFB]">
            <div className="flex w-full flex-col gap-0.5 border-b border-solid border-b-[#DEDED9] bg-[#FDFDFB] px-[13px] pb-2.5 pt-[13px]">
              <span className="text-sm font-bold leading-[18px] text-[#141414]">Download</span>
              <span className="text-[10px] leading-[13px] text-[#6F716F]">3 items · 48.7 GB</span>
            </div>
            <div className="flex flex-col gap-2 bg-[#FF5A1F] p-3">
              <span className="text-[10px] font-bold uppercase leading-[13px] tracking-[0.08em] text-[#F7F7F4]">
                Locked
              </span>
              <span className="text-[11px] font-medium leading-[15px] text-[#F7F7F4]">
                Pay once to unlock every download in this share.
              </span>
              <span className="flex h-8 shrink-0 items-center justify-center rounded-[9px] bg-[#F7F7F4] text-[11px] font-bold leading-[14px] text-[#141414]">
                Pay $450 to unlock
              </span>
            </div>
            <MockFileRow name="ceremony_master.mov" size="38.2 GB" />
            <MockFileRow name="highlights_4k.mp4" size="9.1 GB" />
            <MockFileRow name="socials_vertical.mp4" size="1.4 GB" />
          </div>
        </div>
      </div>

      {/* Floating: gif card */}
      <div
        className="absolute -left-[18px] bottom-[22px] flex w-44 origin-top-left items-center gap-2.5 rounded-[14px] border border-solid border-[#D9D9D4] bg-[#FDFDFB] p-[9px] [box-shadow:rgba(20,20,20,0.14)_0px_12px_28px]"
        style={{ rotate: "-4deg" }}
      >
        <div className="relative h-[42px] w-[52px] shrink-0 overflow-clip rounded-[9px]">
          <div
            className="h-full w-full bg-cover bg-center"
            style={{ backgroundImage: `url(${HERO_ASSET})` }}
          />
          <span className="absolute bottom-1 right-1 rounded-sm bg-[#141414] px-1 py-0.5 text-[8px] font-bold leading-[10px] text-[#F7F7F4]">
            GIF
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[11px] font-bold leading-[14px] text-[#141414]">social_cut.gif</span>
          <span className="text-[9px] leading-3 text-[#6F716F]">8.2 MB · ready</span>
        </div>
      </div>

      {/* Floating: payment card */}
      <div
        className="absolute -top-[68px] right-0.5 flex w-[186px] origin-top-left flex-col gap-1 rounded-[15px] border border-solid border-[#D9D9D9] bg-white px-3 py-2.5 [box-shadow:rgba(20,20,20,0.13)_0px_12px_30px]"
        style={{ rotate: "3deg" }}
      >
        <span className="text-[10px] font-bold uppercase leading-[13px] text-[#999999]">
          Payment received
        </span>
        <span className="text-[13px] font-bold leading-[17px] text-[#141414]">
          Original unlocked
        </span>
        <div className="flex items-center justify-between border-t border-solid border-t-[#999999] pt-1 text-[10px] leading-[13px] text-[#999999]">
          <span>To Stripe</span>
          <span className="font-bold">+$427.20</span>
        </div>
      </div>
    </div>
  );
}

function MockFileRow({ name, size }: { name: string; size: string }) {
  return (
    <div className="flex w-full items-center gap-2 border-b border-solid border-b-[#E4E4DF] bg-[#FDFDFB] px-3 py-2.5">
      <span className="h-3 w-3 shrink-0 rounded-[3px] border border-solid border-[#B7B7B1]" />
      <div className="flex min-w-0 grow flex-col gap-px">
        <span className="text-[10px] font-semibold leading-[13px] text-[#141414]">{name}</span>
        <span className="text-[9px] leading-3 text-[#777772]">{size}</span>
      </div>
    </div>
  );
}

/* ── Feature grid pieces ─────────────────────────────────────── */

function FeatureCard({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border-[0.625px] border-solid border-[#E8E8EC] bg-white p-7">
      <h3 className="text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#131315]">
        {title}
      </h3>
      <p className="mt-2 text-[15px] leading-[24px] text-[#6E6E73]">{body}</p>
      {children}
    </div>
  );
}

function FolderRow({ path }: { path: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-[#FAFAFA] px-4 py-2.5">
      <Folder className="h-3 w-3 shrink-0 text-[#FF6600]" />
      <span className="font-['Geist_Mono',system-ui,monospace] text-[11px] leading-4 text-[#6E6E73]">
        {path}
      </span>
      <span className="ml-auto font-['Geist_Mono',system-ui,monospace] text-[9px] uppercase leading-[13px] tracking-[0.45px] text-[#A0A0A5]">
        streamed
      </span>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border-[0.625px] border-solid border-[#E8E8EC] bg-white px-3 py-1.5 text-[12px] font-medium leading-[18px] text-[#131315]">
      {children}
    </span>
  );
}

/* ── Marquee ─────────────────────────────────────────────────── */

const TRUST_CARDS: Array<{
  icon: ReactNode;
  tint: string;
  title: string;
  body: string;
  rotate: string;
}> = [
  {
    icon: <Hash className="h-[15px] w-[15px] text-[#131315]" />,
    tint: "#EEF4FF",
    title: "SHA-256 frozen terms",
    body: "Contract terms are hashed and locked the moment you send them.",
    rotate: "-1.2deg",
  },
  {
    icon: <KeyRound className="h-[15px] w-[15px] text-[#131315]" />,
    tint: "#F3FBF4",
    title: "OTP-verified signing",
    body: "Signers confirm identity with a one-time code — no accounts.",
    rotate: "1.2deg",
  },
  {
    icon: <ScrollText className="h-[15px] w-[15px] text-[#131315]" />,
    tint: "#FFF7F2",
    title: "Full audit trail",
    body: "Every open, consent, and signature is timestamped and kept.",
    rotate: "-1.2deg",
  },
  {
    icon: <EyeOff className="h-[15px] w-[15px] text-[#131315]" />,
    tint: "#F7F5FF",
    title: "Watermarked previews",
    body: "Paywalled shares never serve the raw original file.",
    rotate: "1.2deg",
  },
  {
    icon: <CreditCard className="h-[15px] w-[15px] text-[#131315]" />,
    tint: "#F3FBF4",
    title: "Payments by Stripe",
    body: "Checkout and payouts run on Stripe end to end.",
    rotate: "-1.2deg",
  },
  {
    icon: <Zap className="h-[15px] w-[15px] text-[#131315]" />,
    tint: "#FFF7F2",
    title: "Streams from the edge",
    body: "Bytes come straight from edge storage — no proxy in the way.",
    rotate: "1.2deg",
  },
  {
    icon: <Github className="h-[15px] w-[15px] text-[#131315]" />,
    tint: "#F5F5F6",
    title: "Open source",
    body: "The whole codebase is on GitHub. Read it, fork it, trust it.",
    rotate: "-1.2deg",
  },
];

function MarqueeSet() {
  return (
    <div className="flex gap-5">
      {TRUST_CARDS.map((card) => (
        <div
          key={card.title}
          className="w-[270px] shrink-0 origin-center rounded-xl border-[0.625px] border-solid border-[#E8E8EC] bg-white p-5 [box-shadow:rgba(19,19,21,0.05)_0px_1px_2px]"
          style={{ rotate: card.rotate }}
        >
          <div
            className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ backgroundColor: card.tint }}
          >
            {card.icon}
          </div>
          <div className="text-[14px] font-medium leading-5 text-[#131315]">{card.title}</div>
          <div className="mt-1 text-[12px] leading-[19.5px] text-[#6E6E73]">{card.body}</div>
        </div>
      ))}
    </div>
  );
}

function MarqueeKeyframes() {
  return (
    <style>{`@keyframes snip-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
  );
}

/* ── Pricing pieces ──────────────────────────────────────────── */

function PlanRow({
  children,
  dark,
  last,
}: {
  children: ReactNode;
  dark?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${last ? "" : "mb-3"}`}>
      <Check className="h-3.5 w-3.5 shrink-0 text-[#FF6600]" strokeWidth={2.5} />
      <span
        className={`text-[15px] leading-[22px] ${dark ? "text-white/85" : "text-[#131315]"}`}
      >
        {children}
      </span>
    </div>
  );
}

/* ── CTA pieces ──────────────────────────────────────────────── */

function CtaCard({
  src,
  position,
  rotate,
}: {
  src: string;
  position: string;
  rotate: string;
}) {
  return (
    <div
      className="h-40 w-56 shrink-0 origin-center overflow-clip rounded-xl border-[3.75px] border-solid border-[#E8E8EC] [box-shadow:rgba(0,0,0,0.25)_0px_25px_50px_-12px]"
      style={{ rotate }}
    >
      <div
        className="h-full w-full bg-cover"
        style={{ backgroundImage: `url(${src})`, backgroundPosition: position }}
      />
    </div>
  );
}

/* ── Footer pieces ───────────────────────────────────────────── */

function FooterCol({
  label,
  links,
}: {
  label: string;
  links: Array<{ label: string; to?: string; href?: string }>;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Folder className="h-[11px] w-[11px] text-[#A0A0A5]" />
        <span className="font-['Geist_Mono',system-ui,monospace] text-[10px] uppercase leading-[15px] tracking-[2.2px] text-[#A0A0A5]">
          {label}
        </span>
      </div>
      <div>
        {links.map((link, i) => (
          <div key={link.label} className={i === links.length - 1 ? "" : "mb-2.5"}>
            {link.href ? (
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="font-['Geist_Mono',system-ui,monospace] text-[12px] leading-[18px] text-[#6E6E73] transition-colors hover:text-[#131315]"
              >
                {link.label}
              </a>
            ) : (
              <Link
                to={link.to ?? "/"}
                className="font-['Geist_Mono',system-ui,monospace] text-[12px] leading-[18px] text-[#6E6E73] transition-colors hover:text-[#131315]"
              >
                {link.label}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
