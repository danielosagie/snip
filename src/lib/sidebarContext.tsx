import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * Sidebar open/collapsed state, shared between the sidebar itself
 * and the header (which renders the toggle button).
 *
 * Persists to localStorage so a collapse survives page reloads.
 */
interface SidebarContextValue {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
}

const Ctx = createContext<SidebarContextValue | null>(null);
const STORAGE_KEY = "snip:sidebar:collapsed";
const LEGACY_STORAGE_KEY = "lawn:sidebar:collapsed";

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);

  // Hydrate from localStorage after mount — SSR-safe.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored =
        window.localStorage.getItem(STORAGE_KEY) ??
        window.localStorage.getItem(LEGACY_STORAGE_KEY);
      setCollapsedState(stored === "1");
    } catch {
      // localStorage may be blocked; fall back to default state.
    }
  }, []);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      // ignored
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  return (
    <Ctx.Provider value={{ collapsed, toggle, setCollapsed }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSidebarState() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Outside the provider — safe defaults (sidebar shown, no-op toggle).
    return {
      collapsed: false,
      toggle: () => {},
      setCollapsed: () => {},
    } as SidebarContextValue;
  }
  return ctx;
}
