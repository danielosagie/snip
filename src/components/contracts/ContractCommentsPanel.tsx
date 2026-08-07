"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, RotateCcw, Trash2 } from "lucide-react";
import { cn, formatRelativeTime, getInitials } from "@/lib/utils";

/**
 * Side-panel UI for contract comments. Adds a new comment via the
 * top form, lists existing comments below with resolve / reopen /
 * delete actions. Resolved comments are filtered out of the active
 * list and shown under a collapsible "Resolved" section so users
 * can still re-open them.
 */
export function ContractCommentsPanel({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const comments = useQuery(api.contractComments.list, { projectId });
  const createComment = useMutation(api.contractComments.create);
  const resolveComment = useMutation(api.contractComments.resolve);
  const reopenComment = useMutation(api.contractComments.reopen);
  const removeComment = useMutation(api.contractComments.remove);

  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const handlePost = async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      await createComment({ projectId, body });
      setDraft("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't post comment.");
    } finally {
      setPosting(false);
    }
  };

  const active = (comments ?? []).filter((c) => !c.resolvedAt);
  const resolved = (comments ?? []).filter((c) => Boolean(c.resolvedAt));

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void handlePost();
            }
          }}
          placeholder="Leave a comment…"
          rows={3}
          disabled={posting}
        />
        <div className="flex items-center justify-between text-[11px] text-[#6E6E73]">
          <span>⌘↵ to post</span>
          <Button
            size="sm"
            onClick={() => void handlePost()}
            disabled={!draft.trim() || posting}
          >
            {posting ? "Posting…" : "Post"}
          </Button>
        </div>
      </div>

      <div className="space-y-2 border-t border-[#F1F1F3] pt-3">
        {comments === undefined ? (
          <div className="text-xs text-[#6E6E73]">Loading…</div>
        ) : active.length === 0 ? (
          <div className="text-xs italic text-[#6E6E73]">
            No open comments.
          </div>
        ) : (
          active.map((c) => (
            <CommentCard
              key={c._id}
              comment={c}
              onResolve={() => void resolveComment({ commentId: c._id })}
              onDelete={() => {
                if (!confirm("Delete this comment?")) return;
                void removeComment({ commentId: c._id });
              }}
            />
          ))
        )}
      </div>

      {resolved.length > 0 ? (
        <details
          className="border-t border-[#F1F1F3] pt-3"
          open={showResolved}
          onToggle={(e) => setShowResolved((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
            Resolved ({resolved.length})
          </summary>
          <div className="space-y-2 mt-2">
            {resolved.map((c) => (
              <CommentCard
                key={c._id}
                comment={c}
                onResolve={() => void reopenComment({ commentId: c._id })}
                onDelete={() => {
                  if (!confirm("Delete this comment?")) return;
                  void removeComment({ commentId: c._id });
                }}
                resolved
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function CommentCard({
  comment,
  onResolve,
  onDelete,
  resolved,
}: {
  comment: {
    _id: Id<"contractComments">;
    _creationTime: number;
    authorName: string;
    authorAvatarUrl?: string;
    body: string;
    anchorText?: string;
    resolvedAt?: number;
    resolvedByName?: string;
  };
  onResolve: () => void;
  onDelete: () => void;
  resolved?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-2.5",
        resolved ? "opacity-70" : "",
      )}
    >
      <div className="flex items-start gap-2">
        <Avatar className="h-6 w-6 flex-shrink-0">
          {comment.authorAvatarUrl ? (
            <AvatarImage src={comment.authorAvatarUrl} alt={comment.authorName} />
          ) : null}
          <AvatarFallback className="text-[10px]">
            {getInitials(comment.authorName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-xs font-semibold text-[#131315]">
              {comment.authorName}
            </span>
            <span className="text-[10px] text-[#6E6E73]">
              {formatRelativeTime(comment._creationTime)}
            </span>
          </div>
          {comment.anchorText ? (
            <div className="mt-1 truncate rounded-[8px] bg-[#F1F1F3] px-2 py-1 text-[10px] italic text-[#6E6E73]">
              “{comment.anchorText}”
            </div>
          ) : null}
          <div className="mt-1 whitespace-pre-wrap break-words text-sm text-[#131315]">
            {comment.body}
          </div>
          {resolved ? (
            <div className="mt-1 text-[10px] text-[#D14E00]">
              Resolved by {comment.resolvedByName ?? "someone"}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={onResolve}
            className="rounded-full p-1 text-[#6E6E73] hover:bg-[#FFF0E6] hover:text-[#D14E00]"
            title={resolved ? "Re-open" : "Resolve"}
            aria-label={resolved ? "Re-open" : "Resolve"}
          >
            {resolved ? (
              <RotateCcw className="h-3.5 w-3.5" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-full p-1 text-[#6E6E73] hover:bg-[#FFF5F5] hover:text-[#D8434F]"
            title="Delete"
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
