import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { SnipMark } from "@/components/SnipMark";

export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 z-50 flex w-full items-center justify-between border-b border-[#E8E8EC] px-6 py-3 text-[#131315] transition-[background-color,backdrop-filter] duration-200 ${scrolled ? "bg-white/95 backdrop-blur-md" : "bg-white"}`}
    >
      <div className="flex items-center">
        <Link to="/" className="flex items-center gap-2 text-xl font-bold tracking-[-0.03em]">
          <span className="inline-flex overflow-hidden rounded-[7px]">
            <SnipMark size={24} />
          </span>
          <span>snip.</span>
        </Link>
      </div>
      <div className="flex items-center gap-6 text-sm font-medium">
        <Link
          to="/pricing"
          className="hover:underline underline-offset-4 hidden sm:block"
        >
          Pricing
        </Link>
        <Link
          to="/compare/frameio"
          className="hover:underline underline-offset-4 hidden sm:block"
        >
          Compare
        </Link>
        <Link to="/sign-in" className="hover:underline underline-offset-4">
          Log in
        </Link>
        <Link
          to="/sign-up"
          className="min-h-10 rounded-full bg-[#131315] px-4 py-2 text-white transition-[opacity,transform] hover:opacity-90 active:scale-[0.96]"
        >
          Start
        </Link>
      </div>
    </nav>
  );
}
