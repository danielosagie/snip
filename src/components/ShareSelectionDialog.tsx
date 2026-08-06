"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { publicShareUrl } from "@/lib/publicUrl";
import { softInput } from "@/components/soft";
import {
  CreatedLinkPanel,
  SHARE_DIALOG_CONTENT_CLASS,
  ShareCapabilitiesSection,
  ShareLooksSection,
  SharePrimaryFooter,
  ShareWhoSection,
  type ShareCoverSource,
  type SharePaywallOptions,
  useShareCoverPicker,
} from "@/components/ShareDialog";

interface ShareSelectionDialogProps {
  videoIds: Id<"videos">[];
  defaultName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_PAYWALL_OPTIONS: SharePaywallOptions = {
  priceDollars: "",
  currency: "usd",
  clientEmail: "",
  description: "",
};

export function ShareSelectionDialog({
  videoIds,
  defaultName,
  open,
  onOpenChange,
}: ShareSelectionDialogProps) {
  const featureStatus = useQuery(api.featureFlags.getFeatureStatus, {});
  const createBundle = useMutation(api.shareBundles.createForSelection);
  const createShareLink = useMutation(api.shareLinks.create);

  const paywallProductionReady = featureStatus?.paywallReady ?? false;
  const [isCreating, setIsCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [generalAccess, setGeneralAccess] = useState<"anyone" | "invite">(
    "anyone",
  );
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [paywallEnabled, setPaywallEnabled] = useState(false);
  const [allowDownload, setAllowDownload] = useState(true);
  const [selectedCoverVideoId, setSelectedCoverVideoId] =
    useState<Id<"videos"> | null>(null);
  const [name, setName] = useState(
    defaultName ?? `Bundle (${videoIds.length} items)`,
  );
  const [expiresInDays, setExpiresInDays] = useState<number | undefined>();
  const [password, setPassword] = useState("");
  const [paywallOptions, setPaywallOptions] = useState<SharePaywallOptions>(
    DEFAULT_PAYWALL_OPTIONS,
  );

  const coverSource = useMemo<ShareCoverSource | null>(
    () => (open && videoIds.length > 0 ? { videoIds } : null),
    [open, videoIds],
  );
  const coverPicker = useShareCoverPicker(coverSource);
  const unfurlHidden = generalAccess === "invite" || password.trim().length > 0;

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCreateError("Copy failed. Select the link and copy it manually.");
    }
  };

  const handleCreate = async () => {
    setCreateError(null);
    let paywall:
      | { priceCents: number; currency: string; description?: string }
      | undefined;
    if (paywallEnabled) {
      const dollars = Number.parseFloat(paywallOptions.priceDollars);
      if (!Number.isFinite(dollars) || dollars < 0.5) {
        setCreateError("Price must be at least $0.50.");
        return;
      }
      if (!paywallOptions.clientEmail.trim()) {
        setCreateError(
          "A client email is required for paid links. It identifies the watermark and checkout.",
        );
        return;
      }
      paywall = {
        priceCents: Math.round(dollars * 100),
        currency: paywallOptions.currency || "usd",
        description: paywallOptions.description || undefined,
      };
    }

    setIsCreating(true);
    try {
      const bundleId = await createBundle({
        videoIds,
        name: name.trim() || `Bundle (${videoIds.length} items)`,
      });
      const created = await createShareLink({
        bundleId,
        coverVideoId: selectedCoverVideoId ?? undefined,
        expiresInDays,
        allowDownload,
        password: password || undefined,
        paywall,
        clientEmail: paywallOptions.clientEmail || undefined,
        generalAccess,
        commentsEnabled,
      });
      const url = publicShareUrl(created.token);
      setCreatedUrl(url);
      await copy(url);
    } catch (error) {
      console.error("Failed to create bundle share:", error);
      setCreateError(
        error instanceof Error ? error.message : "Failed to create share.",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const resetComposer = () => {
    setCreatedUrl(null);
    setCopied(false);
    setCreateError(null);
    setIsCreating(false);
    setGeneralAccess("anyone");
    setCommentsEnabled(true);
    setPaywallEnabled(false);
    setAllowDownload(true);
    setSelectedCoverVideoId(null);
    setExpiresInDays(undefined);
    setPassword("");
    setPaywallOptions(DEFAULT_PAYWALL_OPTIONS);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetComposer();
        onOpenChange(next);
      }}
    >
      <DialogContent className={SHARE_DIALOG_CONTENT_CLASS}>
        <DialogHeader className="shrink-0 border-b border-[#E8E8EC] px-5 py-4 pr-12 sm:px-6">
          <DialogTitle className="text-[18px] font-semibold normal-case leading-6 tracking-[-0.01em] text-[#131315]">
            Share items
          </DialogTitle>
          <p className="text-[13px] text-[#6E6E73]">
            {videoIds.length} item{videoIds.length === 1 ? "" : "s"}
          </p>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {createdUrl ? (
            <>
              <CreatedLinkPanel
                url={createdUrl}
                copied={copied}
                onCopy={() => void copy(createdUrl)}
                onOpen={() =>
                  window.open(createdUrl, "_blank", "noopener,noreferrer")
                }
              />
              <p className="mx-5 my-4 text-[12px] leading-[18px] text-[#A0A0A5] sm:mx-6">
                This selection is frozen at the items you picked.
              </p>
            </>
          ) : (
            <>
              <ShareWhoSection
                generalAccess={generalAccess}
                onGeneralAccessChange={setGeneralAccess}
                expiresInDays={expiresInDays}
                onExpirationChange={setExpiresInDays}
                password={password}
                onPasswordChange={setPassword}
              />

              <ShareCapabilitiesSection
                allowDownload={allowDownload}
                onAllowDownloadChange={setAllowDownload}
                commentsEnabled={commentsEnabled}
                onCommentsEnabledChange={setCommentsEnabled}
                paywallEnabled={paywallEnabled}
                onPaywallEnabledChange={setPaywallEnabled}
                paywallOptions={paywallOptions}
                onPaywallOptionsChange={setPaywallOptions}
                paywallProductionReady={paywallProductionReady}
              />

              <ShareLooksSection
                title={name}
                picker={coverPicker.data}
                loading={coverPicker.loading}
                error={coverPicker.error}
                selectedCoverVideoId={selectedCoverVideoId}
                onSelectedCoverVideoIdChange={setSelectedCoverVideoId}
                isBundle
                paywalled={paywallEnabled}
                unfurlHidden={unfurlHidden}
              >
                <label className="space-y-2">
                  <span className="text-[13px] font-medium text-[#6E6E73]">Title</span>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Final delivery"
                    className={softInput}
                  />
                </label>
              </ShareLooksSection>

              {createError ? (
                <div
                  role="status"
                  className="mx-5 mb-5 rounded-[10px] border border-[#F0D2D4] bg-[#FFF5F5] px-3 py-2 text-[13px] text-[#D8434F] sm:mx-6"
                >
                  {createError}
                </div>
              ) : null}
            </>
          )}
        </div>

        <SharePrimaryFooter
          createdUrl={createdUrl}
          copied={copied}
          isCreating={isCreating}
          disabled={videoIds.length === 0}
          onPrimary={() =>
            createdUrl ? void copy(createdUrl) : void handleCreate()
          }
          onNewLink={resetComposer}
        />
      </DialogContent>
    </Dialog>
  );
}
