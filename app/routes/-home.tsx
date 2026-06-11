import { useState, useEffect, useRef, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useUser } from "@clerk/tanstack-react-start";
import { SnipMark } from "@/components/SnipMark";
import {
  Apple,
  Play,
  Lock,
  Check,
  FileText,
  Folder,
  MessageSquare,
  ArrowUpRight,
  Hash,
  KeyRound,
  ScrollText,
  CreditCard,
  Github,
  Zap,
  EyeOff,
} from "lucide-react";

/**
 * Landing page — shade.inc-style art direction (white, Inter Tight,
 * sentence-case headlines with a gray second line, mono eyebrows, pill
 * buttons, rounded bento cards). Intentionally departs from the app's
 * brutalist language; scoped to this page only.
 */

const INK = "#131315";
const GRAY = "#6e6e73";
const GRAY_LIGHT = "#a0a0a5";
const LINE = "#e8e8ec";
const PANEL = "#fafafa";
const ORANGE = "#FF6600";

/* ---------------------------------- bits --------------------------------- */

function Eyebrow({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <div
      className="font-mono text-[11px] uppercase tracking-[0.22em] flex items-center gap-2"
      style={{ color: light ? "rgba(255,255,255,0.6)" : GRAY }}
    >
      <span aria-hidden style={{ color: ORANGE, fontSize: "9px" }}>
        ▶
      </span>
      {children}
    </div>
  );
}

/** Fade-up on first scroll into view. Uses a rect check on scroll rather than
 * IntersectionObserver — IO callbacks don't fire in hidden/background tabs, which
 * would leave prerendered content invisible until a repaint. */
