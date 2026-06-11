"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  useState,
} from "react";
import { Check, Moon, Sun } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const THEME_STORAGE_KEY = "snip-theme";
const LEGACY_THEME_STORAGE_KEY = "lawn-theme";
const STYLE_STORAGE_KEY = "snip-style";

type Theme = "light" | "dark";
type Style = "classic" | "soft";

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getInitialTheme(): Theme {
  if (typeof document === "undefined") return "light";

  const attributeTheme = document.documentElement.getAttribute("data-theme");
  if (attributeTheme === "dark" || attributeTheme === "light") {
    return attributeTheme;
  }

  const storedTheme =
    localStorage.getItem(THEME_STORAGE_KEY) ??
    localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }

  return getSystemTheme();
}

function getInitialStyle(): Style {
  if (typeof document === "undefined") return "classic";

  const attributeStyle = document.documentElement.getAttribute("data-style");
  if (attributeStyle === "classic" || attributeStyle === "soft") {
    return attributeStyle;
  }

  const storedStyle = localStorage.getItem(STYLE_STORAGE_KEY);
  if (storedStyle === "classic" || storedStyle === "soft") {
    return storedStyle;
  }

  return "classic";
}

interface ThemeContextValue {
  theme: Theme;
  style: Style;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setStyle: (style: Style) => void;
  mounted: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const emptySubscribe = () => () => {};

function useMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [style, setStyle] = useState<Style>(() => getInitialStyle());
  const mounted = useMounted();

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [mounted, theme]);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-style", style);
    localStorage.setItem(STYLE_STORAGE_KEY, style);
  }, [mounted, style]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  // Keyboard shortcut: Ctrl/Cmd + Shift + L
  useEffect(() => {
    if (!mounted) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        toggleTheme();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mounted, toggleTheme]);

  const value = useMemo(
    () => ({ theme, style, toggleTheme, setTheme, setStyle, mounted }),
    [theme, style, toggleTheme, mounted]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

const THEME_STYLE_OPTIONS: ReadonlyArray<{
  theme: Theme;
  style: Style;
  label: string;
}> = [
  { theme: "light", style: "classic", label: "Light · Classic" },
  { theme: "light", style: "soft", label: "Light · Soft" },
  { theme: "dark", style: "classic", label: "Dark · Classic" },
  { theme: "dark", style: "soft", label: "Dark · Soft" },
];

/**
 * Theme + style switcher. Renders a Moon/Sun trigger (style it via
 * `className`) that opens a popover listing the four theme × style
 * combos: Light/Dark × Classic/Soft. Each option sets both at once.
 */
export function ThemeStyleToggle({ className }: { className?: string }) {
  const { theme, style, setTheme, setStyle, mounted } = useTheme();
  const [open, setOpen] = useState(false);

  if (!mounted) {
    return (
      <span className={className} aria-hidden="true">
        <span className="block h-4 w-4" />
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={className}
          title="Theme & style (⌘⇧L toggles light/dark)"
          aria-label="Theme and style options"
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-56 p-1">
        <div role="radiogroup" aria-label="Theme and style">
          {THEME_STYLE_OPTIONS.map((option) => {
            const active = option.theme === theme && option.style === style;
            return (
              <button
                key={`${option.theme}-${option.style}`}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setTheme(option.theme);
                  setStyle(option.style);
                  setOpen(false);
                }}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-[#1a1a1a] hover:bg-[#e8e8e0] transition-colors"
              >
                <span>{option.label}</span>
                {active ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <span className="h-3.5 w-3.5" />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
