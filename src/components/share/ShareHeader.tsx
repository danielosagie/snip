"use client";

import { useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { ImagePlus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Notion-style per-share header for a shared bundle: an optional cover image
 * with a bold title and description. The bundle owner can edit the title /
 * description and upload or remove the cover image inline. Stored per-share on
 * the bundle (shareBundles.setHeader); the cover is a private bucket object
 * served via a signed URL fetched by the parent.
 */

interface Props {
  bundleId: Id<"shareBundles">;
  bundleName: string;
  headerTitle: string | null;
  headerDescription: string | null;
  coverUrl: string | null;
  isOwner: boolean;
  /** Called after the cover key changes so the parent can refetch the signed URL. */
  onCoverChanged?: () => void;
}

export function ShareHeader({
  bundleId,
  bundleName,
  headerTitle,
  headerDescription,
  coverUrl,
  isOwner,
  onCoverChanged,
}: Props) {
  const getUploadUrl = useAction(api.videoActions.getBundleCoverUploadUrl);
  const setHeader = useMutation(api.shareBundles.setHeader);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(headerTitle ?? "");
  const [description, setDescription] = useState(headerDescription ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayTitle = headerTitle?.trim() || bundleName;

  const handleSaveText = async () => {
    setBusy(true);
    setError(null);
    try {
      await setHeader({ bundleId, headerTitle: title, headerDescription: description });
      setEditing(false);
    } catch {
      setError("Couldn't save the header.");
    } finally {
      setBusy(false);
    }
  };

  const handleCoverFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { url, key } = await getUploadUrl({
        bundleId,
        filename: file.name,
        contentType: file.type,
        fileSize: file.size,
      });
      const res = await fetch(url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!res.ok) throw new Error("upload failed");
      await setHeader({ bundleId, coverImageS3Key: key });
      onCoverChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't upload the cover.");
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveCover = async () => {
    setBusy(true);
    setError(null);
    try {
      await setHeader({ bundleId, coverImageS3Key: null });
      onCoverChanged?.();
    } catch {
      setError("Couldn't remove the cover.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-2 border-[#1a1a1a]">
      {/* Banner */}
      <div className="relative">
        {coverUrl ? (
          <div className="relative h-44 md:h-56 w-full overflow-hidden bg-[#1a1a1a]">
            <img
              src={coverUrl}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-5">
              <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">
                {displayTitle}
              </h1>
              {headerDescription ? (
                <p className="mt-1 max-w-2xl text-sm text-white/85">
                  {headerDescription}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="bg-[#1a1a1a] p-6">
            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-[#f0f0e8]">
              {displayTitle}
            </h1>
            {headerDescription ? (
              <p className="mt-1 max-w-2xl text-sm text-[#f0f0e8]/80">
                {headerDescription}
              </p>
            ) : null}
          </div>
        )}

        {isOwner && !editing ? (
          <div className="absolute right-3 top-3 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTitle(headerTitle ?? "");
                setDescription(headerDescription ?? "");
                setEditing(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          </div>
        ) : null}
      </div>

      {/* Owner editor */}
      {isOwner && editing ? (
        <div className="space-y-3 border-t-2 border-[#1a1a1a] bg-[#e8e8e0] p-4">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-widest text-[#888]">
              Title
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={bundleName}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-widest text-[#888]">
              Description
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description for this share…"
              className="min-h-[72px]"
            />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleCoverFile(file);
              e.target.value = "";
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {coverUrl ? "Replace cover" : "Upload cover"}
            </Button>
            {coverUrl ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRemoveCover()}
                disabled={busy}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove cover
              </Button>
            ) : null}

            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={() => void handleSaveText()} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>

          {error ? <p className="text-xs text-[#dc2626]">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
