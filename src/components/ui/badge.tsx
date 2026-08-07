import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border border-transparent px-2.5 py-1 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-[#FFF0E6] text-[#D14E00]",
        secondary:
          "bg-[#F1F1F3] text-[#6E6E73]",
        destructive:
          "bg-[#FFF5F5] text-[#8A2B34]",
        outline:
          "border-[#D8D8DE] bg-white text-[#6E6E73]",
        success:
          "bg-[#F2FBF5] text-[#225B36]",
        warning:
          "bg-[#FFF9EC] text-[#74521D]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
