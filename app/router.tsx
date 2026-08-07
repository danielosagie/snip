import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { NotFound } from "@/components/ui/NotFound";

function DefaultPending() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA]">
      <div className="text-sm text-[#6E6E73]">Loading</div>
    </div>
  );
}

function DefaultNotFound() {
  return <NotFound />;
}

export function getRouter() {
  // @ts-expect-error TanStack Router's typings require strictNullChecks=true.
  const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultPendingComponent: DefaultPending,
    defaultNotFoundComponent: DefaultNotFound,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
