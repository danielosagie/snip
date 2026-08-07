import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#FAFAFA] p-6 font-sans text-[#131315]">
      <div className="relative z-10 flex w-full max-w-xl flex-col items-start rounded-[14px] border border-[#E8E8EC] bg-white p-8 md:p-10">
        <div className="mb-4 font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
          Error 404
        </div>

        <h1 className="mb-3 text-[32px] font-semibold leading-10 tracking-[-0.02em]">
          Page not found
        </h1>

        <p className="mb-8 max-w-md text-sm leading-5 text-[#6E6E73]">
          The requested path doesn't exist. It may have moved, been deleted,
          or the URL is incorrect.
        </p>

        <Link
          to="/"
          className="inline-flex h-9 items-center justify-center rounded-full bg-[#131315] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#131315] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#131315] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        >
          Go home
        </Link>
      </div>

      <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 w-full -translate-x-1/2 -translate-y-1/2 select-none overflow-hidden text-center text-[35vw] font-semibold tracking-tighter text-[#F1F1F3]">
        404
      </div>
    </div>
  );
}
