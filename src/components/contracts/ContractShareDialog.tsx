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
      <DialogContent className="surface-soft max-w-lg">
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription>
            Choose access.
          </DialogDescription>
        </DialogHeader>

        {isSigned ? (
          <div className="rounded-[11px] bg-[#F2FBF5] p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-[#225B36]">
              <Check className="h-4 w-4" />
              Signed by {signedByName}
            </div>
            {signedAt ? (
              <div className="mt-0.5 text-xs text-[#225B36]">
                {new Date(signedAt).toLocaleString()}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* People with access */}
        <div>
          <div className="mb-2 font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
            People with access
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-[#E8E8EC] bg-[#FFF0E6]">
              <User className="h-4 w-4 text-[#D14E00]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[#131315]">You</div>
              <div className="text-[11px] text-[#6E6E73]">
                Your team
              </div>
            </div>
            <span className="rounded-full bg-[#F1F1F3] px-2.5 py-1 text-xs font-medium text-[#6E6E73]">
              Owner
            </span>
          </div>
        </div>

        {/* General access — link sharing with a role */}
        <div className="border-t border-[#F1F1F3] pt-3">
          <div className="mb-2 font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
            General access
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-[#E8E8EC] bg-[#FAFAFA]">
              {linkEnabled ? (
                <Globe className="h-4 w-4 text-[#131315]" />
              ) : (
                <Lock className="h-4 w-4 text-[#A0A0A5]" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              {/* Restricted ⇄ Anyone-with-link */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="-ml-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-semibold text-[#131315] hover:bg-[#F1F1F3]"
                  >
                    {linkEnabled ? "Anyone with link" : "Restricted"}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[200px]">
                  <DropdownMenuItem onClick={() => setLinkEnabled(false)}>
                    Restricted
                    {!linkEnabled ? (
                      <Check className="ml-auto h-3.5 w-3.5 text-[#D14E00]" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLinkEnabled(true)}>
                    Anyone with link
                    {linkEnabled ? (
                      <Check className="ml-auto h-3.5 w-3.5 text-[#D14E00]" />
                    ) : null}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="text-[11px] text-[#6E6E73]">
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
                    className="inline-flex h-8 items-center gap-1 rounded-full border border-[#D8D8DE] bg-white px-3 text-xs font-medium text-[#131315] hover:bg-[#F1F1F3]"
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
                      <span className="flex w-full items-center justify-between font-semibold">
                        {ROLE_META[r].label}
                        {role === r ? (
                          <Check className="h-3.5 w-3.5 text-[#D14E00]" />
                        ) : null}
                      </span>
                      <span className="text-[11px] text-[#6E6E73]">
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
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-full border border-[#D8D8DE] bg-white px-3.5 text-xs font-medium text-[#131315] hover:bg-[#F1F1F3] disabled:opacity-50"
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
          <div className="border-t border-[#F1F1F3] pt-3">
            <div className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
              Signing
            </div>
            <p className="mb-2 text-xs text-[#6E6E73]">
              Add signers, place fields, and send. Includes tamper-evident
              hashing, consent, IP, an audit trail, and a completion certificate.
            </p>
            <button
              type="button"
              onClick={() => void handleSetUpSigning()}
              disabled={busy === "sign"}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-[#131315] px-3.5 text-xs font-medium text-white hover:bg-[#26262A] disabled:opacity-50"
            >
              <FileSignature className="h-3.5 w-3.5" />
              {busy === "sign" ? "Opening…" : "Set up signing"}
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 rounded-[11px] bg-[#FFF5F5] p-3 text-xs font-medium text-[#8A2B34]">
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
