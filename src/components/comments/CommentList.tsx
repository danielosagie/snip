"use client";

import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef } from "react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { FunctionReturnType } from "convex/server";
import { CommentItem } from "./CommentItem";
import { ScrollArea } from "@/components/ui/scroll-area";

type ThreadedComments = FunctionReturnType<typeof api.comments.getThreaded>;

// Window (in seconds) inside which the playhead "claims" a comment for
// auto-highlight + auto-scroll. Past this gap we leave the list idle so
// the playhead doesn't drag the list across unrelated comments.
const AUTO_FOLLOW_WINDOW_SECONDS = 8;

interface CommentListProps {
  videoId: Id<"videos">;
  comments?: ThreadedComments;
  onTimestampClick: (seconds: number) => void;
  highlightedCommentId?: Id<"comments">;
  canResolve?: boolean;
  /** Current playhead time. When provided, the list auto-scrolls to and
   *  subtly highlights the comment whose timestamp brackets the playhead
   *  (within AUTO_FOLLOW_WINDOW_SECONDS). Pass undefined to disable. */
  currentTime?: number;
}

export function CommentList({
  videoId,
  comments: providedComments,
  onTimestampClick,
  highlightedCommentId,
  canResolve = false,
  currentTime,
}: CommentListProps) {
  const queriedComments = useQuery(api.comments.getThreaded, { videoId });
  const comments = providedComments ?? queriedComments;

  // Auto-follow: pick the latest comment whose timestamp <= currentTime
  // within the follow window. Updates as the playhead crosses each
  // comment's timestamp.
  const autoFollowedId = useMemo<Id<"comments"> | undefined>(() => {
    if (currentTime === undefined || !comments || comments.length === 0) {
      return undefined;
    }
    let best: { id: Id<"comments">; dt: number } | undefined;
    for (const c of comments) {
      const dt = currentTime - c.timestampSeconds;
      if (dt < 0 || dt > AUTO_FOLLOW_WINDOW_SECONDS) continue;
      if (!best || dt < best.dt) {
        best = { id: c._id as Id<"comments">, dt };
      }
    }
    return best?.id;
  }, [comments, currentTime]);

  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastScrolledRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!autoFollowedId || lastScrolledRef.current === autoFollowedId) return;
    const el = itemRefs.current.get(autoFollowedId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      lastScrolledRef.current = autoFollowedId;
    }
  }, [autoFollowedId]);

  // Highlight precedence: explicit click-highlight wins over auto-follow.
  const effectiveHighlightId = highlightedCommentId ?? autoFollowedId;

  if (comments === undefined) {
    return (
      <div className="p-4 text-center text-[#888]">Loading...</div>
    );
  }

  if (comments.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <p className="text-[#888] text-sm text-center">
          No comments yet.<br />
          Click on the timeline to add one.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col divide-y divide-[#1a1a1a]/10 dark:divide-white/10">
        {comments.map((comment) => (
          <div
            key={comment._id}
            className="relative"
            ref={(el) => {
              if (el) itemRefs.current.set(comment._id as string, el);
              else itemRefs.current.delete(comment._id as string);
            }}
          >
            <CommentItem
              comment={comment}
              onTimestampClick={onTimestampClick}
              isHighlighted={effectiveHighlightId === comment._id}
              canResolve={canResolve}
            />
            {comment.replies.length > 0 && (
              <div className="pl-14 pr-4 pb-4 space-y-4 relative">
                <div className="absolute left-[1.35rem] top-0 bottom-6 w-px bg-[#1a1a1a]/10 dark:bg-white/10" />
                {comment.replies.map((reply) => (
                  <CommentItem
                    key={reply._id}
                    comment={reply}
                    onTimestampClick={onTimestampClick}
                    isHighlighted={effectiveHighlightId === reply._id}
                    isReply
                    canResolve={canResolve}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
