import { createFileRoute } from "@tanstack/react-router";
import { seoHead } from "@/lib/seo";
import { ContractDocEditorPage } from "./-contractDocEditor";

// NOTE the `contract_` (un-nested) filename: the legacy single-contract
// editor at /…/contract renders no <Outlet/>, so a route nested inside
// it can never mount. Un-nesting keeps the /contract/$contractId URL
// while rendering this editor directly under the project layout.
export const Route = createFileRoute(
  "/dashboard/$teamSlug/$projectId/contract_/$contractId",
)({
  head: () =>
    seoHead({
      title: "Contract",
      description: "Edit this contract.",
      path: "/dashboard",
      noIndex: true,
    }),
  component: ContractEditorRoute,
});

function ContractEditorRoute() {
  return <ContractDocEditorPage mode="contract" />;
}