function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const check = () => {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
        setShown(true);
        window.removeEventListener("scroll", check);
        window.removeEventListener("resize", check);
      }
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "translateY(0)" : "translateY(20px)",
        transition: `opacity 0.7s ease ${delay}ms, transform 0.7s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

/** Decode/scramble through a list of words, shade-style. */
function useScrambleWords(words: string[], holdMs = 2400) {
  const [display, setDisplay] = useState(words[0]);
  useEffect(() => {
    const CHARS = "abcdefghijklmnopqrstuvwxyz·—/";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let idx = 0;
    let frame: ReturnType<typeof setInterval> | null = null;
    const cycle = setInterval(() => {
      idx = (idx + 1) % words.length;
      const target = words[idx];
      if (reduce) {
        setDisplay(target);
        return;
      }
      let tick = 0;
      const totalTicks = 14;
      if (frame) clearInterval(frame);
      frame = setInterval(() => {
        tick++;
        const settled = Math.floor((tick / totalTicks) * target.length);
        let out = target.slice(0, settled);
        for (let i = settled; i < target.length; i++) {
          out += target[i] === " " ? " " : CHARS[Math.floor(Math.random() * CHARS.length)];
        }
        setDisplay(out);
        if (tick >= totalTicks) {
          setDisplay(target);
          if (frame) clearInterval(frame);
        }
      }, 38);
    }, holdMs);
    return () => {
      clearInterval(cycle);
      if (frame) clearInterval(frame);
    };
  }, [words, holdMs]);
  return display;
}

/* ------------------------------ faux app UI ------------------------------ */

function MockBar({ w, light = false }: { w: string; light?: boolean }) {
  return (
    <div
      className="h-2 rounded-full"
      style={{ width: w, backgroundColor: light ? "rgba(255,255,255,0.14)" : "#e5e5ea" }}
    />
  );
}

function WindowChrome({ title }: { title: string }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b"
      style={{ borderColor: "rgba(255,255,255,0.08)" }}
    >
      <div className="flex gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#3a3a3e" }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#3a3a3e" }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#3a3a3e" }} />
      </div>
      <span className="font-mono text-[10px] tracking-[0.18em] uppercase" style={{ color: "#7a7a80" }}>
        {title}
      </span>
    </div>
  );
}

function MockReview() {
  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col p-4 gap-3 min-w-0">
        <div
          className="relative flex-1 rounded-lg flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #1d1d22 0%, #131316 60%, #1a1208 100%)" }}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "rgba(255,255,255,0.1)", backdropFilter: "blur(4px)" }}
          >
            <Play size={18} color="#fff" fill="#fff" />
          </div>
          <span
            className="absolute left-3 bottom-3 font-mono text-[10px] px-1.5 py-0.5 rounded"
            style={{ backgroundColor: "rgba(0,0,0,0.55)", color: "#fff" }}
          >
            00:42:17
          </span>
          <span
            className="absolute right-3 top-3 font-mono text-[9px] uppercase tracking-wider px-2 py-1 rounded-full"
            style={{ backgroundColor: "rgba(255,102,0,0.18)", color: "#ffb380" }}
          >
            v3 · ProRes
          </span>
        </div>
        {/* timeline with comment markers */}
        <div className="relative h-1.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}>
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: "38%", backgroundColor: ORANGE }} />
          {["22%", "38%", "61%", "84%"].map((left) => (
            <span
              key={left}
              className="absolute -top-[3px] w-2 h-2 rounded-full border"
              style={{ left, backgroundColor: "#fff", borderColor: ORANGE }}
            />
          ))}
        </div>
      </div>
      <div
        className="w-[38%] border-l p-4 flex-col gap-3 hidden sm:flex"
        style={{ borderColor: "rgba(255,255,255,0.08)" }}
      >
        {[
          { name: "Matt", time: "00:42", text: "That's great!", accent: true },
          { name: "Ana", time: "01:18", text: "Trim two frames here", accent: false },
        ].map((c) => (
          <div key={c.time} className="rounded-lg p-3" style={{ backgroundColor: "rgba(255,255,255,0.05)" }}>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white"
                style={{ backgroundColor: c.accent ? ORANGE : "#4a4a52" }}
              >
                {c.name[0]}
              </span>
              <span className="text-[11px] font-medium text-white">{c.name}</span>
              <span className="font-mono text-[9px] ml-auto" style={{ color: ORANGE }}>
                {c.time}
              </span>
            </div>
            <p className="text-[11px] leading-snug" style={{ color: "rgba(255,255,255,0.75)" }}>
              {c.text}
            </p>
          </div>
        ))}
        <div
          className="mt-auto rounded-full px-3 py-1.5 text-[10px] font-medium inline-flex items-center gap-1.5 self-start"
          style={{ backgroundColor: "rgba(41,199,64,0.15)", color: "#6fdd8b" }}
        >
          <Check size={11} /> Approved
        </div>
      </div>
    </div>
  );
}

function MockContracts() {
  return (
    <div className="flex h-full">
      <div className="flex-1 p-5 flex flex-col gap-2.5 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <FileText size={14} color="#9a9aa2" />
          <span className="text-[12px] font-medium text-white">Wedding film — master agreement</span>
          <span
            className="font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full ml-auto"
            style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#9a9aa2" }}
          >
            Frozen · SHA-256
          </span>
        </div>
        <MockBar w="92%" light />
        <MockBar w="86%" light />
        <MockBar w="64%" light />
        <div className="h-2" />
        <MockBar w="89%" light />
        <MockBar w="40%" light />
        <div
          className="mt-auto rounded-lg border border-dashed p-3 flex items-center justify-between"
          style={{ borderColor: "rgba(255,255,255,0.2)" }}
        >
          <span className="font-serif italic text-lg text-white">Maya R.</span>
          <span
            className="font-mono text-[9px] uppercase tracking-wider px-2 py-1 rounded-full inline-flex items-center gap-1"
            style={{ backgroundColor: "rgba(41,199,64,0.15)", color: "#6fdd8b" }}
          >
            <Check size={10} /> OTP verified
          </span>
        </div>
      </div>
      <div
        className="w-[34%] border-l p-4 font-mono text-[9px] leading-relaxed flex-col gap-2 hidden sm:flex"
        style={{ borderColor: "rgba(255,255,255,0.08)", color: "#7a7a80" }}
      >
        <span className="uppercase tracking-[0.18em]" style={{ color: "#9a9aa2" }}>
          Audit trail
        </span>
        <span>10:02 — terms frozen</span>
        <span>10:04 — link opened</span>
        <span>10:05 — consent recorded</span>
        <span style={{ color: "#6fdd8b" }}>10:06 — signed ✓</span>
      </div>
    </div>
  );
}

function MockDelivery() {
  return (
    <div className="p-5 flex flex-col gap-2.5 h-full">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[12px] font-medium text-white">Final delivery</span>
        <span
          className="font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full ml-auto inline-flex items-center gap-1"
          style={{ backgroundColor: "rgba(255,102,0,0.15)", color: "#ffb380" }}
        >
          <Lock size={9} /> Paywalled
        </span>
      </div>
      {[
        { name: "ceremony_master.mov", size: "38.2 GB" },
        { name: "highlights_4k.mp4", size: "9.1 GB" },
        { name: "socials_vertical.mp4", size: "1.4 GB" },
      ].map((f) => (
        <div
          key={f.name}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5"
          style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
        >
          <Play size={12} color="#9a9aa2" />
          <span className="font-mono text-[11px] text-white truncate">{f.name}</span>
          <span className="font-mono text-[10px] ml-auto shrink-0" style={{ color: "#7a7a80" }}>
            {f.size}
          </span>
          <Lock size={11} color="#7a7a80" className="shrink-0" />
        </div>
      ))}
      <div
        className="mt-auto self-center rounded-full px-5 py-2 text-[12px] font-medium text-white"
        style={{ backgroundColor: ORANGE }}
      >
        Pay $450 to unlock downloads
      </div>
    </div>
  );
}

function MockDrive() {
  return (
    <div className="p-5 flex flex-col gap-2.5 h-full">
      <div className="flex items-center gap-2 mb-1">
        <Folder size={14} color="#9a9aa2" />
        <span className="font-mono text-[11px] text-white">snip Drive — /clients/2026</span>
      </div>
      {[
        { name: "atlanta_brand_film/", note: "Streamed", green: false },
        { name: "rooftop_wedding/", note: "Streamed", green: false },
        { name: "campaign_q3_cuts/", note: "Synced ✓", green: true },
        { name: "raw_a7siii_cards/", note: "Streamed", green: false },
      ].map((f) => (
        <div
          key={f.name}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5"
          style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
        >
          <Folder size={12} color={ORANGE} />
          <span className="font-mono text-[11px] text-white truncate">{f.name}</span>
          <span
            className="font-mono text-[9px] uppercase tracking-wider ml-auto shrink-0"
            style={{ color: f.green ? "#6fdd8b" : "#7a7a80" }}
          >
            {f.note}
          </span>
        </div>
      ))}
      <p className="font-mono text-[10px] mt-auto" style={{ color: "#7a7a80" }}>
        Mounted as a local disk — bytes stream from the edge.
      </p>
    </div>
  );
}

const HERO_TABS = [
  { id: "review", label: "Review", Comp: MockReview },
  { id: "contracts", label: "Contracts", Comp: MockContracts },
  { id: "delivery", label: "Delivery", Comp: MockDelivery },
  { id: "drive", label: "Drive", Comp: MockDrive },
] as const;

/* --------------------------------- page ---------------------------------- */

export default function Homepage() {
  const [scrolled, setScrolled] = useState(false);
  const [tab, setTab] = useState<(typeof HERO_TABS)[number]["id"]>("review");
  const [stage, setStage] = useState(0);
  const { user, isSignedIn, isLoaded } = useUser();
  const navigate = useNavigate();
  const greeting =
    user?.firstName || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "Account";

  const rotating = useScrambleWords([
    "freelance editor.",
    "video agency.",
    "post house.",
    "wedding filmmaker.",
    "youtube studio.",
    "brand team.",
  ]);

  // Authed users skip the marketing page entirely. The landing page is for
  // acquisition; once you have an active session, "Home" is the app.
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [isLoaded, isSignedIn, navigate]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // The landing page is always light, regardless of the app theme. Force the
  // document chrome (scrollbar, overscroll) to match while mounted.
  useEffect(() => {
    const html = document.documentElement;
    const prevScheme = html.style.colorScheme;
    const prevBg = document.body.style.backgroundColor;
    html.style.colorScheme = "light";
    document.body.style.backgroundColor = "#ffffff";
    return () => {
      html.style.colorScheme = prevScheme;
      document.body.style.backgroundColor = prevBg;
    };
  }, []);

  // "First ten minutes" timeline auto-advance. Reduced motion: all steps lit.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStage(-1);
      return;
    }
    const t = setInterval(() => setStage((s) => (s + 1) % 3), 3000);
    return () => clearInterval(t);
  }, []);

  // Cycle the hero mock through its tabs until the visitor picks one.
  const userPickedTab = useRef(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => {
      if (userPickedTab.current) return;
      setTab((prev) => {
        const i = HERO_TABS.findIndex((h) => h.id === prev);
        return HERO_TABS[(i + 1) % HERO_TABS.length].id;
      });
    }, 4500);
    return () => clearInterval(t);
  }, []);

  const ActiveMock = HERO_TABS.find((t) => t.id === tab)!.Comp;

  const pill =
    "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors";

  return (
    <div
      className="min-h-screen"
      style={{
        backgroundColor: "#ffffff",
        color: INK,
        fontFamily: "'Inter Tight', 'Geist', system-ui, sans-serif",
        colorScheme: "light",
      }}
    >
      {/* Nav */}
      <nav
        className="fixed w-full top-0 z-50 transition-all duration-200"
        style={{
          backgroundColor: scrolled ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0)",
          backdropFilter: scrolled ? "blur(12px)" : "none",
          borderBottom: `1px solid ${scrolled ? LINE : "transparent"}`,
        }}
      >
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <span className="rounded-md overflow-hidden inline-flex">
              <SnipMark size={24} />
            </span>
            <span className="text-lg font-semibold tracking-tight">
              snip<span style={{ color: ORANGE }}>.</span>
            </span>
          </Link>
          <div className="hidden md:flex items-center gap-7 text-sm" style={{ color: GRAY }}>
            <a href="#product" className="hover:text-[#131315] transition-colors">
              Product
            </a>
            <a href="#pricing" className="hover:text-[#131315] transition-colors">
              Pricing
            </a>
            <Link to="/compare/frameio" className="hover:text-[#131315] transition-colors">
              Compare
            </Link>
            <a
              href="/downloads/snip-desktop.pkg"
              className="hover:text-[#131315] transition-colors inline-flex items-center gap-1.5"
              title="Download snip Desktop for macOS"
            >
              <Apple className="h-3.5 w-3.5" />
              Download
            </a>
          </div>
          <div className="ml-auto flex items-center gap-5 text-sm">
            {isSignedIn ? (
              <>
                <Link to="/dashboard" className="hover:opacity-70 transition-opacity" style={{ color: GRAY }}>
                  {greeting}
                </Link>
                <Link
                  to="/dashboard"
                  className={`${pill} px-4 py-2 text-white hover:opacity-90`}
                  style={{ backgroundColor: INK }}
                >
                  Open app
                </Link>
              </>
            ) : (
              <>
                <Link to="/sign-in" className="hover:text-[#131315] transition-colors" style={{ color: GRAY }}>
                  Log in
                </Link>
                <Link
                  to="/sign-up"
                  className={`${pill} px-4 py-2 text-white hover:opacity-90`}
                  style={{ backgroundColor: INK }}
                >
                  Start for free
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 pt-36 pb-16 text-center">
        <div className="max-w-4xl mx-auto flex flex-col items-center">
          <Reveal>
            <a
              href="https://github.com/danielosagie/snip"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors hover:border-[#FF6600]"
              style={{ borderColor: "#ffd9c2", backgroundColor: "#fff7f2", color: "#c2410c" }}
            >
              snip is open source<span className="hidden sm:inline"> — star it on GitHub</span>
              <ArrowUpRight size={12} />
            </a>
          </Reveal>
          <Reveal delay={80}>
            <h1
              className="mt-8 text-5xl sm:text-6xl md:text-[76px] font-medium leading-[1.02]"
              style={{ letterSpacing: "-0.035em" }}
            >
              Client review that<br className="hidden sm:block" /> just works better.
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-6 text-lg md:text-xl leading-relaxed max-w-2xl" style={{ color: GRAY }}>
              Frame-accurate review, contracts, and paid delivery for creative teams.
              One link does all of it — and your client never makes an account.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-8 flex flex-col sm:flex-row items-center gap-3">
              <Link
                to="/sign-up"
                className={`${pill} px-6 py-3 text-white hover:opacity-90`}
                style={{ backgroundColor: INK }}
              >
                Start for free
              </Link>
              <a
                href="/downloads/snip-desktop.pkg"
                className={`${pill} border px-6 py-3 hover:bg-[#fafafa]`}
                style={{ borderColor: LINE, color: INK }}
              >
                <Apple className="h-4 w-4" />
                Download for Mac
              </a>
            </div>
          </Reveal>
          <Reveal delay={320}>
            <div
              className="mt-12 flex flex-wrap justify-center gap-x-8 gap-y-2 font-mono text-[11px] uppercase tracking-[0.18em]"
              style={{ color: GRAY_LIGHT }}
            >
              <span>Open source</span>
              <span>Flat $25/mo</span>
              <span>Unlimited seats</span>
              <span>No per-user fees</span>
            </div>
          </Reveal>
        </div>

        {/* Product mock with tabs */}
        <Reveal delay={200} className="max-w-5xl mx-auto mt-12">
          <div
            role="tablist"
            aria-label="Product areas"
            className="grid grid-cols-4 border rounded-t-2xl overflow-hidden divide-x"
            style={{ borderColor: LINE, backgroundColor: "#fff" }}
          >
            {HERO_TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => {
                  userPickedTab.current = true;
                  setTab(t.id);
                }}
                className="relative px-2 py-3.5 font-mono text-[11px] sm:text-xs uppercase tracking-[0.16em] transition-colors"
                style={{
                  color: tab === t.id ? INK : GRAY_LIGHT,
                  backgroundColor: tab === t.id ? PANEL : "#fff",
                  borderColor: LINE,
                }}
              >
                {t.label}
                {tab === t.id && (
                  <span
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 w-10 h-[2px] rounded-full"
                    style={{ backgroundColor: ORANGE }}
                  />
                )}
              </button>
            ))}
          </div>
          <div
            className="border border-t-0 rounded-b-2xl overflow-hidden"
            style={{
              borderColor: LINE,
              backgroundColor: "#161618",
              boxShadow: "0 32px 64px -24px rgba(19,19,21,0.25)",
            }}
          >
            <WindowChrome title={`snip — ${tab}`} />
            <div className="h-[360px] sm:h-[420px]">
              <ActiveMock />
            </div>
          </div>
        </Reveal>
      </section>

      {/* Statement + four pillars */}
      <section className="px-6 py-24">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <h2
              className="text-center text-3xl sm:text-4xl md:text-[44px] font-medium leading-tight"
              style={{ letterSpacing: "-0.025em" }}
            >
              snip isn't just another review tool.
              <br />
              <span style={{ color: GRAY_LIGHT }}>It's everything your studio needs.</span>
            </h2>
          </Reveal>
          <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                icon: MessageSquare,
                caption: "Frame-accurate review",
                body: (
                  <div className="flex flex-col gap-2 w-full px-5">
                    <div className="relative h-1.5 rounded-full" style={{ backgroundColor: "#e5e5ea" }}>
                      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: "55%", backgroundColor: ORANGE }} />
                      {["30%", "55%", "78%"].map((l) => (
                        <span key={l} className="absolute -top-[3px] w-2 h-2 rounded-full border bg-white" style={{ left: l, borderColor: ORANGE }} />
                      ))}
                    </div>
                    <span className="font-mono text-[9px]" style={{ color: GRAY_LIGHT }}>
                      00:42:17 — “That's great!”
                    </span>
                  </div>
                ),
              },
              {
                icon: FileText,
                caption: "Contracts built in",
                body: (
                  <div className="flex flex-col gap-1.5 w-full px-5">
                    <MockBar w="90%" />
                    <MockBar w="70%" />
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="font-serif italic text-sm" style={{ color: INK }}>
                        Maya R.
                      </span>
                      <span className="font-mono text-[9px] inline-flex items-center gap-1" style={{ color: "#29c740" }}>
                        <Check size={9} /> Signed
                      </span>
                    </div>
                  </div>
                ),
              },
              {
                icon: Lock,
                caption: "Paid delivery",
                body: (
                  <div className="flex flex-col gap-2 w-full px-5 items-center">
                    <div className="flex items-center gap-2 w-full rounded-md px-2.5 py-2" style={{ backgroundColor: "#fff" }}>
                      <Play size={10} color={GRAY_LIGHT} />
                      <span className="font-mono text-[9px] truncate" style={{ color: GRAY }}>
                        final_master.mov
                      </span>
                      <Lock size={9} color={GRAY_LIGHT} className="ml-auto" />
                    </div>
                    <span className="rounded-full px-3 py-1 text-[10px] font-medium text-white" style={{ backgroundColor: ORANGE }}>
                      Pay to unlock
                    </span>
                  </div>
                ),
              },
              {
                icon: Folder,
                caption: "Cloud drive included",
                body: (
                  <div className="flex flex-col gap-1.5 w-full px-5">
                    {["clients/2026/", "raw_footage/"].map((n) => (
                      <div key={n} className="flex items-center gap-2 w-full rounded-md px-2.5 py-2" style={{ backgroundColor: "#fff" }}>
                        <Folder size={10} color={ORANGE} />
                        <span className="font-mono text-[9px]" style={{ color: GRAY }}>
                          {n}
                        </span>
                        <span className="font-mono text-[8px] uppercase ml-auto" style={{ color: GRAY_LIGHT }}>
                          streamed
                        </span>
                      </div>
                    ))}
                  </div>
                ),
              },
            ].map((card, i) => (
              <Reveal key={card.caption} delay={i * 80}>
                <div
                  className="rounded-2xl border overflow-hidden transition-shadow hover:shadow-lg"
                  style={{ borderColor: LINE, backgroundColor: "#fff", boxShadow: "0 1px 2px rgba(19,19,21,0.04)" }}
                >
                  <div
                    className="h-36 flex items-center justify-center"
                    style={{ backgroundColor: PANEL, borderBottom: `1px solid ${LINE}` }}
                  >
                    {card.body}
                  </div>
                  <div className="px-5 py-4 flex items-center gap-2.5">
                    <card.icon size={14} color={GRAY} className="shrink-0" />
                    <span className="text-sm font-medium">{card.caption}</span>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Bento — introducing snip */}
      <section id="product" className="px-6 py-24" style={{ backgroundColor: PANEL }}>
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <Eyebrow>Introducing snip</Eyebrow>
            <h2
              className="mt-5 text-3xl sm:text-4xl md:text-[44px] font-medium leading-tight max-w-3xl"
              style={{ letterSpacing: "-0.025em" }}
            >
              A review suite that works like you do.
              <br />
              <span style={{ color: GRAY_LIGHT }}>Built by editors, for editors.</span>
            </h2>
          </Reveal>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-5">
            <Reveal>
              <div
                className="rounded-2xl border p-7 h-full flex flex-col transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
                style={{ borderColor: LINE, backgroundColor: "#fff" }}
              >
                <h3 className="text-xl font-semibold tracking-tight">Review without the back-and-forth</h3>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: GRAY }}>
                  Comments pin to the exact frame. Threads resolve in place, and markers
                  export straight to your NLE — no more “the part around two minutes in.”
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {[
                    { label: "Matt", dot: true },
                    { label: "“That's great!”" },
                    { label: "ProRes" },
                    { label: "Cinematic" },
                    { label: "✓ Approved", green: true },
                  ].map((chip) => (
                    <span
                      key={chip.label}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium"
                      style={{
                        borderColor: chip.green ? "#bbe7c4" : LINE,
                        color: chip.green ? "#1d9e36" : INK,
                        backgroundColor: chip.green ? "#f1fbf3" : "#fff",
                      }}
                    >
                      {chip.dot && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ORANGE }} />}
                      {chip.label}
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div
                className="rounded-2xl border p-7 h-full flex flex-col transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
                style={{ borderColor: LINE, backgroundColor: "#fff" }}
              >
                <h3 className="text-xl font-semibold tracking-tight">Contracts clients actually sign</h3>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: GRAY }}>
                  Freeze the terms, verify by one-time code, and keep a court-grade audit
                  trail — consent, hashes, and signatures in the same link as the cut.
                </p>
                <div className="mt-6 rounded-xl border border-dashed p-4 flex items-center justify-between" style={{ borderColor: "#d9d9de" }}>
                  <span className="font-serif italic text-xl">Maya R.</span>
                  <span
                    className="font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full inline-flex items-center gap-1"
                    style={{ backgroundColor: "#f1fbf3", color: "#1d9e36" }}
                  >
                    <Check size={10} /> OTP verified
                  </span>
                </div>
              </div>
            </Reveal>
            <Reveal>
              <div
                className="rounded-2xl border p-7 h-full flex flex-col transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
                style={{ borderColor: LINE, backgroundColor: "#fff" }}
              >
                <h3 className="text-xl font-semibold tracking-tight">Get paid before the download</h3>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: GRAY }}>
                  Put final delivery behind a paywall. Clients watch a watermarked preview
                  until the invoice clears — then downloads unlock themselves.
                </p>
                <div className="mt-6 flex items-center gap-3 rounded-xl px-4 py-3" style={{ backgroundColor: PANEL }}>
                  <Lock size={13} color={GRAY} />
                  <span className="font-mono text-[11px]" style={{ color: GRAY }}>
                    highlights_4k.mp4
                  </span>
                  <span className="ml-auto rounded-full px-3 py-1 text-[11px] font-medium text-white" style={{ backgroundColor: ORANGE }}>
                    $450 to unlock
                  </span>
                </div>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div
                className="rounded-2xl border p-7 h-full flex flex-col transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
                style={{ borderColor: LINE, backgroundColor: "#fff" }}
              >
                <h3 className="text-xl font-semibold tracking-tight">Stream the cloud, locally</h3>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: GRAY }}>
                  Mount your whole library like a local disk. Bytes stream straight from
                  the edge — open a 40GB master without downloading it first.
                </p>
                <div className="mt-6 flex flex-col gap-2">
                  {["clients/2026/rooftop_wedding/", "raw_a7siii_cards/"].map((n) => (
                    <div key={n} className="flex items-center gap-2.5 rounded-xl px-4 py-2.5" style={{ backgroundColor: PANEL }}>
                      <Folder size={12} color={ORANGE} />
                      <span className="font-mono text-[11px]" style={{ color: GRAY }}>
                        {n}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-wider ml-auto" style={{ color: GRAY_LIGHT }}>
                        streamed
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Rotating words */}
      <section className="px-6 py-24">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <Eyebrow>End-to-end workflows</Eyebrow>
            <h2
              className="mt-5 text-3xl sm:text-4xl md:text-[44px] font-medium leading-tight"
              style={{ letterSpacing: "-0.025em" }}
            >
              snip powers your favorite{" "}
              <span className="font-mono" style={{ color: GRAY_LIGHT, letterSpacing: "-0.01em" }}>
                {rotating}
              </span>
            </h2>
          </Reveal>
        </div>
      </section>

      {/* Use cases — shade's industry-rows pattern */}
      <section className="px-6 pb-24">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <Eyebrow>Every workflow</Eyebrow>
            <h2
              className="mt-5 text-3xl sm:text-4xl md:text-[44px] font-medium leading-tight"
              style={{ letterSpacing: "-0.025em" }}
            >
              Powering small teams with big clients.
              <br />
              <span style={{ color: GRAY_LIGHT }}>See how snip fits your workflow.</span>
            </h2>
          </Reveal>
          <div className="mt-12 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-10 items-stretch">
            <Reveal>
              <div className="border-t" style={{ borderColor: LINE }}>
                {[
                  {
                    title: "Video editors",
                    desc: "Cuts reviewed and approved without the email chain.",
                    to: "/for/video-editors",
                  },
                  {
                    title: "Agencies",
                    desc: "Every client, every project, one flat bill.",
                    to: "/for/agencies",
                  },
                  {
                    title: "Wedding & event filmmakers",
                    desc: "Paywalled finals that collect the balance for you.",
                    to: "/sign-up",
                  },
                  {
                    title: "YouTube & podcast teams",
                    desc: "One drive for raw cards, cuts, and published masters.",
                    to: "/sign-up",
                  },
                ].map((row) => (
                  <Link
                    key={row.title}
                    to={row.to}
                    className="group flex items-center justify-between gap-6 py-5 border-b transition-colors hover:bg-[#fafafa]"
                    style={{ borderColor: LINE }}
                  >
                    <div>
                      <div className="font-medium text-lg">{row.title}</div>
                      <div className="text-sm mt-0.5" style={{ color: GRAY }}>
                        {row.desc}
                      </div>
                    </div>
                    <ArrowUpRight
                      size={18}
                      className="shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      color={GRAY_LIGHT}
                    />
                  </Link>
                ))}
              </div>
            </Reveal>
            <Reveal delay={120} className="hidden lg:block">
              <div className="rounded-2xl overflow-hidden h-full min-h-[300px] border" style={{ borderColor: LINE }}>
                <img
                  src="/sandy-bg.jpg"
                  alt="Creative team filming on location"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="px-6 py-24" style={{ backgroundColor: PANEL }}>
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <Eyebrow>The rival</Eyebrow>
            <h2
              className="mt-5 text-3xl sm:text-4xl md:text-[44px] font-medium leading-tight"
              style={{ letterSpacing: "-0.025em" }}
            >
              Everything you use Frame.io for.
              <br />
              <span style={{ color: GRAY_LIGHT }}>One flat price, whole team in.</span>
            </h2>
          </Reveal>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-5">
            <Reveal>
              <div className="rounded-2xl border p-8 h-full" style={{ borderColor: LINE, backgroundColor: "#fff" }}>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: GRAY_LIGHT }}>
                  The other guys
                </div>
                <div className="mt-2 text-3xl font-semibold tracking-tight">Frame.io</div>
                <div className="mt-6 flex items-baseline gap-2">
                  <span className="text-4xl font-semibold tracking-tight">$19</span>
                  <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: GRAY_LIGHT }}>
                    per user / month
                  </span>
                </div>
                <ul className="mt-8 space-y-3.5 text-[15px]" style={{ color: GRAY }}>
                  {["Complex interface", "Punishes you for growing", "Bloated ecosystem", "Closed source"].map((x) => (
                    <li key={x} className="flex items-center gap-3">
                      <span className="font-mono" style={{ color: "#d4d4d8" }}>
                        ×
                      </span>
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div className="rounded-2xl p-8 h-full text-white" style={{ backgroundColor: "#0a0a0b" }}>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "#ffb380" }}>
                  The solution
                </div>
                <div className="mt-2 text-3xl font-semibold tracking-tight">
                  snip<span style={{ color: ORANGE }}>.</span>
                </div>
                <div className="mt-6 flex items-baseline gap-2">
                  <span className="text-4xl font-semibold tracking-tight">$25</span>
                  <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.45)" }}>
                    flat total / month
                  </span>
                </div>
                <ul className="mt-8 space-y-3.5 text-[15px]" style={{ color: "rgba(255,255,255,0.8)" }}>
                  {["Stupidly fast", "Invite the whole team", "Just what you need", "Fully open source"].map((x) => (
                    <li key={x} className="flex items-center gap-3">
                      <Check size={14} color={ORANGE} />
                      {x}
                    </li>
                  ))}
                </ul>
                <div className="mt-8 pt-6 border-t" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] block" style={{ color: "rgba(255,255,255,0.45)" }}>
                    Yearly savings · 5 users
                  </span>
                  <span className="text-3xl font-semibold tracking-tight" style={{ color: "#ffb380" }}>
                    $840
                  </span>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* First ten minutes */}
      <section className="px-6 py-24">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <Eyebrow>How it works</Eyebrow>
            <h2
              className="mt-5 text-3xl sm:text-4xl md:text-[44px] font-medium leading-tight"
              style={{ letterSpacing: "-0.025em" }}
            >
              Your first ten minutes on snip, painless.
              <br />
              <span style={{ color: GRAY_LIGHT }}>No onboarding call required.</span>
            </h2>
          </Reveal>
          <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-10">
            {[
              {
                min: "Min 1",
                title: "Upload your cut.",
                desc: "Drag the file in. Playback starts from the original instantly — no waiting on processing bars.",
              },
              {
                min: "Min 3",
                title: "Send one link.",
                desc: "Your client reviews, signs the contract, and pays in the same place. No account required.",
              },
              {
                min: "Min 10",
                title: "Approved, signed, paid.",
                desc: "Frame-accurate notes are in, the contract is countersigned, and delivery unlocks itself.",
              },
            ].map((s, i) => (
              <div
                key={s.min}
                className="transition-opacity duration-700"
                style={{ opacity: stage === i || stage < 0 ? 1 : 0.3 }}
              >
                <div className="font-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: stage === i || stage < 0 ? ORANGE : GRAY_LIGHT }}>
                  {s.min}
                </div>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed" style={{ color: GRAY }}>
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
          {/* progress rail */}
          <div className="mt-12 relative h-[2px]" style={{ backgroundColor: LINE }}>
            <div
              className="absolute inset-y-0 left-0 transition-all duration-700"
              style={{ width: `${stage < 0 ? 100 : ((stage + 1) / 3) * 100}%`, backgroundColor: INK }}
            />
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 border bg-white"
                style={{ left: `${(i / 3) * 100}%`, borderColor: stage >= i || stage < 0 ? INK : LINE }}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Trust — shade's compliance-ticket strip, snip-flavored */}
      <section className="py-24 overflow-hidden" style={{ backgroundColor: PANEL }}>
        <div className="max-w-5xl mx-auto px-6">
          <Reveal>
            <h2
              className="text-center text-3xl sm:text-4xl md:text-[44px] font-medium leading-tight"
              style={{ letterSpacing: "-0.025em" }}
            >
              Built to protect the work.
              <br />
              <span style={{ color: GRAY_LIGHT }}>And make sure you get paid for it.</span>
            </h2>
          </Reveal>
        </div>
        <Reveal delay={120}>
          <div className="mt-14 relative">
            <div className="snip-marquee flex w-max gap-5 pr-5">
              {[0, 1].map((dup) => (
                <div key={dup} className="flex gap-5" aria-hidden={dup === 1}>
                  {[
                    { Icon: Hash, tint: "#eef4ff", title: "SHA-256 frozen terms", desc: "Contract terms are hashed and locked the moment you send them." },
                    { Icon: KeyRound, tint: "#f3fbf4", title: "OTP-verified signing", desc: "Signers confirm identity with a one-time code — no accounts." },
                    { Icon: ScrollText, tint: "#fff7f2", title: "Full audit trail", desc: "Every open, consent, and signature is timestamped and kept." },
                    { Icon: EyeOff, tint: "#f7f5ff", title: "Watermarked previews", desc: "Paywalled shares never serve the raw original file." },
                    { Icon: CreditCard, tint: "#f3fbf4", title: "Payments by Stripe", desc: "Checkout and payouts run on Stripe end to end." },
                    { Icon: Zap, tint: "#fff7f2", title: "Streams from the edge", desc: "Bytes come straight from edge storage — no proxy in the way." },
                    { Icon: Github, tint: "#f5f5f6", title: "Open source", desc: "The whole codebase is on GitHub. Read it, fork it, trust it." },
                  ].map((t, i) => (
                    <div
                      key={t.title}
                      className="w-[270px] shrink-0 rounded-xl border bg-white p-5"
                      style={{
                        borderColor: LINE,
                        transform: `rotate(${i % 2 === 0 ? "-1.2deg" : "1.2deg"})`,
                        boxShadow: "0 1px 2px rgba(19,19,21,0.05)",
                      }}
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                        style={{ backgroundColor: t.tint }}
                      >
                        <t.Icon size={15} color={INK} />
                      </div>
                      <div className="text-sm font-medium">{t.title}</div>
                      <p className="text-[12px] leading-relaxed mt-1" style={{ color: GRAY }}>
                        {t.desc}
                      </p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {/* edge fades */}
            <div className="pointer-events-none absolute inset-y-0 left-0 w-24" style={{ background: `linear-gradient(to right, ${PANEL}, transparent)` }} />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-24" style={{ background: `linear-gradient(to left, ${PANEL}, transparent)` }} />
          </div>
        </Reveal>
        <style>{`
          @keyframes snip-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
          .snip-marquee { animation: snip-marquee 42s linear infinite; }
          @media (prefers-reduced-motion: reduce) { .snip-marquee { animation: none; } }
        `}</style>
      </section>

      {/* Quote */}
      <section className="px-6 py-24" style={{ backgroundColor: "#ffffff" }}>
        <div className="max-w-3xl mx-auto text-center">
          <Reveal>
            <blockquote
              className="text-2xl sm:text-3xl md:text-[34px] font-medium leading-snug"
              style={{ letterSpacing: "-0.02em" }}
            >
              “I built snip because I got tired of waiting for Frame.io to load.
              Video review should be <span style={{ color: ORANGE }}>instant</span>.”
            </blockquote>
            <div className="mt-6 font-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: GRAY }}>
              — Casey Lund, founder
            </div>
          </Reveal>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-6 py-24">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <Eyebrow>Pricing</Eyebrow>
            <h2
              className="mt-5 text-3xl sm:text-4xl md:text-[44px] font-medium leading-tight"
              style={{ letterSpacing: "-0.025em" }}
            >
              Flat pricing. No seat math.
              <br />
              <span style={{ color: GRAY_LIGHT }}>Your whole team, one number.</span>
            </h2>
          </Reveal>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-5 max-w-3xl">
            <Reveal>
              <div className="rounded-2xl border p-8 h-full flex flex-col" style={{ borderColor: LINE, backgroundColor: "#fff" }}>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: GRAY_LIGHT }}>
                  Basic
                </div>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-5xl font-semibold tracking-tight">$25</span>
                  <span className="text-lg" style={{ color: GRAY_LIGHT }}>
                    /mo
                  </span>
                </div>
                <p className="mt-3 text-[15px]" style={{ color: GRAY }}>
                  Unlimited everything, except storage.
                </p>
                <ul className="mt-7 space-y-3 text-[15px] flex-grow">
                  {["Unlimited seats", "Unlimited projects", "Unlimited clients", "100GB storage"].map((f) => (
                    <li key={f} className="flex items-center gap-3">
                      <Check size={14} color={ORANGE} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/sign-up"
                  className={`${pill} mt-8 px-5 py-3 text-white hover:opacity-90 w-full`}
                  style={{ backgroundColor: INK }}
                >
                  Get Basic
                </Link>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div className="rounded-2xl p-8 h-full flex flex-col text-white" style={{ backgroundColor: "#0a0a0b" }}>
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "#ffb380" }}>
                    Pro
                  </div>
                  <span className="rounded-full px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider" style={{ backgroundColor: ORANGE }}>
                    Big files
                  </span>
                </div>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-5xl font-semibold tracking-tight">$50</span>
                  <span className="text-lg" style={{ color: "rgba(255,255,255,0.45)" }}>
                    /mo
                  </span>
                </div>
                <p className="mt-3 text-[15px]" style={{ color: "rgba(255,255,255,0.7)" }}>
                  Literally the same thing, but more space.
                </p>
                <ul className="mt-7 space-y-3 text-[15px] flex-grow" style={{ color: "rgba(255,255,255,0.85)" }}>
                  {["Unlimited seats", "Unlimited projects", "Unlimited clients", "1TB storage (whoa)"].map((f) => (
                    <li key={f} className="flex items-center gap-3">
                      <Check size={14} color={ORANGE} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/sign-up"
                  className={`${pill} mt-8 px-5 py-3 w-full hover:opacity-90`}
                  style={{ backgroundColor: "#fff", color: INK }}
                >
                  Get Pro
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-6 pb-24">
        <Reveal className="max-w-6xl mx-auto">
          <div
            className="relative rounded-3xl overflow-hidden text-center text-white px-6 pt-20 pb-44 sm:pb-52"
            style={{ backgroundColor: "#0a0a0b" }}
          >
            <Eyebrow light>Start today</Eyebrow>
            <h2
              className="mt-6 text-4xl sm:text-5xl md:text-6xl font-medium leading-tight"
              style={{ letterSpacing: "-0.03em" }}
            >
              Stop chasing. Start creating
              <span style={{ color: ORANGE }}>.</span>
            </h2>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/sign-up"
                className={`${pill} px-6 py-3 hover:opacity-90`}
                style={{ backgroundColor: "#fff", color: INK }}
              >
                Start for free
              </Link>
              <a
                href="#pricing"
                className={`${pill} border px-6 py-3 text-white hover:bg-white/10`}
                style={{ borderColor: "rgba(255,255,255,0.25)" }}
              >
                See pricing
              </a>
            </div>
            {/* photo cards peeking from the bottom, shade-style */}
            <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex gap-5 w-[120%] sm:w-[90%] justify-center pointer-events-none">
              {[
                { src: "/sandy-bg.jpg", rot: "-5deg", pos: "0% 20%", y: "14px", zoom: "140%" },
                { src: "/grassy-bg.avif", rot: "2deg", pos: "50% 70%", y: "0px", zoom: "100%" },
                { src: "/sandy-bg.jpg", rot: "-2deg", pos: "100% 80%", y: "18px", zoom: "200%" },
                { src: "/grassy-bg.avif", rot: "5deg", pos: "15% 30%", y: "6px", zoom: "170%" },
              ].map((p, i) => (
                <div
                  key={i}
                  className={`w-44 h-32 sm:w-56 sm:h-40 rounded-xl overflow-hidden border-4 border-white shadow-2xl shrink-0 ${i > 2 ? "hidden md:block" : ""}`}
                  style={{ transform: `rotate(${p.rot}) translateY(${p.y})` }}
                >
                  <img
                    src={p.src}
                    alt=""
                    className="w-full h-full object-cover"
                    style={{ objectPosition: p.pos, width: p.zoom, height: p.zoom, maxWidth: "none" }}
                    loading="lazy"
                  />
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* Footer — shade-style mono bracket links */}
      <footer className="px-6 pt-16 pb-10 border-t" style={{ borderColor: LINE, backgroundColor: "#fff" }}>
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-16">
            {(
              [
                {
                  head: "Features",
                  links: [
                    { label: "Frame review", href: "#product" },
                    { label: "Contracts", href: "#product" },
                    { label: "Paid delivery", href: "#product" },
                    { label: "Cloud drive", href: "#product" },
                  ],
                },
                {
                  head: "Compare",
                  links: [
                    { label: "vs Frame.io", to: "/compare/frameio" },
                    { label: "vs Wipster", to: "/compare/wipster" },
                    { label: "vs LucidLink", to: "/compare/lucidlink" },
                  ],
                },
                {
                  head: "Use cases",
                  links: [
                    { label: "Video editors", to: "/for/video-editors" },
                    { label: "Agencies", to: "/for/agencies" },
                  ],
                },
                {
                  head: "General",
                  links: [
                    { label: "Pricing", to: "/pricing" },
                    { label: "Sign in", to: "/sign-in" },
                    { label: "Start free", to: "/sign-up" },
                    { label: "GitHub", href: "https://github.com/danielosagie/snip", external: true },
                  ],
                },
              ] as const
            ).map((col) => (
              <div key={col.head}>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] mb-4 flex items-center gap-2" style={{ color: GRAY_LIGHT }}>
                  <Folder size={11} />
                  {col.head}
                </div>
                <ul className="space-y-2.5">
                  {col.links.map((l) => {
                    const inner = (
                      <>
                        <span style={{ color: GRAY_LIGHT }}>[&nbsp;]</span> {l.label}
                      </>
                    );
                    const cls = "font-mono text-[12px] transition-colors hover:text-[#FF6600]";
                    return (
                      <li key={l.label}>
                        {"to" in l && l.to ? (
                          <Link to={l.to} className={cls} style={{ color: GRAY }}>
                            {inner}
                          </Link>
                        ) : (
                          <a
                            href={"href" in l ? l.href : "#"}
                            className={cls}
                            style={{ color: GRAY }}
                            {...("external" in l && l.external
                              ? { target: "_blank", rel: "noopener noreferrer" }
                              : {})}
                          >
                            {inner}
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <div className="border-t pt-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-5" style={{ borderColor: LINE }}>
            <div className="flex items-center gap-2.5">
              <span className="rounded-md overflow-hidden inline-flex">
                <SnipMark size={28} />
              </span>
              <span className="text-2xl font-semibold tracking-tight">
                snip<span style={{ color: ORANGE }}>.</span>
              </span>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: GRAY_LIGHT }}>
              Video review for creative teams — open source forever
            </span>
          </div>
        </div>
      </footer>

      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "snip",
            description:
              "Video review and collaboration for creative teams. Frame-accurate comments, unlimited seats, flat pricing.",
            url: "https://snipfilm.vercel.app",
            applicationCategory: "MultimediaApplication",
            operatingSystem: "Web",
            offers: [
              {
                "@type": "Offer",
                name: "Basic",
                price: "25.00",
                priceCurrency: "USD",
                description:
                  "Unlimited seats, unlimited projects, unlimited clients, 100GB storage",
              },
              {
                "@type": "Offer",
                name: "Pro",
                price: "50.00",
                priceCurrency: "USD",
                description:
                  "Unlimited seats, unlimited projects, unlimited clients, 1TB storage",
              },
            ],
            creator: {
              "@type": "Person",
              name: "Casey Lund",
            },
          }),
        }}
      />
    </div>
  );
}
