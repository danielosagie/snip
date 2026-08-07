"use client";

import * as React from "react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";

/**
 * shadcn-style Calendar, themed to snip's soft palette.
 *
 * Wraps `react-day-picker` v10 so we get keyboard nav, multi-month
 * support, range selection, etc. without rebuilding the calendar
 * logic ourselves. v10 renamed several class keys (caption →
 * month_caption, IconLeft → Chevron, etc.), so the classNames map
 * here uses the new names.
 */
export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "rounded-[10px] border border-[#E8E8EC] bg-white p-3 text-[#131315]",
        className
      )}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-3",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-semibold",
        nav: "flex items-center gap-1 absolute right-1 top-1",
        button_previous: cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-full text-[#6E6E73] transition-colors hover:bg-[#F1F1F3] hover:text-[#131315] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#131315]",
        ),
        button_next: cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-full text-[#6E6E73] transition-colors hover:bg-[#F1F1F3] hover:text-[#131315] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#131315]",
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-8 font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]",
        week: "flex w-full mt-1",
        day: cn(
          "relative h-8 w-8 p-0 text-center text-[13px] font-normal",
        ),
        day_button: cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-full p-0 transition-colors hover:bg-[#F1F1F3] focus-visible:!ring-[3px] focus-visible:!ring-[rgba(255,102,0,0.12)] focus-visible:outline-none",
        ),
        selected:
          "[&_button]:bg-[#FFF0E6] [&_button]:font-medium [&_button]:text-[#D14E00] [&_button]:hover:bg-[#FFF0E6]",
        today: "[&_button]:font-semibold [&_button]:text-[#131315]",
        outside: "[&_button]:text-[#A0A0A5]",
        disabled:
          "[&_button]:cursor-not-allowed [&_button]:text-[#A0A0A5] [&_button]:line-through",
        hidden: "invisible",
        ...classNames,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
