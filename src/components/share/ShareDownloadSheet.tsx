"use client";

import { useMemo, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { Download, Lock, ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import { triggerDownload } from "@/lib/download";

/**
 * Download manager side-sheet for a shared bundle. Lets the viewer pick
 * individual items or bulk-download a multi-selection. One paywall covers the
 * whole share: when the link is paywalled and unpaid we show a Pay CTA and
 * disable downloads; once paid (or for free links that allow downloads) every
 * item is downloadable. Downloads run sequentially through a small client queue
 * so the browser doesn't drop concurrent requests.
 */

export interface DownloadSheetItem {
  _id: string;
  title: string;
  fileSize: number | null;
  /** Ready downloadable proxies (Mux static renditions) for this item. */
  proxies?: Array<{ name: string; resolution: string }>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: DownloadSheetItem[];
  grantToken: string | null;
  canDownload: boolean;
  isPaywalled: boolean;
  isPaid: boolean;
  paywallPriceLabel: string | null;
  onPay?: () => void;
  isPaying?: boolean;
}

export function ShareDownloadSheet({
  open,
  onOpenChange,
  items,
  grantToken,
  canDownload,
  isPaywalled,
  isPaid,
  paywallPriceLabel,
  onPay,
  isPaying,
}: Props) {
  const getDownloadUrl = useAction(api.videoActions.getSharedDownloadUrl);
  const getProxyUrl = useAction(api.videoActions.getProxyDownloadUrl);

  // Quality picker is built from the proxies that ACTUALLY exist across the
  // items, so we never offer a resolution nothing has. "Original" is always
  // available; per item, a missing proxy falls back to the original download.
  const RES_LABEL: Record<string, string> = {
    "2160p": "4K (2160p)",
    "1440p": "1440p",
    "1080p": "High (1080p)",
    "720p": "Medium (720p)",
    "540p": "540p",
    "480p": "480p",
    "360p": "Low (360p)",
    "270p": "270p",
    highest: "Highest",
  };
  const RES_ORDER = [
    "highest", "2160p", "1440p", "1080p", "720p", "540p", "480p", "360p", "270p",
  ];
  const availableResolutions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) for (const p of it.proxies ?? []) set.add(p.resolution);
    return RES_ORDER.filter((r) => set.has(r));
  }, [items]);
  const qualityOptions = useMemo(
    () => [
      { label: "Original", resolution: null as string | null },
      ...availableResolutions.map((r) => ({
        label: RES_LABEL[r] ?? r,
        resolution: r as string | null,
      })),
    ],
    [availableResolutions],
  );
  const [quality, setQuality] = useState<string>("Original");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const allSelected = items.length > 0 && selected.size === items.length;
  const totalSize = useMemo(
    () => items.reduce((sum, i) => sum + (i.fileSize ?? 0), 0),
    [items],
  );

  const locked = isPaywalled && !isPaid;
  const downloadsDisabled = !canDownload && !locked;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i._id)),
    );

  const runDownloads = async (ids: string[]) => {
    if (!grantToken || ids.length === 0 || !canDownload) return;
    setDownloading(true);
    setError(null);
    setProgress({ done: 0, total: ids.length });
    const selectedRes =
      qualityOptions.find((q) => q.label === quality)?.resolution ?? null;
    try {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const item = items.find((it) => it._id === id);
        // Use the proxy if this item has the chosen resolution; otherwise fall
        // back to the original so the download still succeeds.
        const proxy = selectedRes
          ? item?.proxies?.find((p) => p.resolution === selectedRes)
          : undefined;
        const res = proxy
          ? await getProxyUrl({
              grantToken,
              itemVideoId: id as Id<"videos">,
              renditionName: proxy.name,
            })
          : await getDownloadUrl({
              grantToken,
              itemVideoId: id as Id<"videos">,
            });
        triggerDownload(res.url, res.filename);
        setProgress({ done: i + 1, total: ids.length });
        // Small gap so the browser doesn't suppress rapid sequential downloads.
        if (i < ids.length - 1) {
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setDownloading(false);
      setTimeout(() => setProgress(null), 1500);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Download</SheetTitle>
          <SheetDescription>
            {items.length} {items.length === 1 ? "item" : "items"}
            {totalSize > 0 ? ` · ${formatBytes(totalSize)}` : ""}
          </SheetDescription>
        </SheetHeader>

        {/* Quality picker — only shown when proxies exist. Original = full file;
            others = Mux proxy renditions (smaller, faster). Per item, a missing
            proxy quietly falls back to the original. */}
        {availableResolutions.length > 0 ? (
          <div className="flex items-center gap-2 px-4 pt-3">
            <label
              htmlFor="download-quality"
              className="text-xs font-bold uppercase tracking-widest text-[#888]"
            >
              Quality
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  id="download-quality"
                  disabled={downloadsDisabled || locked || downloading}
                  className="inline-flex items-center justify-between gap-1.5 border-2 border-[#1a1a1a] bg-[#f0f0e8] px-2 py-1 text-sm font-bold text-[#1a1a1a] hover:bg-[#FFEDD5] disabled:opacity-50 min-w-[140px]"
                >
                  <span className="truncate">{quality}</span>
                  <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[160px]">
                {qualityOptions.map((q) => (
                  <DropdownMenuItem
                    key={q.label}
                    onClick={() => setQuality(q.label)}
                    className="flex items-center justify-between"
                  >
                    {q.label}
                    {q.label === quality ? (
                      <Check className="h-3.5 w-3.5 text-[#C2410C]" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}

        {/* Paywall / disabled banners */}
        {locked ? (
          <div className="m-4 border-2 border-[#1a1a1a] bg-[#FF6600] p-4 text-[#f0f0e8]">
            <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest">
              <Lock className="h-3.5 w-3.5" />
              Locked
            </div>
            <p className="mt-1 text-sm">
              Pay once to unlock downloads for everything in this share.
            </p>
            <Button
              className="mt-3 w-full bg-[#f0f0e8] text-[#1a1a1a] hover:bg-white"
              onClick={() => onPay?.()}
              disabled={isPaying || !onPay}
            >
              {isPaying
                ? "Opening…"
                : paywallPriceLabel
                  ? `Pay ${paywallPriceLabel} to unlock`
                  : "Pay to unlock"}
            </Button>
          </div>
        ) : downloadsDisabled ? (
          <div className="m-4 border-2 border-dashed border-[#ccc] p-4 text-sm text-[#888]">
            Downloads are disabled for this link.
          </div>
        ) : null}

        {/* Item list */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <p className="p-4 text-sm text-[#888]">Nothing to download yet.</p>
          ) : (
            <div className="divide-y-2 divide-[#1a1a1a] border-y-2 border-[#1a1a1a]">
              <label className="flex items-center gap-3 bg-[#e8e8e0] px-4 py-2 text-xs font-bold uppercase tracking-widest text-[#888]">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={downloadsDisabled || locked}
                  className="h-4 w-4 accent-[#C2410C]"
                />
                Select all
              </label>
              {items.map((item) => (
                <div key={item._id} className="flex items-center gap-3 px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(item._id)}
                    onChange={() => toggle(item._id)}
                    disabled={downloadsDisabled || locked}
                    className="h-4 w-4 flex-shrink-0 accent-[#C2410C]"
                    aria-label={`Select ${item.title}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-[#1a1a1a]">
                      {item.title}
                    </div>
                    <div className="text-[11px] font-mono text-[#888]">
                      {item.fileSize ? formatBytes(item.fileSize) : "—"}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void runDownloads([item._id])}
                    disabled={downloading || downloadsDisabled || locked || !grantToken}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex-shrink-0 space-y-2 border-t-2 border-[#1a1a1a] p-4">
          {error ? <p className="text-xs text-[#dc2626]">{error}</p> : null}
          {progress ? (
            <p className="text-xs font-mono text-[#888]">
              Downloading {progress.done}/{progress.total}…
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => void runDownloads([...selected])}
              disabled={
                downloading ||
                downloadsDisabled ||
                locked ||
                selected.size === 0 ||
                !grantToken
              }
            >
              <Download className="h-4 w-4" />
              Download selected ({selected.size})
            </Button>
            <Button
              className={cn("flex-1")}
              onClick={() => void runDownloads(items.map((i) => i._id))}
              disabled={
                downloading ||
                downloadsDisabled ||
                locked ||
                items.length === 0 ||
                !grantToken
              }
            >
              <Download className="h-4 w-4" />
              Download all
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
