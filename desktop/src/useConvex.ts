import { ConvexClient } from "convex/browser";
import { useEffect, useMemo, useState } from "react";
import { CONVEX_URL } from "./config";

/**
 * Convex client wired to the desktop's own Clerk session. Pass a token
 * getter (Clerk's `getToken({ template: "convex" })`); Convex calls it on
 * its own refresh cycle, so auth stays live for as long as the Clerk
 * session does — no pasted, expiring tokens. The deployment URL is baked
 * in (config.ts), never typed.
 */

export function useConvexClient(
  getToken: (() => Promise<string | null>) | null,
  // Advanced/self-host escape hatch: a manually pasted token used only
  // when there's no Clerk session.
  fallbackToken?: string,
) {
  const client = useMemo(() => {
    try {
      return new ConvexClient(CONVEX_URL);
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!client) return;
    if (getToken) {
      client.setAuth(async () => {
        try {
          return await getToken();
        } catch {
          return null;
        }
      });
    } else if (fallbackToken) {
      client.setAuth(async () => fallbackToken);
    } else {
      client.setAuth(async () => null);
    }
    return () => {
      client.close();
    };
  }, [client, getToken, fallbackToken]);

  return client;
}

/**
 * Lightweight reactive query — re-runs when args change, refreshes on
 * server updates via Convex subscriptions. Returns `undefined` while
 * loading.
 */
export function useConvexQuery<T>(
  client: ConvexClient | null,
  // Convex function reference as a path string, e.g. "teams:list".
  functionPath: string,
  args: Record<string, unknown> | "skip",
): T | undefined {
  const [data, setData] = useState<T | undefined>(undefined);

  useEffect(() => {
    if (!client || args === "skip") {
      setData(undefined);
      return;
    }
    const unsubscribe = client.onUpdate(
      // The TS types for ConvexClient.onUpdate accept FunctionReference, but
      // we pass a string path here for simplicity. Cast through unknown.
      functionPath as unknown as Parameters<typeof client.onUpdate>[0],
      args,
      (next) => setData(next as T),
    );
    return () => unsubscribe();
  }, [client, functionPath, JSON.stringify(args)]);

  return data;
}

export async function callAction<T>(
  client: ConvexClient | null,
  actionPath: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!client) throw new Error("Convex client not initialized");
  return (await client.action(
    actionPath as unknown as Parameters<typeof client.action>[0],
    args,
  )) as T;
}

export async function callMutation<T>(
  client: ConvexClient | null,
  mutationPath: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!client) throw new Error("Convex client not initialized");
  return (await client.mutation(
    mutationPath as unknown as Parameters<typeof client.mutation>[0],
    args,
  )) as T;
}
