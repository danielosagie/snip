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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  Copy,
  ExternalLink,
  PenSquare,
  Eye,
  FileSignature,
  Send,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Share dialog for the contract. Replaces the single "Send for
 * signature" button with a multi-tab dialog so the user can invite
 * three flavors of collaborator:
 *
 *   - **Signer** — the client. Routes through the existing
 *     `sendContractForSignature` mutation (production: Dropbox Sign
 *     or Docusign; demo: simulated).
 *   - **Reviewer** — read-only access via a share link. Hooked up to
 *     a placeholder for now; real implementation lands when we wire
 *     the contract-share-link table.
 *   - **Editor** — full edit access via a share link. Same as
 *     reviewer at the data layer for now; just shown so the user can
 *     see the intended access model.
 *
 * The "demo sign as client" affordance that used to live below the
 * contract canvas now lives inside the Signer tab, so the doc area
 * stays clean.
 */

interface Props {
  projectId: Id<"projects">;
  teamSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractState: "none" | "draft" | "awaiting" | "signed";
  signedByName: string | undefined;
  signedAt: number | undefined;
}

type Tab = "sign" | "review" | "edit";

const TAB_META: Record<
  Tab,
  { label: string; icon: React.ReactNode; help: string }
> = {
  sign: {
    label: "Set up signing",
    icon: <FileSignature className="h-3.5 w-3.5" />,
    help: "Opens the signing editor: add signers, place signature fields, and send. Signing is recorded with a tamper-evident hash, ESIGN consent, IP + audit trail, and a Certificate of Completion.",
  },
  review: {
    label: "Invite reviewer",
    icon: <Eye className="h-3.5 w-3.5" />,
    help: "Read-only access. Reviewers can read the contract + leave comments but can't change the text.",
  },
  edit: {
    label: "Invite editor",
    icon: <PenSquare className="h-3.5 w-3.5" />,
    help: "Full edit access. Co-editors see live cursors and can change any section.",
  },
};

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

  const [tab, setTab] = useState<Tab>("sign");
  const [signerEmail, setSignerEmail] = useState("");
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [editorEmail, setEditorEmail] = useState("");
  const [demoSignName, setDemoSignName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Cache one link per role so repeated copies hand back the same URL
  // instead of minting a fresh row on every click.
  const [linkUrls, setLinkUrls] = useState<Record<"review" | "edit", string | undefined>>({
    review: undefined,
    edit: undefined,
  });

  // Bridge the legacy contract into the real, court-grade multi-contract signing
  // editor (recipients, field placement, audit trail, certificate) instead of
  // the old no-op stamp. Both the "send" and the former "demo sign" actions go
  // here now — no more stub signing.
  const startRealSigning = async () => {
    setBusy("send");
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

  const handleSend = startRealSigning;
  const handleDemoSign = startRealSigning;

  const copyShareLink = async (kind: "review" | "edit") => {
    setError(null);
    try {
      let url = linkUrls[kind];
      if (!url) {
        setBusy(`copy:${kind}`);
        const { token } = await createContractShareLink({
          projectId,
          role: kind,
        });
        const origin =
          typeof window !== "undefined" ? window.location.origin : "";
        url = `${origin}/c/${token}`;
        setLinkUrls((prev) => ({ ...prev, [kind]: url }));
      }
      await navigator.clipboard.writeText(url);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1800);
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

  const isSigned = contractState === "signed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share contract</DialogTitle>
          <DialogDescription>
            Pick who gets in and what they can do.
          </DialogDescription>
        </DialogHeader>

        {/* Tab strip — sticks to the brutalist palette so it reads
            as a deliberate control row, not an afterthought. */}
        <div className="flex border-2 border-[#1a1a1a]">
          {(Object.keys(TAB_META) as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setError(null);
                setNotice(null);
              }}
              className={cn(
                "flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors",
                tab === t
                  ? "bg-[#1a1a1a] text-[#f0f0e8]"
                  : "bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#e8e8e0]",
              )}
            >
              {TAB_META[t].icon}
              <span className="hidden sm:inline">{TAB_META[t].label}</span>
              <span className="sm:hidden">{t}</span>
            </button>
          ))}
        </div>

        <p className="text-xs text-[#666]">{TAB_META[tab].help}</p>

        {tab === "sign" ? (
          <div className="space-y-3">
            {isSigned ? (
              <div className="border-2 border-[#FF6600] bg-[#FFE7D6] p-3">
                <div className="font-bold text-sm text-[#FF6600] flex items-center gap-2">
                  <Check className="h-4 w-4" />
                  Signed by {signedByName}
                </div>
                {signedAt ? (
                  <div className="text-xs text-[#666] mt-0.5">
                    {new Date(signedAt).toLocaleString()}
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <Field label="Signer email (client)">
                  <Input
                    type="email"
                    placeholder="client@acme.com"
                    value={signerEmail}
                    onChange={(e) => setSignerEmail(e.target.value)}
                  />
                </Field>
                <Button
                  onClick={() => void handleSend()}
                  disabled={busy !== null}
                  className="bg-[#FF6600] hover:bg-[#FF7A1F] w-full"
                >
                  <Send className="h-4 w-4 mr-1.5" />
                  {busy === "send" ? "Sending…" : "Send for signature"}
                </Button>

                <div className="pt-3 border-t-2 border-[#1a1a1a]">
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-2">
                    Demo sign as client
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Client name"
                      value={demoSignName}
                      onChange={(e) => setDemoSignName(e.target.value)}
                    />
                    <Button
                      onClick={() => void handleDemoSign()}
                      disabled={busy !== null || !demoSignName.trim()}
                      variant="outline"
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Sign
                    </Button>
                  </div>
                  <p className="text-[11px] font-mono text-[#888] mt-2">
                    In production this routes through Dropbox Sign /
                    Docusign — the demo button skips that and stamps
                    the contract locally so you can click through the
                    rest of the flow.
                  </p>
                </div>
              </>
            )}
          </div>
        ) : null}

        {tab === "review" ? (
          <ShareLinkPanel
            badge="Read-only"
            email={reviewerEmail}
            onEmailChange={setReviewerEmail}
            onCopyLink={() => void copyShareLink("review")}
            copied={copied === "review"}
          />
        ) : null}

        {tab === "edit" ? (
          <ShareLinkPanel
            badge="Can edit"
            email={editorEmail}
            onEmailChange={setEditorEmail}
            onCopyLink={() => void copyShareLink("edit")}
            copied={copied === "edit"}
          />
        ) : null}

        {error ? (
          <div className="text-xs text-[#dc2626] font-bold flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5" />
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="text-xs text-[#FF6600] font-bold">{notice}</div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareLinkPanel({
  badge,
  email,
  onEmailChange,
  onCopyLink,
  copied,
}: {
  badge: string;
  email: string;
  onEmailChange: (next: string) => void;
  onCopyLink: () => void;
  copied: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{badge}</Badge>
        <span className="text-[10px] font-mono text-[#888]">
          Public link — anyone with the URL can open the contract
        </span>
      </div>
      <Field label="Invite by email">
        <Input
          type="email"
          placeholder="teammate@studio.com"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
        />
      </Field>
      <Button disabled={!email.trim()} variant="outline" className="w-full">
        <Send className="h-4 w-4 mr-1.5" />
        Send invite
      </Button>

      <div className="pt-3 border-t-2 border-[#1a1a1a]">
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-2">
          Or copy link
        </div>
        <Button onClick={onCopyLink} variant="outline" className="w-full">
          {copied ? (
            <>
              <Check className="h-4 w-4 mr-1.5" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4 mr-1.5" />
              Copy share link
            </>
          )}
          <ExternalLink className="h-3.5 w-3.5 ml-auto opacity-60" />
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.15em] text-[#888] font-bold mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}
