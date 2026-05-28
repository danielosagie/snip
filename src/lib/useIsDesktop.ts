import { useEffect, useState } from "react";

/**
 * True when the web app is running inside the snip desktop shell (the Electron
 * preload injects window.snipDesktop + window.api). False in a plain browser
 * and during SSR. Starts false and flips on after mount so server and first
 * client render agree.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsDesktop(Boolean(window.snipDesktop?.isDesktop && window.api));
  }, []);
  return isDesktop;
}
