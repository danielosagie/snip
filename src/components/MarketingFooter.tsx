import { Link } from "@tanstack/react-router";
import { SnipMark } from "@/components/SnipMark";

export function MarketingFooter() {
  return (
    <footer className="border-t border-[#E8E8EC] bg-white px-6 py-16 text-[#131315]">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-16">
          <div>
            <h3 className="mb-4 font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
              Product
            </h3>
            <ul className="space-y-3 text-sm font-medium">
              <li>
                <Link
                  to="/pricing"
                  className="transition-colors hover:text-[#D14E00]"
                >
                  Pricing
                </Link>
              </li>
              <li>
                <Link
                  to="/sign-up"
                  className="transition-colors hover:text-[#D14E00]"
                >
                  Start free trial
                </Link>
              </li>
              <li>
                <Link
                  to="/sign-in"
                  className="transition-colors hover:text-[#D14E00]"
                >
                  Sign in
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="mb-4 font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
              Compare
            </h3>
            <ul className="space-y-3 text-sm font-medium">
              <li>
                <Link
                  to="/compare/frameio"
                  className="transition-colors hover:text-[#D14E00]"
                >
                  snip vs Frame.io
                </Link>
              </li>
              <li>
                <Link
                  to="/compare/wipster"
                  className="transition-colors hover:text-[#D14E00]"
                >
                  snip vs Wipster
                </Link>
              </li>
              <li>
                <Link
                  to="/compare/lucidlink"
                  className="transition-colors hover:text-[#D14E00]"
                >
                  snip vs LucidLink
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="mb-4 font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
              Use cases
            </h3>
            <ul className="space-y-3 text-sm font-medium">
              <li>
                <Link
                  to="/for/video-editors"
                  className="transition-colors hover:text-[#D14E00]"
                >
                  For video editors
                </Link>
              </li>
              <li>
                <Link
                  to="/for/agencies"
                  className="transition-colors hover:text-[#D14E00]"
                >
                  For agencies
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="mb-4 font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
              Open source
            </h3>
            <ul className="space-y-3 text-sm font-medium">
              <li>
                <a
                  href="https://github.com/danielosagie/snip"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-[#D14E00]"
                >
                  GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="flex flex-col items-center justify-between gap-4 border-t border-[#F1F1F3] pt-8 md:flex-row">
          <div className="flex items-center gap-3">
            <span className="inline-flex overflow-hidden rounded-[9px]">
              <SnipMark size={32} />
            </span>
            <span className="text-3xl font-bold tracking-[-0.03em]">snip.</span>
          </div>
          <span className="text-sm text-[#6E6E73]">
            Video review for creative teams.
          </span>
        </div>
      </div>
    </footer>
  );
}
