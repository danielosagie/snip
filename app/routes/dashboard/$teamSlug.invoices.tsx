import { createFileRoute, Link } from "@tanstack/react-router";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo, useState } from "react";
import { Copy, MoreHorizontal, Pencil, Plus, ReceiptText } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  InvoiceStatusPill,
  type InvoiceStatus,
} from "@/components/invoices/InvoiceStatusPill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SoftCard, SoftPage } from "@/components/soft";
import { formatUsdCents } from "@/lib/money";
import { publicInvoiceUrl } from "@/lib/publicUrl";
import { invoicePath, teamHomePath } from "@/lib/routes";
import { seoHead } from "@/lib/seo";
import { useRoutePrewarmIntent } from "@/lib/useRoutePrewarmIntent";
import {
  prewarmInvoiceDetail,
  useInvoiceListData,
} from "./-invoices.data";

type InvoiceListItem = FunctionReturnType<
  typeof api.invoices.listByTeam
>[number] & { payToken?: string };

export const Route = createFileRoute("/dashboard/$teamSlug/invoices")({
  head: () =>
    seoHead({
      title: "Invoices",
      description: "Manage client invoices.",
      path: "/dashboard",
      noIndex: true,
    }),
  component: InvoiceListRoute,
});

function InvoiceListRoute() {
  const { teamSlug } = Route.useParams();
  const { context, invoices } = useInvoiceListData(teamSlug);
  const sortedInvoices = useMemo(
    () =>
      invoices
        ? [...invoices].sort(
            (left, right) => right._creationTime - left._creationTime,
          )
        : [],
    [invoices],
  );

  if (context === undefined || (context && invoices === undefined)) {
    return <InvoiceListSkeleton />;
  }

  if (!context) {
    return <InvoiceListMessage message="Workspace not found." />;
  }

  const canManage = context.team.role !== "viewer";
  return (
    <div className="flex h-full flex-col">
      <DashboardHeader
        paths={[
          {
            label: context.team.name,
            href: teamHomePath(context.team.slug),
          },
          { label: "Invoices" },
        ]}
      />
      <SoftPage
        title="Invoices"
        aside={canManage ? <NewInvoiceButton teamSlug={teamSlug} /> : null}
      >
        {sortedInvoices.length === 0 ? (
          <SoftCard className="flex min-h-48 flex-col items-center justify-center gap-4 text-center">
            <p className="text-sm text-[#6E6E73]">No invoices yet.</p>
            {canManage ? <NewInvoiceButton teamSlug={teamSlug} /> : null}
          </SoftCard>
        ) : (
          <SoftCard className="overflow-hidden px-0 py-0 sm:px-0 sm:py-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[28%]" />
                  <col className="w-[20%]" />
                  <col className="w-[15%]" />
                  <col className="w-[13%]" />
                  <col className="w-[13%]" />
                  <col className="w-[11%]" />
                </colgroup>
                <thead>
                  <tr className="font-['Geist_Mono',system-ui,sans-serif] text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
                    <th className="px-6 py-3 font-medium">Title</th>
                    <th className="px-3 py-3 font-medium">Client</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 text-right font-medium">Total</th>
                    <th className="px-3 py-3 text-right font-medium">Paid</th>
                    <th className="px-6 py-3 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedInvoices.map((invoice) => (
                    <InvoiceTableRow
                      key={invoice._id}
                      invoice={invoice}
                      teamSlug={teamSlug}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </SoftCard>
        )}
      </SoftPage>
    </div>
  );
}

function InvoiceTableRow({
  invoice,
  teamSlug,
}: {
  invoice: InvoiceListItem;
  teamSlug: string;
}) {
  const convex = useConvex();
  const [copied, setCopied] = useState(false);
  const detailPath = invoicePath(teamSlug, invoice._id);
  const prewarmIntentHandlers = useRoutePrewarmIntent(() =>
    prewarmInvoiceDetail(convex, invoice._id as Id<"invoices">),
  );
  const totalCents = invoice.milestones.reduce(
    (sum, milestone) => sum + milestone.amountCents,
    0,
  );
  const paidCents = invoice.milestones.reduce(
    (sum, milestone) =>
      sum + (milestone.paidAt !== undefined ? milestone.amountCents : 0),
    0,
  );
  const client = invoice.clientLabel?.trim() || invoice.clientEmail;
  const payUrl = invoice.payToken
    ? publicInvoiceUrl(invoice.payToken)
    : null;
  const amountClass =
    invoice.status === "void" ? "text-[#A0A0A5] line-through" : "text-[#131315]";

  const copyPayLink = async () => {
    if (!payUrl) return;
    try {
      await navigator.clipboard.writeText(payUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <tr className="border-t border-[#F1F1F3] text-[#131315]">
      <td className="px-6 py-3.5">
        <Link
          to={detailPath}
          preload="intent"
          className="block truncate font-medium hover:underline focus-visible:rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315]"
          {...prewarmIntentHandlers}
        >
          {invoice.title}
        </Link>
      </td>
      <td className="px-3 py-3.5 text-[#6E6E73]">
        <span className="block truncate" title={client}>
          {client}
        </span>
      </td>
      <td className="px-3 py-3.5">
        <InvoiceStatusPill status={invoice.status as InvoiceStatus} />
      </td>
      <td className={`px-3 py-3.5 text-right tabular-nums ${amountClass}`}>
        {formatUsdCents(totalCents)}
      </td>
      <td className="px-3 py-3.5 text-right tabular-nums text-[#6E6E73]">
        {formatUsdCents(paidCents)}
      </td>
      <td className="px-6 py-3.5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`Actions for ${invoice.title}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={detailPath} preload="intent">
                {invoice.status === "draft" ? (
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                ) : (
                  <ReceiptText className="mr-2 h-3.5 w-3.5" />
                )}
                {invoice.status === "draft" ? "Edit" : "Open"}
              </Link>
            </DropdownMenuItem>
            {payUrl ? (
              <DropdownMenuItem onSelect={() => void copyPayLink()}>
                <Copy className="mr-2 h-3.5 w-3.5" />
                {copied ? "Copied" : "Copy link"}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function NewInvoiceButton({ teamSlug }: { teamSlug: string }) {
  return (
    <Button asChild>
      <Link to={invoicePath(teamSlug, "new")}>
        <Plus />
        New invoice
      </Link>
    </Button>
  );
}

function InvoiceListSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <DashboardHeader paths={[{ label: "Invoices" }]} />
      <SoftPage title="Invoices">
        <SoftCard className="space-y-3" aria-label="Loading invoices">
          {[0, 1, 2, 3].map((row) => (
            <div
              key={row}
              className="h-11 animate-pulse rounded-[10px] bg-[#F1F1F3]"
            />
          ))}
        </SoftCard>
      </SoftPage>
    </div>
  );
}

function InvoiceListMessage({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col">
      <DashboardHeader paths={[{ label: "Invoices" }]} />
      <SoftPage title="Invoices">
        <SoftCard>
          <p className="text-sm text-[#6E6E73]">{message}</p>
        </SoftCard>
      </SoftPage>
    </div>
  );
}
