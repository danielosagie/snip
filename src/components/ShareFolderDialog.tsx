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
import {
  Check,
  Clock,
  Copy,
  DollarSign,
  Lock,
  Trash2,
  Users,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { ShareAccessPanel } from "@/components/share/ShareAccessPanel";
import { publicShareUrl } from "@/lib/publicUrl";
import { formatUsdCents } from "@/lib/money";
import {
  buildSharePaywallConfiguration,
  CreatedLinkPanel,
  DEFAULT_SHARE_PAYWALL_OPTIONS,
  LinkBadge,
  LinkIconButton,
  SHARE_DIALOG_CONTENT_CLASS,
  ShareCapabilitiesSection,
  ShareLooksSection,
  SharePrimaryFooter,
  ShareWhoSection,
  type ShareCoverSource,
  type SharePaywallOptions,
  useShareCoverPicker,
} from "@/components/ShareDialog";

const SECTION_LABEL_CLASS =
  "font-['Geist_Mono',ui-monospace,monospace] text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]";

interface ShareFolderDialogProps {
  folderId: Id<"folders">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareFolderDialog({
  folderId,
  open,
  onOpenChange,
}: ShareFolderDialogProps) {
  const featureStatus = useQuery(api.featureFlags.getFeatureStatus, {});
  const breadcrumbs = useQuery(api.folders.breadcrumbs, { folderId });
  const existingLinks = useQuery(
    api.shareLinks.listForFolder,
    open ? { folderId } : "skip",
  );
  const createBundle = useMutation(api.shareBundles.createForFolder);
  const createShareLink = useMutation(api.shareLinks.create);
  const removeShareLink = useMutation(api.shareLinks.remove);

  const folderName = breadcrumbs?.length
    ? breadcrumbs[breadcrumbs.length - 1].name
    : "Shared folder";
  const paywallProductionReady = featureStatus?.paywallReady ?? false;

  const [isCreating, setIsCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [accessOpenId, setAccessOpenId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [generalAccess, setGeneralAccess] = useState<"anyone" | "invite">(
    "anyone",
  );
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [paywallEnabled, setPaywallEnabled] = useState(false);
  const [allowDownload, setAllowDownload] = useState(true);
  const [selectedCoverVideoId, setSelectedCoverVideoId] =
    useState<Id<"videos"> | null>(null);
  const [expiresInDays, setExpiresInDays] = useState<number | undefined>();
  const [password, setPassword] = useState("");
  const [paywallOptions, setPaywallOptions] = useState<SharePaywallOptions>(
    DEFAULT_SHARE_PAYWALL_OPTIONS,
  );

  const coverSource = useMemo<ShareCoverSource | null>(
    () => (open ? { folderId } : null),
    [folderId, open],
  );
  const coverPicker = useShareCoverPicker(coverSource);
  const unfurlHidden = generalAccess === "invite" || password.trim().length > 0;

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(
        () => setCopiedId((current) => (current === id ? null : current)),
        2200,
      );
    } catch {
      setCreateError("Copy failed. Select the link and copy it manually.");
    }
  };

  const handleCreate = async () => {
    setCreateError(null);
    let pricing: ReturnType<typeof buildSharePaywallConfiguration>;
    try {
      pricing = buildSharePaywallConfiguration(
        paywallEnabled,
        paywallOptions,
        coverPicker.data?.items,
      );
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Invalid pricing.",
      );
      return;
    }

    setIsCreating(true);
    try {
      const bundleId = await createBundle({ folderId });
      const created = await createShareLink({
        bundleId,
        coverVideoId: selectedCoverVideoId ?? undefined,
        expiresInDays,
        allowDownload,
        password: password || undefined,
        paywall: pricing.paywall,
        itemPrices: pricing.itemPrices,
        clientEmail: paywallOptions.clientEmail || undefined,
        generalAccess,
        commentsEnabled,
      });
      const url = publicShareUrl(created.token);
      setCreatedUrl(url);
      await copy(url, "new");
    } catch (error) {
      console.error("Failed to create folder share:", error);
      setCreateError(
        error instanceof Error ? error.message : "Failed to create share.",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (linkId: Id<"shareLinks">) => {
    if (!confirm("Revoke this share link? Anyone holding it loses access.")) {
      return;
    }
    try {
      await removeShareLink({ linkId });
    } catch (error) {
      console.error("Failed to revoke share link:", error);
    }
  };

  const resetComposer = () => {
    setCreatedUrl(null);
    setCopiedId(null);
    setCreateError(null);
    setIsCreating(false);
    setGeneralAccess("anyone");
    setCommentsEnabled(true);
    setPaywallEnabled(false);
    setAllowDownload(true);
    setSelectedCoverVideoId(null);
    setExpiresInDays(undefined);
    setPassword("");
    setPaywallOptions({
      ...DEFAULT_SHARE_PAYWALL_OPTIONS,
      itemPriceDollars: {},
    });
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
          <DialogTitle className="truncate text-[18px] font-semibold normal-case leading-6 tracking-[-0.01em] text-[#131315]">
            Share folder
          </DialogTitle>
          <p className="truncate text-[13px] text-[#6E6E73]">{folderName}</p>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {createdUrl ? (
            <CreatedLinkPanel
              url={createdUrl}
              copied={copiedId === "new"}
              onCopy={() => void copy(createdUrl, "new")}
              onOpen={() => window.open(createdUrl, "_blank", "noopener,noreferrer")}
            />
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
                items={coverPicker.data?.items}
              />

              <ShareLooksSection
                title={folderName}
                picker={coverPicker.data}
                loading={coverPicker.loading}
                error={coverPicker.error}
                selectedCoverVideoId={selectedCoverVideoId}
                onSelectedCoverVideoIdChange={setSelectedCoverVideoId}
                isBundle
                paywalled={paywallEnabled}
                unfurlHidden={unfurlHidden}
              />

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

          <section className="space-y-3 border-t border-[#F1F1F3] px-5 py-5 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className={SECTION_LABEL_CLASS}>Existing links</h3>
              {existingLinks ? (
                <span className="text-[11px] tabular-nums text-[#A0A0A5]">
                  {existingLinks.length}
                </span>
              ) : null}
            </div>
            {existingLinks === undefined ? (
              <div className="h-16 animate-pulse rounded-[11px] bg-[#F1F1F3]" />
            ) : existingLinks.length === 0 ? (
              <p className="text-[13px] text-[#A0A0A5]">No links yet.</p>
            ) : (
              <div className="space-y-2">
                {existingLinks.map((link) => {
                  const url = publicShareUrl(link.token);
                  return (
                    <div
                      key={link._id}
                      className="overflow-hidden rounded-[11px] border border-[#E8E8EC] bg-white"
                    >
                      <div className="flex items-center gap-3 px-3 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <code className="max-w-[200px] truncate text-[12px] text-[#6E6E73]">
                              /share/{link.token}
                            </code>
                            {link.generalAccess === "invite" ? (
                              <LinkBadge>Invite only</LinkBadge>
                            ) : null}
                            {link.hasPassword ? (
                              <Lock className="h-3 w-3 text-[#A0A0A5]" />
                            ) : null}
                            {link.paywall ? (
                              <span className="inline-flex items-center text-[11px] text-[#D14E00]">
                                <DollarSign className="h-3 w-3" />
                                {link.paywall.mode === "per_item"
                                  ? `${link.itemPrices?.length ?? 0} priced`
                                  : formatUsdCents(link.paywall.priceCents)}
                              </span>
                            ) : null}
                            {link.isExpired ? (
                              <LinkBadge>Expired</LinkBadge>
                            ) : null}
                          </div>
                          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-[#A0A0A5]">
                            <span>
                              {link.viewCount} view{link.viewCount === 1 ? "" : "s"}
                            </span>
                            {link.expiresAt && !link.isExpired ? (
                              <span className="inline-flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatRelativeTime(link.expiresAt)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <LinkIconButton
                          label="Manage access"
                          active={accessOpenId === link._id}
                          onClick={() =>
                            setAccessOpenId((current) =>
                              current === link._id ? null : link._id,
                            )
                          }
                        >
                          <Users className="h-4 w-4" />
                        </LinkIconButton>
                        <LinkIconButton
                          label="Copy link"
                          onClick={() => void copy(url, link.token)}
                        >
                          {copiedId === link.token ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </LinkIconButton>
                        <LinkIconButton
                          label="Revoke link"
                          danger
                          onClick={() => void handleRevoke(link._id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </LinkIconButton>
                      </div>
                      {accessOpenId === link._id ? (
                        <ShareAccessPanel linkId={link._id} />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <SharePrimaryFooter
          createdUrl={createdUrl}
          copied={copiedId === "new"}
          isCreating={isCreating}
          onPrimary={() =>
            createdUrl ? void copy(createdUrl, "new") : void handleCreate()
          }
          onNewLink={resetComposer}
        />
      </DialogContent>
    </Dialog>
  );
}
