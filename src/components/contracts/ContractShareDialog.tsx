"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { contractPath } from "@/lib/routes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Check,
  ChevronDown,
  Globe,
  Link2,
  Lock,
  FileSignature,
  User,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Google-Drive-style share dialog for a contract/document:
 *   - "People with access" (the owner today; per-person invites later).
 *   - "General access" — link access with a Viewer/Editor role dropdown +
 *     Copy link (backed by createContractShareLink).
 *   - "Signing" — the contract-specific action that opens the signing editor
 *     (recipients, field placement, audit trail, certificate). No demo stub.
 */

type LinkRole = "review" | "edit";

const ROLE_META: Record<LinkRole, { label: string; help: string }> = {
  review: { label: "Reviewer", help: "Can read + leave comments" },
  edit: { label: "Editor", help: "Can edit the contract" },
};

interface Props {
  projectId: Id<"projects">;
  teamSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractState: "none" | "draft" | "awaiting" | "signed";
  signedByName: string | undefined;
  signedAt: number | undefined;
}

export function ContractShareDialog({
  projectId,
  teamSlug,
  open,
  onOpenChange,
  contractState,
  signedByName,
  signedAt,
}: Props) {
  const navigate = useNavigate();
  const startSignableContract = useMutation(api.projects.startSignableContract);
  const createContractShareLink = useMutation(
    api.projects.createContractShareLink,
  );

  const [linkEnabled, setLinkEnabled] = useState(true);
  const [role, setRole] = useState<LinkRole>("review");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cache one link per role so re-copying hands back the same URL.
  const [linkUrls, setLinkUrls] = useState<Record<LinkRole, string | undefined>>(
    { review: undefined, edit: undefined },
  );

  const isSigned = contractState === "signed";

  const handleSetUpSigning = async () => {
    setBusy("sign");
    setError(null);
    try {
      const contractId = await startSignableContract({ projectId });
      onOpenChange(false);
      void navigate({ to: contractPath(teamSlug, projectId, contractId) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start signing.");
    } finally {
      setBusy(null);
    }
  };

  const handleCopyLink = async () => {
    setError(null);
    try {
      let url = linkUrls[role];
      if (!url) {
        setBusy("copy");
        const { token } = await createContractShareLink({ projectId, role });
        const origin =
          typeof window !== "undefined" ? window.location.origin : "";
        url = `${origin}/c/${token}`;
        setLinkUrls((prev) => ({ ...prev, [role]: url }));
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't create link: ${e.message}`
          : "Couldn't copy. Allow clipboard access and try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription>
            Pick who gets in and what they can do.
          </DialogDescription>
        </DialogHeader>

        {isSigned ? (
          <div className="border-2 border-[#16a34a] bg-[#dcfce7] p-3">
            <div className="font-bold text-sm text-[#16a34a] flex items-center gap-2">
              <Check className="h-4 w-4" />
              Signed by {signedByName}
            </div>
            {signedAt ? (
              <div className="text-xs text-[#666] mt-0.5">
                {new Date(signedAt).toLocaleString()}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* People with access */}
        <div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-2">
            People with access
          </div>
          <div className="flex items-center gap-3">
            <span className="h-8 w-8 flex-shrink-0 inline-flex items-center justify-center rounded-full border-2 border-[#1a1a1a] bg-[#FFEDD5]">
              <User className="h-4 w-4 text-[#1a1a1a]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-[#1a1a1a]">You</div>
              <div className="text-[11px] font-mono text-[#888]">
                Your team
              </div>
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#888]">
              Owner
            </span>
          </div>
        </div>

        {/* General access — link sharing with a role */}
        <div className="border-t-2 border-[#1a1a1a] pt-3">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-2">
            General access
          </div>
          <div className="flex items-center gap-3">
            <span className="h-8 w-8 flex-shrink-0 inline-flex items-center justify-center rounded-full border-2 border-[#1a1a1a] bg-[#f0f0e8]">
              {linkEnabled ? (
                <Globe className="h-4 w-4 text-[#1a1a1a]" />
              ) : (
                <Lock className="h-4 w-4 text-[#888]" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              {/* Restricted ⇄ Anyone-with-link */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-sm font-bold text-[#1a1a1a] hover:bg-[#FFEDD5] px-1 -ml-1"
                  >
                    {linkEnabled ? "Anyone with the link" : "Restricted"}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[200px]">
                  <DropdownMenuItem onClick={() => setLinkEnabled(false)}>
                    Restricted
                    {!linkEnabled ? (
                      <Check className="ml-auto h-3.5 w-3.5 text-[#C2410C]" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLinkEnabled(true)}>
                    Anyone with the link
                    {linkEnabled ? (
                      <Check className="ml-auto h-3.5 w-3.5 text-[#C2410C]" />
                    ) : null}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="text-[11px] font-mono text-[#888]">
                {linkEnabled
                  ? `Anyone with the link can ${role === "edit" ? "edit" : "review"}`
                  : "Only people you add can open this"}
              </div>
            </div>
            {/* Role picker */}
            {linkEnabled ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 border-2 border-[#1a1a1a] bg-[#f0f0e8] px-2 h-8 text-xs font-bold uppercase tracking-wider hover:bg-[#FFEDD5]"
                  >
                    {ROLE_META[role].label}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[200px]">
                  {(Object.keys(ROLE_META) as LinkRole[]).map((r) => (
                    <DropdownMenuItem
                      key={r}
                      onClick={() => {
                        setRole(r);
                        setCopied(false);
                      }}
                      className="flex-col items-start"
                    >
                      <span className="flex w-full items-center justify-between font-bold">
                        {ROLE_META[r].label}
                        {role === r ? (
                          <Check className="h-3.5 w-3.5 text-[#C2410C]" />
                        ) : null}
                      </span>
                      <span className="text-[11px] text-[#888]">
                        {ROLE_META[r].help}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>

          {linkEnabled ? (
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              disabled={busy === "copy"}
              className="mt-3 inline-flex items-center gap-2 border-2 border-[#1a1a1a] bg-[#f0f0e8] px-3 h-9 text-xs font-bold uppercase tracking-wider text-[#1a1a1a] hover:bg-[#FFEDD5] disabled:opacity-50"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" /> Copied
                </>
              ) : (
                <>
                  <Link2 className="h-3.5 w-3.5" />
                  {busy === "copy" ? "Creating…" : "Copy link"}
                </>
              )}
            </button>
          ) : null}
        </div>

        {/* Signing — the contract-specific action */}
        {!isSigned ? (
          <div className="border-t-2 border-[#1a1a1a] pt-3">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-1.5">
              Signing
            </div>
            <p className="text-xs text-[#666] mb-2">
              Open the signing editor — add signers, place fields, send.
              Recorded with a tamper-evident hash, ESIGN consent, IP + audit
              trail, and a Certificate of Completion.
            </p>
            <button
              type="button"
              onClick={() => void handleSetUpSigning()}
              disabled={busy === "sign"}
              className="inline-flex items-center gap-2 border-2 border-[#1a1a1a] bg-[#C2410C] px-3 h-9 text-xs font-bold uppercase tracking-wider text-[#f0f0e8] hover:bg-[#9A3412] disabled:opacity-50"
            >
              <FileSignature className="h-3.5 w-3.5" />
              {busy === "sign" ? "Opening…" : "Set up signing"}
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="text-xs text-[#dc2626] font-bold flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
