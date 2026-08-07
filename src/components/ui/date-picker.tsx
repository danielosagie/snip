"use client";

import * as React from "react";
import { format, parse } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * shadcn-style date picker. Stores its value as an ISO yyyy-MM-dd
 * string (matches the legacy `<input type="date">` contract elsewhere
 * in the wizard), but renders a friendly "May 13, 2026" trigger and
 * opens a Calendar in a Popover.
 *
 * The empty placeholder lets the parent treat null/undefined the same
 * way they used to with the native input.
 */
interface DatePickerProps {
  /** ISO date string, e.g. "2026-05-13". Empty string means unset. */
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** When true, renders inline (no border / button styling). Used for
   *  forms where the trigger needs to feel like a heading. */
  size?: "default" | "lg";
  className?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled,
  size = "default",
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const date = parseIsoDate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex w-full items-center gap-2 rounded-[10px] border border-[#E8E8EC] bg-white text-left text-[#131315] transition-[border-color,box-shadow,background-color] hover:bg-[#F7F7F8] focus-visible:!border-[#FF6600] focus-visible:outline-none focus-visible:!ring-[3px] focus-visible:!ring-[rgba(255,102,0,0.12)]",
            size === "lg" ? "px-3 py-2 text-base" : "px-2 py-1.5 text-sm",
            disabled ? "opacity-50 cursor-not-allowed" : "",
            !date ? "text-[#A0A0A5]" : "",
            className,
          )}
        >
          <CalendarIcon
            className={cn(
              "flex-shrink-0",
              size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5",
            )}
          />
          <span className="flex-1">
            {date ? format(date, "MMMM d, yyyy") : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          className="border-0"
          mode="single"
          selected={date}
          onSelect={(d) => {
            onChange(d ? format(d, "yyyy-MM-dd") : "");
            setOpen(false);
          }}
          // Avoid the calendar jumping to today when first opened with
          // no selection — keep current month if value exists, else today.
          defaultMonth={date ?? undefined}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

function parseIsoDate(value: string | undefined | null): Date | undefined {
  if (!value) return undefined;
  // Match the native <input type="date"> format.
  try {
    const parsed = parse(value, "yyyy-MM-dd", new Date());
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}
