import { useQuery, type ConvexReactClient } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  makeRouteQuerySpec,
  prewarmSpecs,
} from "@/lib/convexRouteData";

export function useInvoiceListData(teamSlug: string) {
  const context = useQuery(api.workspace.resolveContext, { teamSlug });
  const teamId = context?.team._id;
  const invoices = useQuery(
    api.invoices.listByTeam,
    teamId ? { teamId } : "skip",
  );

  return { context, invoices };
}

export function useInvoiceDetailData(
  teamSlug: string,
  invoiceId: Id<"invoices"> | null,
) {
  const context = useQuery(api.workspace.resolveContext, { teamSlug });
  const invoice = useQuery(
    api.invoices.get,
    invoiceId ? { invoiceId } : "skip",
  );

  return { context, invoice };
}

export async function prewarmInvoiceList(
  convex: ConvexReactClient,
  teamSlug: string,
) {
  prewarmSpecs(convex, [
    makeRouteQuerySpec(api.workspace.resolveContext, { teamSlug }),
  ]);

  try {
    const context = await convex.query(api.workspace.resolveContext, {
      teamSlug,
    });
    if (!context?.team._id) return;
    prewarmSpecs(convex, [
      makeRouteQuerySpec(api.invoices.listByTeam, {
        teamId: context.team._id,
      }),
    ]);
  } catch (error) {
    console.warn("Invoice prewarm failed", error);
  }
}

export function prewarmInvoiceDetail(
  convex: ConvexReactClient,
  invoiceId: Id<"invoices">,
) {
  prewarmSpecs(convex, [
    makeRouteQuerySpec(api.invoices.get, { invoiceId }),
  ]);
}
