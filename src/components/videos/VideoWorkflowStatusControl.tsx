import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

export type VideoWorkflowStatus =
  | "review"
  | "rework"
  | "done";

export const VIDEO_WORKFLOW_STATUS_OPTIONS: Array<{
  value: VideoWorkflowStatus;
  label: string;
}> = [
  { value: "review", label: "Review" },
  { value: "rework", label: "Rework" },
  { value: "done", label: "Done" },
];

function workflowStatusLabel(status: VideoWorkflowStatus) {
  const option = VIDEO_WORKFLOW_STATUS_OPTIONS.find((item) => item.value === status);
  return option?.label ?? "Review";
}

function workflowStatusDotColor(status: VideoWorkflowStatus) {
  if (status === "done") return "bg-[#FF6600]";
  if (status === "rework") return "bg-[#ca8a04]";
  return "bg-[#888]";
}

export type VideoWorkflowStatusButtonProps = {
  status: VideoWorkflowStatus;
  size?: "sm" | "lg";
  soft?: boolean;
  /** Marks the node for focus restoration after a deferred menu arms. */
  "data-defer-focus"?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * The trigger, on its own. Exported so a caller can render the control's
 * exact look WITHOUT paying for a Radix menu root — the project grid uses it
 * as a placeholder and swaps in the real control once the tile is hovered or
 * focused (see `useDeferredMenus`). Sharing the markup is what keeps the two
 * states pixel-identical.
 */
export const VideoWorkflowStatusButton = forwardRef<
  HTMLButtonElement,
  VideoWorkflowStatusButtonProps
>(function VideoWorkflowStatusButton(
  { status, size = "sm", soft = false, className, disabled, ...rest },
  ref,
) {
  const isLg = size === "lg";
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 transition-colors",
        soft
          ? "rounded-full bg-[#F1F1F3] px-2.5 py-1 text-[11px] font-medium tracking-normal text-[#6E6E73] hover:bg-[#E8E8EC] hover:text-[#131315]"
          : "font-bold uppercase tracking-wider",
        disabled
          ? "cursor-not-allowed opacity-50"
          : soft
            ? "cursor-pointer"
            : "cursor-pointer hover:text-[#1a1a1a]",
        !soft && (isLg ? "text-xs text-[#1a1a1a]" : "text-[10px] text-[#888]"),
        className,
      )}
      aria-label="Update review status"
      title="Update review status"
      {...rest}
    >
      <span
        className={cn(
          "rounded-full shrink-0",
          workflowStatusDotColor(status),
          isLg ? "h-2.5 w-2.5" : "h-2 w-2",
        )}
      />
      {workflowStatusLabel(status)}
      <ChevronDown
        className={cn("opacity-50", isLg ? "h-3.5 w-3.5" : "h-3 w-3")}
      />
    </button>
  );
});

export type VideoWorkflowStatusControlProps = {
  status: VideoWorkflowStatus;
  onChange: (status: VideoWorkflowStatus) => void;
  size?: "sm" | "lg";
  stopPropagation?: boolean;
  disabled?: boolean;
  className?: string;
  soft?: boolean;
  /** Open the menu as soon as it mounts — used when the control replaces a
   *  deferred placeholder the user just clicked. */
  defaultOpen?: boolean;
  triggerProps?: Omit<VideoWorkflowStatusButtonProps, "status">;
};

export function VideoWorkflowStatusControl({
  status,
  onChange,
  size = "sm",
  stopPropagation = false,
  disabled = false,
  className,
  soft = false,
  defaultOpen,
  triggerProps,
}: VideoWorkflowStatusControlProps) {
  const handleClick = (event: MouseEvent) => {
    if (stopPropagation) {
      event.stopPropagation();
    }
  };

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild onClick={handleClick}>
        <VideoWorkflowStatusButton
          status={status}
          size={size}
          soft={soft}
          disabled={disabled}
          className={className}
          {...triggerProps}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onClick={handleClick}
        className={cn(
          soft &&
            "rounded-[12px] border border-[#E8E8EC] bg-white p-1 text-[#131315] shadow-[0_8px_24px_rgba(19,19,21,0.10)]",
        )}
      >
        <DropdownMenuRadioGroup
          value={status}
          onValueChange={(nextStatus) => {
            if (disabled) return;
            onChange(nextStatus as VideoWorkflowStatus);
          }}
        >
          {VIDEO_WORKFLOW_STATUS_OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className={cn(
                "gap-2",
                soft &&
                  "rounded-[8px] py-1.5 pl-8 pr-2.5 text-[13px] font-medium hover:bg-[#F1F1F3] focus:bg-[#F1F1F3] focus:text-[#131315]",
              )}
            >
              <span className={cn(
                "h-2 w-2 rounded-full shrink-0",
                workflowStatusDotColor(option.value),
              )} />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
