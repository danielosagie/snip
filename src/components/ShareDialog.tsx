"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Check,
  ChevronDown,
  Clock,
  Copy,
  DollarSign,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Globe2,
  Image as ImageIcon,
  ImagePlus,
  Lock,
  MessageSquare,
  Play,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelativeTime, cn } from "@/lib/utils";
import { ShareAccessPanel } from "@/components/share/ShareAccessPanel";
import { publicShareUrl, publicWatchUrl } from "@/lib/publicUrl";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  formatUsdCents,
  parseUsdDollarsToCents,
} from "@/lib/money";
import { MAX_LINE_ITEM_AMOUNT_CENTS } from "../../convex/paymentsPolicy";
import {
  softButton,
  softButtonPrimary,
  softInput,
} from "@/components/soft";

export const SHARE_DIALOG_CONTENT_CLASS =
  "surface-soft flex max-h-[90vh] w-[calc(100vw-24px)] max-w-[680px] flex-col gap-0 overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white p-0 font-['Inter_Tight',system-ui,sans-serif] text-[14px] text-[#131315] shadow-none sm:max-w-[680px]";

const SECTION_LABEL_CLASS =
  "font-['Geist_Mono',ui-monospace,monospace] text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]";
const SOFT_MENU_CONTENT =
  "rounded-[12px] border border-[#E8E8EC] bg-white p-1 text-[#131315] shadow-[0_8px_24px_rgba(19,19,21,0.10)]";
const SOFT_MENU_ITEM =
  "rounded-[8px] px-2.5 py-2 text-[13px] font-medium normal-case tracking-normal text-[#131315] hover:bg-[#F1F1F3] focus:bg-[#F1F1F3] focus:text-[#131315]";
const SEGMENT_BUTTON_CLASS =
  "min-h-10 flex-1 rounded-full px-3.5 py-2 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315]";

export type ShareCoverItem = {
  _id: Id<"videos">;
  title: string;
  kind: "video" | "image" | "document";
  pickerImage: string | null;
  publicImage: string | null;
  paywalledImage: string | null;
};

export type ShareCoverPickerData = {
  resolvedCoverVideoId: Id<"videos"> | null;
  items: ShareCoverItem[];
};

export type ShareCoverSource = {
  videoId?: Id<"videos">;
  bundleId?: Id<"shareBundles">;
  folderId?: Id<"folders">;
  videoIds?: Id<"videos">[];
};

export type SharePaywallOptions = {
  mode: "all" | "per_item";
  priceDollars: string;
  currency: string;
  clientEmail: string;
  description: string;
  itemPriceDollars: Record<string, string>;
};

export const DEFAULT_SHARE_PAYWALL_OPTIONS: SharePaywallOptions = {
  mode: "all",
  priceDollars: "",
  currency: "usd",
  clientEmail: "",
  description: "",
  itemPriceDollars: {},
};

function enteredPriceLabel(value: string): string {
  const entered = value.trim();
  return entered ? `$${entered}` : "Empty price";
}

export function getItemPriceInputError(value: string): string | null {
  if (!value.trim()) return null;
  const cents = parseUsdDollarsToCents(value);
  if (cents === null || cents <= 0) {
    return `${enteredPriceLabel(value)} is invalid. Use $0.01 to ${formatUsdCents(MAX_LINE_ITEM_AMOUNT_CENTS)}.`;
  }
  if (cents > MAX_LINE_ITEM_AMOUNT_CENTS) {
    return `${enteredPriceLabel(value)} exceeds the ${formatUsdCents(MAX_LINE_ITEM_AMOUNT_CENTS)} limit.`;
  }
  return null;
}

export function buildSharePaywallConfiguration(
  enabled: boolean,
  options: SharePaywallOptions,
  items: ShareCoverItem[] | undefined,
): {
  paywall?: {
    priceCents: number;
    currency: string;
    description?: string;
    mode: "all" | "per_item";
  };
  itemPrices?: Array<{ videoId: Id<"videos">; priceCents: number }>;
} {
  if (!enabled) return {};
  if (!options.clientEmail.trim()) {
    throw new Error("Client email is required.");
  }

  if (options.mode === "all") {
    const priceCents = parseUsdDollarsToCents(options.priceDollars);
    if (
      priceCents === null ||
      priceCents < 50 ||
      priceCents > MAX_LINE_ITEM_AMOUNT_CENTS
    ) {
      throw new Error(
        `${enteredPriceLabel(options.priceDollars)} is invalid. Use $0.50 to ${formatUsdCents(MAX_LINE_ITEM_AMOUNT_CENTS)}.`,
      );
    }
    return {
      paywall: {
        priceCents,
        currency: options.currency || "usd",
        description: options.description.trim() || undefined,
        mode: "all",
      },
    };
  }

  if (!items) throw new Error("Items are still loading.");
  const itemPrices: Array<{ videoId: Id<"videos">; priceCents: number }> = [];
  for (const item of items) {
    const value = options.itemPriceDollars[item._id] ?? "";
    if (!value.trim()) continue;
    const inputError = getItemPriceInputError(value);
    if (inputError) throw new Error(`${item.title}: ${inputError}`);
    itemPrices.push({
      videoId: item._id,
      priceCents: parseUsdDollarsToCents(value)!,
    });
  }
  if (itemPrices.length === 0) {
    throw new Error("Price at least one item. Unpriced files are not purchasable.");
  }
  if (itemPrices.length > 200) {
    throw new Error(
      `${itemPrices.length} priced items exceeds the 200 item limit.`,
    );
  }

  return {
    paywall: {
      priceCents: Math.max(50, itemPrices[0].priceCents),
      currency: "usd",
      description: options.description.trim() || undefined,
      mode: "per_item",
    },
    itemPrices,
  };
}

