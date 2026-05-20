import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { SnipMark } from "@/components/SnipMark";

/**
 * Public-by-token contract viewer. Consumes the token written by
 * `projects.createContractShareLink` and renders the contract body
 * read-only. Editing (when `role === "edit"`) is v2 — until the
 * collaborative-edit-without-auth flow lands, viewers see the same
 * surface as reviewers and can't change the body.
 */

export const Route = createFileRoute("/c/$token")({
  component: ContractShareViewer,
});

function ContractShareViewer() {
  const { token } = useParams({ from: "/c/$token" });
  const data = useQuery(api.projects.getContractByToken, { token });

  if (data === undefined) {
    return (
      <Shell>
        <p className="text-[#888]">Loading…</p>
      </Shell>
    );
  }
  if (data === null) {
    return (
      <Shell>
        <Terminal title="Link not found">
          This contract link doesn't exist. Double-check the URL or ask the
          sender for a fresh one.
        </Terminal>
      </Shell>
    );
  }
  if (data.status !== "ok") {
    return (
      <Shell>
        <Terminal title={terminalTitle(data.status)}>
          {terminalBody(data.status)}
        </Terminal>
      </Shell>
    );
  }

  const { contract, project, role } = data;

  return (
    <div className="min-h-screen bg-[#f0f0e8]">
      <header className="border-b-2 border-[#1a1a1a] bg-[#f0f0e8] px-6 py-4 flex items-center justify-between">
        <SnipMark />
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
          {role === "edit" ? "Edit access" : "Read-only access"}
        </span>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-6">
        <div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
            {project.name}
          </div>
          <h1 className="text-5xl md:text-6xl font-black uppercase tracking-tighter leading-[0.95] mt-2 text-[#1a1a1a]">
            Contract
          </h1>
          {contract.signedAt ? (
            <p className="mt-3 inline-block border-2 border-[#16a34a] bg-[#f0f0e8] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#16a34a]">
              Signed by {contract.signedByName ?? "client"} ·{" "}
              {new Date(contract.signedAt).toLocaleDateString()}
            </p>
          ) : contract.sentForSignatureAt ? (
            <p className="mt-3 inline-block border-2 border-[#C2410C] bg-[#FFEDD5] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#C2410C]">
              Sent for signature
            </p>
          ) : null}
        </div>

        <article className="border-2 border-[#1a1a1a] bg-white p-8">
          <div
            className="prose prose-sm max-w-none text-[#1a1a1a]"
            dangerouslySetInnerHTML={{
              __html: contract.contentHtml || "<p><em>(no body yet)</em></p>",
            }}
          />
        </article>

        {role === "edit" ? (
          <div className="border-2 border-dashed border-[#1a1a1a]/30 bg-[#FFEDD5] p-4 text-xs text-[#1a1a1a]">
            <span className="font-bold uppercase tracking-wider text-[#C2410C]">
              Edit access pending
            </span>
            <p className="mt-1 text-[#1a1a1a]/80">
              Inline editing without a snip account is in the works — for now
              this link is view-only. Reply to the agency directly with your
              feedback.
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f0f0e8] flex flex-col">
      <header className="border-b-2 border-[#1a1a1a] bg-[#f0f0e8] px-6 py-4">
        <SnipMark />
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        {children}
      </main>
    </div>
  );
}

function Terminal({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-md w-full border-2 border-[#1a1a1a] bg-[#f0f0e8] shadow-[8px_8px_0px_0px_#1a1a1a] p-8 text-center">
      <h2 className="text-3xl font-black uppercase tracking-tighter text-[#1a1a1a] mb-3">
        {title}
      </h2>
      <p className="text-sm text-[#1a1a1a]">{children}</p>
    </div>
  );
}

function terminalTitle(status: string): string {
  switch (status) {
    case "revoked":
      return "Link revoked";
    case "expired":
      return "Link expired";
    case "missing":
      return "Contract not found";
    default:
      return "Unavailable";
  }
}

function terminalBody(status: string): string {
  switch (status) {
    case "revoked":
      return "This share link has been revoked by the agency. Reach out to them for a new one.";
    case "expired":
      return "This share link has expired. Ask the sender to send a new one.";
    case "missing":
      return "The contract behind this link was deleted. Ask the sender to draft a new contract and share again.";
    default:
      return "This contract isn't available.";
  }
}
