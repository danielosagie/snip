import { cn } from "@/lib/utils";

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "partially_paid"
  | "paid"
  | "void";

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially paid",
  paid: "Paid",
  void: "Void",
};

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: "bg-[#F1F1F3] text-[#6E6E73]",
  sent: "bg-[#F1F1F3] text-[#131315]",
  partially_paid: "bg-[#FFF9EC] text-[#74521D]",
  paid: "bg-[#F2FBF5] text-[#225B36]",
  void: "bg-[#F1F1F3] text-[#A0A0A5]",
};

export function InvoiceStatusPill({
  status,
  className,
}: {
  status: InvoiceStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium leading-[18px]",
        STATUS_STYLES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