export function useShareCoverPicker(
  source: ShareCoverSource | null,
): {
  data: ShareCoverPickerData | undefined;
  loading: boolean;
  error: string | null;
} {
  const loadCoverPicker = useAction(api.videoActions.getShareCoverPicker);
  const [data, setData] = useState<ShareCoverPickerData>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source) {
      setData(undefined);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadCoverPicker(source)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Preview unavailable.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadCoverPicker, source]);

  return { data, loading, error };
}

export function ShareSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 border-t border-[#F1F1F3] px-5 py-5 first:border-t-0 sm:px-6">
      <h3 className={SECTION_LABEL_CLASS}>{label}</h3>
      {children}
    </section>
  );
}

export function SoftSegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[13px] font-medium text-[#6E6E73]">{label}</div>
      <div className="flex gap-1 rounded-full border border-[#E8E8EC] bg-[#FAFAFA] p-1">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                SEGMENT_BUTTON_CLASS,
                "inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "bg-[#131315] text-white"
                  : "text-[#6E6E73] hover:bg-white hover:text-[#131315]",
              )}
            >
              {option.icon}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ExpirationPicker({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[13px] font-medium text-[#6E6E73]">Expiration</div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              softButton,
              "h-10 w-full justify-between normal-case tracking-normal shadow-none active:translate-x-0 active:translate-y-0",
            )}
          >
            <span className="inline-flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-[#A0A0A5]" />
              {value ? `${value} days` : "Never"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-[#A0A0A5]" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className={SOFT_MENU_CONTENT} align="start">
          {[
            { label: "Never", value: undefined },
            { label: "1 day", value: 1 },
            { label: "7 days", value: 7 },
            { label: "30 days", value: 30 },
          ].map((option) => (
            <DropdownMenuItem
              key={option.label}
              className={SOFT_MENU_ITEM}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function ShareWhoSection({
  generalAccess,
  onGeneralAccessChange,
  expiresInDays,
  onExpirationChange,
  password,
  onPasswordChange,
  children,
}: {
  generalAccess: "anyone" | "invite";
  onGeneralAccessChange: (value: "anyone" | "invite") => void;
  expiresInDays: number | undefined;
  onExpirationChange: (value: number | undefined) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  children?: ReactNode;
}) {
  return (
    <ShareSection label="Who can open it">
      {children}
      <SoftSegmentedControl
        label="Share access"
        value={generalAccess}
        onChange={onGeneralAccessChange}
        options={[
          {
            value: "anyone",
            label: "Anyone",
            icon: <Globe2 className="h-3.5 w-3.5" />,
          },
          {
            value: "invite",
            label: "Invite only",
            icon: <Users className="h-3.5 w-3.5" />,
          },
        ]}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ExpirationPicker value={expiresInDays} onChange={onExpirationChange} />
        <label className="space-y-2">
          <span className="text-[13px] font-medium text-[#6E6E73]">Password</span>
          <Input
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="Optional"
            className={softInput}
          />
        </label>
      </div>
    </ShareSection>
  );
}

export function SoftSwitchRow({
  label,
  icon,
  checked,
  onCheckedChange,
}: {
  label: string;
  icon: ReactNode;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-[#F1F1F3] py-2.5 last:border-b-0">
      <div className="inline-flex items-center gap-2.5 text-[14px] font-medium">
        <span className="text-[#A0A0A5]">{icon}</span>
        {label}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315]",
          checked
            ? "border-[#131315] bg-[#131315]"
            : "border-[#D8D8DE] bg-[#F1F1F3]",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] h-5 w-5 rounded-full bg-white transition-transform duration-200 ease-out",
            checked ? "translate-x-[23px]" : "translate-x-[3px]",
          )}
        />
      </button>
    </div>
  );
}

export function ShareCapabilitiesSection({
  allowDownload,
  onAllowDownloadChange,
  commentsEnabled,
  onCommentsEnabledChange,
  paywallEnabled,
  onPaywallEnabledChange,
  paywallOptions,
  onPaywallOptionsChange,
  paywallProductionReady,
  items,
}: {
  allowDownload: boolean;
  onAllowDownloadChange: (value: boolean) => void;
  commentsEnabled: boolean;
  onCommentsEnabledChange: (value: boolean) => void;
  paywallEnabled: boolean;
  onPaywallEnabledChange: (value: boolean) => void;
  paywallOptions: SharePaywallOptions;
  onPaywallOptionsChange: (value: SharePaywallOptions) => void;
  paywallProductionReady: boolean;
  items: ShareCoverItem[] | undefined;
}) {
  return (
    <ShareSection label="What they can do">
      <div className="rounded-[11px] border border-[#E8E8EC] bg-white px-4">
        <SoftSwitchRow
          label="Downloads"
          icon={<Download className="h-4 w-4" />}
          checked={allowDownload}
          onCheckedChange={onAllowDownloadChange}
        />
        <SoftSwitchRow
          label="Comments"
          icon={<MessageSquare className="h-4 w-4" />}
          checked={commentsEnabled}
          onCheckedChange={onCommentsEnabledChange}
        />
        <SoftSwitchRow
          label="Paywall"
          icon={<DollarSign className="h-4 w-4" />}
          checked={paywallEnabled}
          onCheckedChange={onPaywallEnabledChange}
        />
      </div>

      {paywallEnabled ? (
        <div className="space-y-4 rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className={SECTION_LABEL_CLASS}>Paid share</div>
            {!paywallProductionReady ? (
              <span className="rounded-full bg-[#F1F1F3] px-2.5 py-1 text-[11px] font-medium text-[#6E6E73]">
                Demo
              </span>
            ) : null}
          </div>
          <SoftSegmentedControl
            label="Pricing"
            value={paywallOptions.mode}
            onChange={(mode) =>
              onPaywallOptionsChange({
                ...paywallOptions,
                mode,
                currency: mode === "per_item" ? "usd" : paywallOptions.currency,
              })
            }
            options={[
              { value: "all", label: "Whole share" },
              { value: "per_item", label: "Per item" },
            ]}
          />
          {paywallOptions.mode === "all" ? (
            <div className="grid grid-cols-[minmax(0,1fr)_108px] gap-3">
              <label className="space-y-2">
                <span className="text-[13px] font-medium text-[#6E6E73]">Price</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="500.00"
                  value={paywallOptions.priceDollars}
                  onChange={(event) =>
                    onPaywallOptionsChange({
                      ...paywallOptions,
                      priceDollars: event.target.value,
                    })
                  }
                  className={cn(softInput, "tabular-nums")}
                />
              </label>
              <label className="space-y-2">
                <span className="text-[13px] font-medium text-[#6E6E73]">Currency</span>
                <Input
                  value={paywallOptions.currency.toUpperCase()}
                  onChange={(event) =>
                    onPaywallOptionsChange({
                      ...paywallOptions,
                      currency: event.target.value.toLowerCase().slice(0, 4),
                    })
                  }
                  className={softInput}
                />
              </label>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[11px] border border-[#E8E8EC] bg-white">
              <div className="grid grid-cols-[minmax(0,1fr)_112px] border-b border-[#F1F1F3] px-3 py-2 font-['Geist_Mono',ui-monospace,monospace] text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
                <span>File</span>
                <span>USD</span>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {items === undefined ? (
                  <div className="px-3 py-4 text-[13px] text-[#6E6E73]">
                    Loading items…
                  </div>
                ) : items.length === 0 ? (
                  <div className="px-3 py-4 text-[13px] text-[#6E6E73]">
                    No items
                  </div>
                ) : (
                  items.map((item) => {
                    const value = paywallOptions.itemPriceDollars[item._id] ?? "";
                    const inputError = getItemPriceInputError(value);
                    return (
                      <div
                        key={item._id}
                        className="grid grid-cols-[minmax(0,1fr)_112px] gap-3 border-b border-[#F1F1F3] px-3 py-2.5 last:border-b-0"
                      >
                        <div className="min-w-0 self-center">
                          <div className="truncate text-[13px] font-medium text-[#131315]">
                            {item.title}
                          </div>
                          <div
                            className={cn(
                              "mt-0.5 text-[11px]",
                              inputError ? "text-[#D8434F]" : "text-[#A0A0A5]",
                            )}
                          >
                            {inputError ?? (value.trim() ? "Purchasable" : "Not purchasable")}
                          </div>
                        </div>
                        <Input
                          type="text"
                          inputMode="decimal"
                          aria-label={`${item.title} price in dollars`}
                          aria-invalid={Boolean(inputError)}
                          placeholder="Not set"
                          value={value}
                          onChange={(event) =>
                            onPaywallOptionsChange({
                              ...paywallOptions,
                              itemPriceDollars: {
                                ...paywallOptions.itemPriceDollars,
                                [item._id]: event.target.value,
                              },
                            })
                          }
                          className={cn(softInput, "h-9 tabular-nums")}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
          <label className="space-y-2">
            <span className="text-[13px] font-medium text-[#6E6E73]">Client email</span>
            <Input
              type="email"
              placeholder="client@agency.com"
              value={paywallOptions.clientEmail}
              onChange={(event) =>
                onPaywallOptionsChange({
                  ...paywallOptions,
                  clientEmail: event.target.value,
                })
              }
              className={softInput}
            />
          </label>
          <label className="space-y-2">
            <span className="text-[13px] font-medium text-[#6E6E73]">Description</span>
            <Input
              placeholder="Final delivery"
              value={paywallOptions.description}
              onChange={(event) =>
                onPaywallOptionsChange({
                  ...paywallOptions,
                  description: event.target.value,
                })
              }
              className={softInput}
            />
          </label>
          <p className="text-[12px] leading-[18px] text-[#A0A0A5]">
            You receive the listed price. Buyer pays the Snip fee on top.
          </p>
        </div>
      ) : null}
    </ShareSection>
  );
}

function CoverPlaceholder({ kind }: { kind: ShareCoverItem["kind"] }) {
  const Icon = kind === "video" ? Play : kind === "image" ? ImageIcon : FileText;
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#F1F1F3] text-[#A0A0A5]">
      <Icon className="h-5 w-5" />
    </div>
  );
}

function PreviewMediaCell({
  item,
  imageUrl,
}: {
  item: ShareCoverItem;
  imageUrl: string | null;
}) {
  return (
    <div className="min-h-0 overflow-hidden rounded-[8px] border border-[#E8E8EC] bg-white">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <CoverPlaceholder kind={item.kind} />
      )}
    </div>
  );
}

/**
 * Uploading a cover for a share that may not exist yet. The object is written
 * against the PROJECT, so the composer can offer a cover before the link is
 * created; the caller attaches the returned key on create. Shared by all three
 * share composers so they behave identically.
 */
export function useShareCoverUpload(projectId: Id<"projects"> | undefined) {
  const getUploadUrl = useAction(api.videoActions.getShareCoverUploadUrl);
  const [key, setKey] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    if (!projectId) return;
    setUploading(true);
    setError(null);
    try {
      const { url, key: uploadedKey } = await getUploadUrl({
        projectId,
        filename: file.name,
        contentType: file.type,
        fileSize: file.size,
      });
      const res = await fetch(url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!res.ok) throw new Error(`Storage rejected the cover (${res.status}).`);
      setKey(uploadedKey);
      setPreviewUrl(URL.createObjectURL(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload that cover.");
    } finally {
      setUploading(false);
    }
  };

  const clear = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setKey(null);
    setPreviewUrl(null);
  };

  /** Drop next to <ShareLooksSection/>; it owns the hidden file input. */
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void upload(file);
        e.target.value = "";
      }}
    />
  );

  return {
    key,
    previewUrl,
    uploading,
    error,
    clear,
    fileInput,
    open: () => inputRef.current?.click(),
  };
}

export function ShareLooksSection({
  title,
  picker,
  loading,
  error,
  selectedCoverVideoId,
  onSelectedCoverVideoIdChange,
  isBundle,
  paywalled,
  unfurlHidden,
  uploadedCoverUrl,
  uploadingCover,
  onUploadCover,
  onRemoveUploadedCover,
  children,
}: {
  title: string;
  picker: ShareCoverPickerData | undefined;
  loading: boolean;
  error: string | null;
  selectedCoverVideoId: Id<"videos"> | null;
  onSelectedCoverVideoIdChange: (value: Id<"videos"> | null) => void;
  isBundle: boolean;
  paywalled: boolean;
  unfurlHidden: boolean;
  /**
   * Local object URL of a cover the sender uploaded, before the link exists.
   * Omit these four and the section renders without an upload affordance —
   * the folder and selection composers do that until they can supply a
   * projectId for the upload action.
   */
  uploadedCoverUrl?: string | null;
  uploadingCover?: boolean;
  onUploadCover?: () => void;
  onRemoveUploadedCover?: () => void;
  children?: ReactNode;
}) {
  const activeCoverId =
    selectedCoverVideoId ?? picker?.resolvedCoverVideoId ?? null;
  const orderedItems = useMemo(() => {
    const items = picker?.items ?? [];
    if (!activeCoverId) return items;
    const active = items.find((item) => item._id === activeCoverId);
    return active
      ? [active, ...items.filter((item) => item._id !== activeCoverId)]
      : items;
  }, [activeCoverId, picker?.items]);
  const previewItems = isBundle
    ? orderedItems.slice(0, orderedItems.length > 4 ? 6 : 4)
    : orderedItems.slice(0, 1);
  const previewTitle = unfurlHidden ? "Shared work" : title.trim() || "Shared work";

  return (
    <ShareSection label="How it looks">
      {children}
      <div className="overflow-hidden rounded-[11px] border border-[#E8E8EC] bg-white">
        <div className="aspect-[1200/630] bg-[#FAFAFA] p-3 sm:p-4">
          {unfurlHidden ? (
            <div className="flex h-full items-center justify-center rounded-[9px] border border-[#E8E8EC] bg-white">
              <Lock className="h-5 w-5 text-[#A0A0A5]" />
            </div>
          ) : loading && previewItems.length === 0 ? (
            <div className="h-full animate-pulse rounded-[9px] bg-[#F1F1F3]" />
          ) : previewItems.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-[9px] border border-[#E8E8EC] bg-white text-[12px] text-[#A0A0A5]">
              Generic preview
            </div>
          ) : isBundle ? (
            <div
              className={cn(
                "grid h-full gap-2",
                previewItems.length > 4 ? "grid-cols-3" : "grid-cols-2",
              )}
            >
              {previewItems.map((item) => (
                <PreviewMediaCell
                  key={item._id}
                  item={item}
                  imageUrl={
                    paywalled ? item.paywalledImage : item.publicImage
                  }
                />
              ))}
            </div>
          ) : (
            <PreviewMediaCell
              item={previewItems[0]}
              imageUrl={
                paywalled
                  ? previewItems[0].paywalledImage
                  : previewItems[0].publicImage
              }
            />
          )}
        </div>
        <div className="border-t border-[#F1F1F3] px-4 py-3">
          <div className="truncate text-[14px] font-semibold text-[#131315]">
            {previewTitle}
          </div>
          <div className="mt-0.5 font-['Geist_Mono',ui-monospace,monospace] text-[10px] uppercase tracking-widest text-[#A0A0A5]">
            snip.film
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[13px] font-medium text-[#6E6E73]">Cover</div>
        <div
          role="listbox"
          aria-label="Share cover"
          className="flex gap-2 overflow-x-auto pb-1"
        >
          <button
            type="button"
            role="option"
            aria-selected={selectedCoverVideoId === null}
            onClick={() => onSelectedCoverVideoIdChange(null)}
            className={cn(
              "flex h-[74px] w-[88px] shrink-0 items-center justify-center rounded-[10px] border text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315]",
              selectedCoverVideoId === null
                ? "border-[#E7B899] bg-[#FFF0E6] text-[#D14E00]"
                : "border-[#E8E8EC] bg-white text-[#6E6E73] hover:border-[#D8D8DE]",
            )}
          >
            Auto
          </button>
          {/* An uploaded cover sits first and wins over Auto and every item
              frame. It is the only option that is not derived from the files
              in the share, so it reads as its own thing. */}
          {uploadedCoverUrl ? (
            <button
              type="button"
              role="option"
              aria-selected
              aria-label="Uploaded cover"
              onClick={onRemoveUploadedCover}
              title="Click to remove"
              className="relative h-[74px] w-[104px] shrink-0 overflow-hidden rounded-[10px] border border-[#D14E00] bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315]"
            >
              <img src={uploadedCoverUrl} alt="" className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 truncate border-t border-[#E8E8EC] bg-white px-2 py-1 text-left text-[10px] font-medium text-[#D14E00]">
                Yours · remove
              </span>
            </button>
          ) : onUploadCover ? (
            <button
              type="button"
              onClick={onUploadCover}
              disabled={uploadingCover}
              className="flex h-[74px] w-[88px] shrink-0 flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-[#D8D8DE] bg-white text-[12px] font-medium text-[#6E6E73] transition-colors hover:border-[#A0A0A5] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315]"
            >
              <ImagePlus className="h-4 w-4" />
              {uploadingCover ? "Uploading" : "Upload"}
            </button>
          ) : null}
          {(picker?.items ?? []).map((item) => {
            const selected = selectedCoverVideoId === item._id;
            return (
              <button
                key={item._id}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={`Use ${item.title} as cover`}
                title={item.title}
                onClick={() => onSelectedCoverVideoIdChange(item._id)}
                className={cn(
                  "relative h-[74px] w-[104px] shrink-0 overflow-hidden rounded-[10px] border bg-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315]",
                  selected
                    ? "border-[#D14E00]"
                    : "border-[#E8E8EC] hover:border-[#D8D8DE]",
                )}
              >
                {item.pickerImage ? (
                  <img
                    src={item.pickerImage}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <CoverPlaceholder kind={item.kind} />
                )}
                <span className="absolute inset-x-0 bottom-0 truncate border-t border-[#E8E8EC] bg-white px-2 py-1 text-left text-[10px] font-medium text-[#6E6E73]">
                  {item.title}
                </span>
              </button>
            );
          })}
        </div>
        {error ? (
          <p className="text-[12px] text-[#D8434F]">{error}</p>
        ) : null}
      </div>
    </ShareSection>
  );
}

export function CreatedLinkPanel({
  url,
  copied,
  onCopy,
  onOpen,
}: {
  url: string;
  copied: boolean;
  onCopy: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="mx-5 mt-5 rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-4 sm:mx-6">
      <div className={SECTION_LABEL_CLASS}>Share link</div>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-[8px] border border-[#E8E8EC] bg-white px-3 py-2 text-[12px] text-[#6E6E73]">
          {url}
        </code>
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy link"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#D8D8DE] bg-white text-[#131315] hover:bg-[#F1F1F3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315]"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onOpen}
          aria-label="Open link"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#D8D8DE] bg-white text-[#131315] hover:bg-[#F1F1F3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315]"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function SharePrimaryFooter({
  createdUrl,
  copied,
  isCreating,
  disabled,
  onPrimary,
  onNewLink,
}: {
  createdUrl: string | null;
  copied: boolean;
  isCreating: boolean;
  disabled?: boolean;
  onPrimary: () => void;
  onNewLink?: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-[#E8E8EC] bg-white px-5 py-4 sm:px-6">
      {createdUrl && onNewLink ? (
        <Button
          type="button"
          variant="outline"
          onClick={onNewLink}
          className={cn(
            softButton,
            "h-10 normal-case tracking-normal shadow-none active:translate-x-0 active:translate-y-0",
          )}
        >
          <Plus className="h-4 w-4" />
          New link
        </Button>
      ) : null}
      <Button
        type="button"
        onClick={onPrimary}
        disabled={disabled || isCreating}
        className={cn(
          softButtonPrimary,
          "h-10 flex-1 normal-case tracking-normal shadow-none active:translate-x-0 active:translate-y-0",
        )}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {isCreating ? "Creating link" : copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}

export function LinkBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-full bg-[#F1F1F3] px-2 py-0.5 text-[10px] font-medium text-[#6E6E73]">
      {children}
    </span>
  );
}

export function LinkIconButton({
  label,
  onClick,
  active = false,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
        danger
          ? "border-[#F0D2D4] text-[#D8434F] hover:bg-[#FFF5F5] focus-visible:outline-[#D8434F]"
          : active
            ? "border-[#E7B899] bg-[#FFF0E6] text-[#D14E00] focus-visible:outline-[#131315]"
            : "border-[#D8D8DE] text-[#6E6E73] hover:bg-[#F1F1F3] hover:text-[#131315] focus-visible:outline-[#131315]",
      )}
    >
      {children}
    </button>
  );
}

interface ShareDialogProps {
  videoId: Id<"videos">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareDialog({ videoId, open, onOpenChange }: ShareDialogProps) {
  const confirmDialog = useConfirmDialog();
  const video = useQuery(api.videos.get, { videoId });
  const shareLinks = useQuery(api.shareLinks.list, { videoId });
  const featureStatus = useQuery(api.featureFlags.getFeatureStatus, {});
  const createShareLink = useMutation(api.shareLinks.create);
  const createBundleForFolder = useMutation(api.shareBundles.createForFolder);
  const deleteShareLink = useMutation(api.shareLinks.remove);
  const setVisibility = useMutation(api.videos.setVisibility);

  const folderBreadcrumbs = useQuery(
    api.folders.breadcrumbs,
    video?.folderId ? { folderId: video.folderId } : "skip",
  );
  const containingFolder = folderBreadcrumbs?.length
    ? folderBreadcrumbs[folderBreadcrumbs.length - 1]
    : null;

  const [scope, setScope] = useState<"video" | "folder">("video");
  const [generalAccess, setGeneralAccess] = useState<"anyone" | "invite">(
    "anyone",
  );
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [accessOpenId, setAccessOpenId] = useState<string | null>(null);
  const [paywallEnabled, setPaywallEnabled] = useState(false);
  const [allowDownload, setAllowDownload] = useState(true);
  const [selectedCoverVideoId, setSelectedCoverVideoId] =
    useState<Id<"videos"> | null>(null);
  const coverUpload = useShareCoverUpload(video?.projectId);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [newLinkOptions, setNewLinkOptions] = useState({
    expiresInDays: undefined as number | undefined,
    password: "",
    ...DEFAULT_SHARE_PAYWALL_OPTIONS,
  });
  const [createError, setCreateError] = useState<string | null>(null);

  const coverSource = useMemo<ShareCoverSource | null>(() => {
    if (!open) return null;
    if (scope === "folder" && video?.folderId) {
      return { folderId: video.folderId };
    }
    return { videoId };
  }, [open, scope, video?.folderId, videoId]);
  const coverPicker = useShareCoverPicker(coverSource);
  const paywallOptions: SharePaywallOptions = {
    mode: newLinkOptions.mode,
    priceDollars: newLinkOptions.priceDollars,
    currency: newLinkOptions.currency,
    clientEmail: newLinkOptions.clientEmail,
    description: newLinkOptions.description,
    itemPriceDollars: newLinkOptions.itemPriceDollars,
  };
  const paywallProductionReady = featureStatus?.paywallReady ?? false;
  const shareTitle =
    scope === "folder"
      ? containingFolder?.name ?? "Shared folder"
      : video?.title ?? "Shared video";
  const unfurlHidden =
    generalAccess === "invite" || newLinkOptions.password.trim().length > 0;

  const copy = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2200);
    } catch {
      setCreateError("Copy failed. Select the link and copy it manually.");
    }
  };

  const handleCreateLink = async () => {
    setCreateError(null);
    setIsCreating(true);
    try {
      const { paywall, itemPrices } = buildSharePaywallConfiguration(
        paywallEnabled,
        paywallOptions,
        coverPicker.data?.items,
      );
      let bundleId: Id<"shareBundles"> | undefined;
      if (scope === "folder" && video?.folderId) {
        bundleId = await createBundleForFolder({ folderId: video.folderId });
      }
      const created = await createShareLink({
        videoId: scope === "video" ? videoId : undefined,
        bundleId,
        coverVideoId: selectedCoverVideoId ?? undefined,
        coverImageS3Key: coverUpload.key ?? undefined,
        expiresInDays: newLinkOptions.expiresInDays,
        allowDownload,
        password: newLinkOptions.password || undefined,
        paywall,
        itemPrices,
        clientEmail: newLinkOptions.clientEmail || undefined,
        generalAccess,
        commentsEnabled,
      });
      const url = publicShareUrl(created.token);
      setCreatedUrl(url);
      await copy(url, "new");
    } catch (error) {
      console.error("Failed to create share link:", error);
      setCreateError(
        error instanceof Error ? error.message : "Failed to create share link.",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleSetVisibility = async (visibility: "public" | "private") => {
    if (!video || isUpdatingVisibility || video.visibility === visibility) return;
    setIsUpdatingVisibility(true);
    try {
      await setVisibility({ videoId, visibility });
    } catch (error) {
      console.error("Failed to update visibility:", error);
      setCreateError("Could not update the public page.");
    } finally {
      setIsUpdatingVisibility(false);
    }
  };

  const handleDeleteLink = async (linkId: Id<"shareLinks">) => {
    await confirmDialog({
      title: "Delete link",
      description: "Anyone with this link will lose access.",
      confirmLabel: "Delete",
      variant: "destructive",
      action: async () => {
        try {
          await deleteShareLink({ linkId });
        } catch (error) {
          console.error("Failed to delete share link:", error);
          throw error;
        }
      },
      errorMessage: "Couldn't delete link.",
    });
  };

  const resetComposer = () => {
    setCreatedUrl(null);
    setCopiedId(null);
    setCreateError(null);
    setSelectedCoverVideoId(null);
    setGeneralAccess("anyone");
    setCommentsEnabled(true);
    setAllowDownload(true);
    setPaywallEnabled(false);
    setNewLinkOptions({
      expiresInDays: undefined,
      password: "",
      ...DEFAULT_SHARE_PAYWALL_OPTIONS,
      itemPriceDollars: {},
    });
  };

  const publicWatchPath = video?.publicId ? `/watch/${video.publicId}` : null;
  const hasLinks = Boolean(
    (video?.visibility === "public" && publicWatchPath) || shareLinks?.length,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={SHARE_DIALOG_CONTENT_CLASS}>
        <DialogHeader className="shrink-0 border-b border-[#E8E8EC] px-5 py-4 pr-12 sm:px-6">
          <DialogTitle className="text-[18px] font-semibold normal-case leading-6 tracking-[-0.01em] text-[#131315]">
            Share
          </DialogTitle>
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
                expiresInDays={newLinkOptions.expiresInDays}
                onExpirationChange={(expiresInDays) =>
                  setNewLinkOptions((current) => ({ ...current, expiresInDays }))
                }
                password={newLinkOptions.password}
                onPasswordChange={(password) =>
                  setNewLinkOptions((current) => ({ ...current, password }))
                }
              >
                <SoftSegmentedControl
                  label="Public page"
                  value={video?.visibility ?? "private"}
                  onChange={(visibility) => void handleSetVisibility(visibility)}
                  disabled={isUpdatingVisibility || video === undefined}
                  options={[
                    {
                      value: "public",
                      label: "Public",
                      icon: <Globe2 className="h-3.5 w-3.5" />,
                    },
                    {
                      value: "private",
                      label: "Private",
                      icon: <Lock className="h-3.5 w-3.5" />,
                    },
                  ]}
                />
                {containingFolder ? (
                  <SoftSegmentedControl
                    label="Share"
                    value={scope}
                    onChange={(nextScope) => {
                      setScope(nextScope);
                      setSelectedCoverVideoId(null);
                    }}
                    options={[
                      { value: "video", label: "This video" },
                      { value: "folder", label: containingFolder.name },
                    ]}
                  />
                ) : null}
              </ShareWhoSection>

              <ShareCapabilitiesSection
                allowDownload={allowDownload}
                onAllowDownloadChange={setAllowDownload}
                commentsEnabled={commentsEnabled}
                onCommentsEnabledChange={setCommentsEnabled}
                paywallEnabled={paywallEnabled}
                onPaywallEnabledChange={setPaywallEnabled}
                paywallOptions={paywallOptions}
                onPaywallOptionsChange={(next) =>
                  setNewLinkOptions((current) => ({ ...current, ...next }))
                }
                paywallProductionReady={paywallProductionReady}
                items={coverPicker.data?.items}
              />

            </>
          )}

          {hasLinks ? (
            <section className="space-y-3 border-t border-[#F1F1F3] px-5 py-5 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className={SECTION_LABEL_CLASS}>Existing links</h3>
                {shareLinks?.length ? (
                  <span className="text-[11px] tabular-nums text-[#A0A0A5]">
                    {shareLinks.length}
                  </span>
                ) : null}
              </div>
              <div className="space-y-2">
                {video?.visibility === "public" && publicWatchPath ? (
                  <div className="rounded-[11px] border border-[#E8E8EC] bg-white">
                    <div className="flex items-center gap-3 px-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <code className="truncate text-[12px] text-[#6E6E73]">
                            {publicWatchPath}
                          </code>
                          <LinkBadge>Public</LinkBadge>
                        </div>
                      </div>
                      <LinkIconButton
                        label="Copy public link"
                        onClick={() => {
                          if (!video.publicId) return;
                          void copy(publicWatchUrl(video.publicId), "public");
                        }}
                      >
                        {copiedId === "public" ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </LinkIconButton>
                      <LinkIconButton
                        label="Open public link"
                        onClick={() =>
                          window.open(publicWatchPath, "_blank", "noopener,noreferrer")
                        }
                      >
                        <ExternalLink className="h-4 w-4" />
                      </LinkIconButton>
                    </div>
                  </div>
                ) : null}

                {shareLinks?.map((link) => (
                  <div
                    key={link._id}
                    className="overflow-hidden rounded-[11px] border border-[#E8E8EC] bg-white"
                  >
                    <div className="flex items-center gap-3 px-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="max-w-[210px] truncate text-[12px] text-[#6E6E73]">
                            /share/{link.token}
                          </code>
                          {link.generalAccess === "invite" ? (
                            <LinkBadge>Invite only</LinkBadge>
                          ) : null}
                          {link.isExpired ? <LinkBadge>Expired</LinkBadge> : null}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#A0A0A5]">
                          <span className="inline-flex items-center gap-1">
                            <Eye className="h-3 w-3" />
                            {link.viewCount}
                          </span>
                          {link.hasPassword ? (
                            <span className="inline-flex items-center gap-1">
                              <Lock className="h-3 w-3" /> Protected
                            </span>
                          ) : null}
                          {link.paywall ? (
                            <span className="text-[#D14E00]">
                              {link.paywall.mode === "per_item"
                                ? `${link.itemPrices?.length ?? 0} priced`
                                : formatUsdCents(link.paywall.priceCents)}
                            </span>
                          ) : null}
                          {link.expiresAt ? (
                            <span>{formatRelativeTime(link.expiresAt)}</span>
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
                        onClick={() => void copy(publicShareUrl(link.token), link.token)}
                      >
                        {copiedId === link.token ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </LinkIconButton>
                      <LinkIconButton
                        label="Delete link"
                        danger
                        onClick={() => void handleDeleteLink(link._id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </LinkIconButton>
                    </div>
                    {accessOpenId === link._id ? (
                      <ShareAccessPanel linkId={link._id} />
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* "How it looks" renders AFTER the links list. It styles the card a
              recipient sees, which is a later decision than who gets in and
              what they can do — and the link itself is what people came for. */}
          {createdUrl ? null : (
            <>
              <ShareLooksSection
                title={shareTitle}
                picker={coverPicker.data}
                loading={coverPicker.loading}
                error={coverPicker.error}
                selectedCoverVideoId={selectedCoverVideoId}
                onSelectedCoverVideoIdChange={setSelectedCoverVideoId}
                isBundle={scope === "folder"}
                paywalled={paywallEnabled}
                unfurlHidden={unfurlHidden}
                uploadedCoverUrl={coverUpload.previewUrl}
                uploadingCover={coverUpload.uploading}
                onUploadCover={coverUpload.open}
                onRemoveUploadedCover={coverUpload.clear}
              />
              {coverUpload.fileInput}

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
          copied={copiedId === "new"}
          isCreating={isCreating}
          onPrimary={() =>
            createdUrl ? void copy(createdUrl, "new") : void handleCreateLink()
          }
          onNewLink={resetComposer}
        />
      </DialogContent>
    </Dialog>
  );
}
