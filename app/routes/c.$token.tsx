import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { SnipMark } from "@/components/SnipMark";
import { sanitizeHtml } from "@/lib/sanitizeHtml";

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
        <p className="text-[#6E6E73]">Loading…</p>
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
    <div className="surface-client surface-soft min-h-screen bg-[#FAFAFA]">
      <header className="flex items-center justify-between border-b border-[#E8E8EC] bg-white px-6 py-4">
        <SnipMark />
        <span className="text-xs font-medium text-[#6E6E73]">
          {role === "edit" ? "Edit access" : "Read-only access"}
        </span>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-6">
        <div>
          <div className="font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
            {project.name}
          </div>
          <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-[-0.02em] text-[#131315] md:text-[40px]">
            Contract
          </h1>
          {contract.signedAt ? (
            <p className="mt-3 inline-flex rounded-full bg-[#F2FBF5] px-3 py-1 text-xs font-medium text-[#225B36]">
              Signed by {contract.signedByName ?? "client"},{" "}
              {new Date(contract.signedAt).toLocaleDateString()}
            </p>
          ) : contract.sentForSignatureAt ? (
            <p className="mt-3 inline-flex rounded-full bg-[#FFF0E6] px-3 py-1 text-xs font-medium text-[#D14E00]">
              Sent for signature
            </p>
          ) : null}
        </div>

        <article className="rounded-[14px] border border-[#E8E8EC] bg-white p-8">
          <div
            className="prose prose-sm max-w-none text-[#131315]"
            dangerouslySetInnerHTML={{
              __html: contract.contentHtml
                ? sanitizeHtml(contract.contentHtml)
                : "<p><em>(no body yet)</em></p>",
            }}
          />
        </article>

        {role === "edit" ? (
          <div className="rounded-[11px] border border-[#E8E8EC] bg-[#FFF0E6] p-4 text-xs text-[#131315]">
            <span className="font-medium text-[#D14E00]">
              Edit access pending
            </span>
            <p className="mt-1 text-[#6E6E73]">
              Inline editing without a snip account is in the works. For now,
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
    <div className="surface-client surface-soft flex min-h-screen flex-col bg-[#FAFAFA]">
      <header className="border-b border-[#E8E8EC] bg-white px-6 py-4">
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
    <div className="w-full max-w-md rounded-[14px] border border-[#E8E8EC] bg-white p-8 text-center">
      <h2 className="mb-3 text-[22px] font-semibold tracking-[-0.02em] text-[#131315]">
        {title}
      </h2>
      <p className="text-sm text-[#6E6E73]">{children}</p>
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
