import { createFileRoute } from "@tanstack/react-router";
import { seoHead } from "@/lib/seo";
import { ContractDocEditorPage } from "./-contractDocEditor";

// Plain documents share the contracts table (docType: "document") but
// get their own /doc/ URL space — nothing about a document should be
// contract-branded, including the address bar and the tab title. The
// shared page redirects to /contract/$contractId if the row is
// actually a contract.
export const Route = createFileRoute(
  "/dashboard/$teamSlug/$projectId/doc/$contractId",
)({
  head: () =>
    seoHead({
      title: "Document",
      description: "Edit this document.",
      path: "/dashboard",
      noIndex: true,
    }),
  component: DocumentEditorRoute,
});

function DocumentEditorRoute() {
  return <ContractDocEditorPage mode="document" />;
}
