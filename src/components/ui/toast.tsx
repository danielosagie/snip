"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "default" | "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(0);
  const timers = React.useRef(new Map<number, number>());

  const dismiss = React.useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = React.useCallback(
    (message: string, tone: ToastTone = "default") => {
      const id = nextId.current;
      nextId.current += 1;
      setItems((current) => [...current.slice(-2), { id, message, tone }]);
      const timer = window.setTimeout(() => dismiss(id), 4000);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  React.useEffect(
    () => () => {
      for (const timer of timers.current.values()) {
        window.clearTimeout(timer);
      }
      timers.current.clear();
    },
    [],
  );

  const api = React.useMemo<ToastApi>(
    () => ({
      show,
      success: (message) => show(message, "success"),
      error: (message) => show(message, "error"),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex flex-col items-center gap-2"
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="pointer-events-auto flex min-h-10 w-full max-w-sm items-center gap-3 rounded-[14px] border border-[#E8E8EC] bg-white px-3.5 py-2.5 text-[13px] font-medium text-[#131315] shadow-[0_8px_24px_rgba(19,19,21,0.10)]"
            role={item.tone === "error" ? "alert" : "status"}
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-2 w-2 shrink-0 rounded-full bg-[#6E6E73]",
                item.tone === "success" && "bg-[#225B36]",
                item.tone === "error" && "bg-[#D8434F]",
              )}
            />
            <span className="min-w-0 flex-1">{item.message}</span>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#A0A0A5] transition-colors hover:bg-[#F1F1F3] hover:text-[#131315] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#131315]"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

