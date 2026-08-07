import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full resize-none rounded-[10px] border border-[#E8E8EC] bg-white px-3 py-2 text-sm text-[#131315] transition-[border-color,box-shadow] placeholder:text-[#A0A0A5] focus-visible:!border-[#FF6600] focus-visible:outline-none focus-visible:!ring-[3px] focus-visible:!ring-[rgba(255,102,0,0.12)] disabled:cursor-not-allowed disabled:opacity-40",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
