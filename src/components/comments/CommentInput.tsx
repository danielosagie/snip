"use client";

import { useState, useRef, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/utils";
import { Send, X } from "lucide-react";

interface CommentInputProps {
  videoId: Id<"videos">;
  timestampSeconds: number;
  parentId?: Id<"comments">;
  onSubmit?: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  showTimestamp?: boolean;
  variant?: "default" | "seamless";
}

export function CommentInput({
  videoId,
  timestampSeconds,
  parentId,
  onSubmit,
  onCancel,
  autoFocus = false,
  placeholder,
  showTimestamp = false,
  variant = "default",
}: CommentInputProps) {
  const [text, setText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const createComment = useMutation(api.comments.create);

  const defaultPlaceholder = showTimestamp 
    ? `Comment at ${formatTimestamp(timestampSeconds)}...` 
    : "Add a comment...";
  const finalPlaceholder = placeholder || defaultPlaceholder;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [text]);

  const submitComment = async () => {
    if (!text.trim()) return;

    setIsLoading(true);
    try {
      await createComment({
        videoId,
        text: text.trim(),
        timestampSeconds,
        parentId,
      });
      setText("");
      onSubmit?.();
    } catch (error) {
      console.error("Failed to create comment:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitComment();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      e.preventDefault();
      void submitComment();
    }
    if (e.key === "Escape") {
      onCancel?.();
    }
  };

  return (
    <form 
      onSubmit={handleSubmit} 
      className={
        variant === "seamless" 
          ? "relative w-full bg-white"
          : "relative w-full pb-1 pr-1"
      }
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={finalPlaceholder}
        autoFocus={autoFocus}
        className={
          variant === "seamless"
            ? "block max-h-64 min-h-[100px] w-full resize-none border-0 bg-transparent px-4 pb-12 pt-4 font-sans text-sm leading-relaxed text-[#131315] outline-none transition-colors placeholder:text-[#A0A0A5] focus:ring-0"
            : "block max-h-64 min-h-[100px] w-full resize-none rounded-[11px] border border-[#D8D8DE] bg-white px-3 pb-12 pt-3 font-sans text-sm leading-relaxed text-[#131315] outline-none transition-colors placeholder:text-[#A0A0A5] focus:border-[#FF6600] focus:ring-2 focus:ring-[#FF6600]/10"
        }
        rows={3}
      />
      <div 
        className={
          variant === "seamless" 
            ? "absolute bottom-3 right-3 flex items-center gap-2" 
            : "absolute bottom-3 right-3 flex items-center gap-2"
        }
      >
        {onCancel && (
          <Button
            type="button"
            variant={variant === "seamless" ? "ghost" : "outline"}
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        <Button
          type="submit"
          variant={variant === "seamless" ? "ghost" : "primary"}
          size="icon"
          className="h-8 w-8 shrink-0 disabled:opacity-50"
          disabled={!text.trim() || isLoading}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
