"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Billing add-on toggles. Three SKUs on top of the base subscription:
 *
 *   • White-label — $20/mo. Drops snip branding from share links and
 *     delivery emails. Pure margin (no incremental COGS).
 *   • Custom domain — $10/mo. CNAME for paywalled deliveries. DNS
 *     verification happens out of band; this form just records the
 *     hostname so the share-link renderer can use it.
 *   • Public API tier — $30/mo. Relaxes rate limits + unlocks signed
 *     API tokens for the user's own integrations.
 *
 * Renders nothing when the caller has no live subscription —
 * add-ons can't attach to free.
 */
export function AddOnsSection() {
  const addOns = useQuery(api.workspaceBilling.getMyAddOns, {});
  const updateAddOn = useAction(api.workspaceBillingActions.updateAddOn);

  const [hostname, setHostname] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Loading or unsubscribed → nothing to surface here. The query
  // returns null for the unauthenticated/free-tier case; React
  // re-renders once a paid sub exists.
  if (!addOns) return null;

  const prices = addOns.prices;

  const handleToggle = async (
    addOn: "whiteLabel" | "apiTier",
    next: boolean,
  ) => {
    setBusy(addOn);
    setError(null);
    try {
      await updateAddOn({ addOn, enabled: next });
    } catch (e) {
      const data =
        typeof e === "object" && e !== null && "data" in e
          ? ((e as { data: unknown }).data as
              | { code?: string; message?: string }
              | undefined)
          : undefined;
      setError(
        data?.message ??
          (e instanceof Error ? e.message : "Couldn't update add-on."),
      );
    } finally {
      setBusy(null);
    }
  };

  const handleSetDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("customDomain");
    setError(null);
    try {
      await updateAddOn({
        addOn: "customDomain",
        enabled: true,
        customDomain: hostname.trim(),
      });
      setHostname("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't set custom domain.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-10 rounded-[14px] border border-[#E8E8EC] bg-white px-6 py-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-base font-semibold tracking-tight text-[#131315]">
          Add-ons
        </h2>
        <span className="rounded-full bg-[#F1F1F3] px-2.5 py-1 text-xs font-medium text-[#6E6E73]">
          Monthly
        </span>
      </div>

      <div className="divide-y divide-[#F1F1F3]">
        <AddOnRow
          title="White-label"
          description="Remove snip branding from share links and delivery emails."
          priceCents={prices.whiteLabel}
          enabled={addOns.whiteLabel}
          busy={busy === "whiteLabel"}
          onToggle={(next) => void handleToggle("whiteLabel", next)}
        />
        <AddOnRow
          title="Public API tier"
          description="Relaxed rate limits and signed access tokens for your integrations."
          priceCents={prices.apiTier}
          enabled={addOns.apiTier}
          busy={busy === "apiTier"}
          onToggle={(next) => void handleToggle("apiTier", next)}
        />

        <div className="py-4 flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-[#131315]">
              Custom domain
            </span>
            <span className="text-xs text-[#6E6E73]">
              ${(prices.customDomain / 100).toFixed(0)}/mo
            </span>
          </div>
          <p className="max-w-prose text-xs text-[#6E6E73]">
            CNAME for paywalled deliveries. Point a hostname at
            <span className="font-mono"> share.snip.app </span>
            then enter it here. DNS verification happens out of band.
          </p>
          <form onSubmit={handleSetDomain} className="flex gap-2 mt-1">
            <Input
              type="text"
              placeholder={addOns.customDomain ?? "deliveries.youragency.com"}
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              disabled={busy === "customDomain"}
              className="flex-1"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={busy === "customDomain"}
            >
              {addOns.customDomain ? "Update" : "Set"}
            </Button>
            {addOns.customDomain ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy === "customDomain"}
                onClick={async () => {
                  setBusy("customDomain");
                  setError(null);
                  try {
                    await updateAddOn({
                      addOn: "customDomain",
                      enabled: false,
                    });
                  } catch (err) {
                    setError(
                      err instanceof Error
                        ? err.message
                        : "Couldn't remove the custom domain.",
                    );
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Remove
              </Button>
            ) : null}
          </form>
          {addOns.customDomain ? (
            <p className="mt-1 text-xs text-[#6E6E73]">
              Active: <span className="text-[#131315]">{addOns.customDomain}</span>
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-[11px] bg-[#FFF5F5] px-3 py-2 text-xs text-[#8A2B34]">{error}</p>
      ) : null}
    </section>
  );
}

function AddOnRow({
  title,
  description,
  priceCents,
  enabled,
  busy,
  onToggle,
}: {
  title: string;
  description: string;
  priceCents: number;
  enabled: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="py-4 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-[#131315]">{title}</span>
          <span className="text-xs text-[#6E6E73]">
            ${(priceCents / 100).toFixed(0)}/mo
          </span>
        </div>
        <p className="mt-0.5 max-w-prose text-xs text-[#6E6E73]">{description}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => onToggle(!enabled)}
        className={
          enabled
            ? "border-[#D8D8DE] bg-[#FFF0E6] font-medium text-[#D14E00]"
            : ""
        }
      >
        {busy ? "…" : enabled ? "Enabled" : "Enable"}
      </Button>
    </div>
  );
}
