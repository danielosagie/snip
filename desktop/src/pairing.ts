/**
 * Device-pairing client. Drives the zero-setup hand-off:
 *
 *   1. mint a 128-bit code, register it (public, unauthenticated mutation)
 *   2. open the web /connect-desktop?code=… in the user's browser
 *   3. poll until the signed-in user approves → receive the one-time
 *      Clerk sign-in token + storage bootstrap
 *
 * The caller redeems the sign-in token with Clerk JS to establish the
 * desktop's own durable session. No URL, token, or bucket creds typed.
 */

import { ConvexClient } from "convex/browser";
import { api } from "./api";
import { CONVEX_URL, WEB_ORIGIN } from "./config";

export interface PairingStorage {
  provider: "r2" | "railway";
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface PairingResult {
  signInToken: string;
  userName: string | null;
  storage: PairingStorage | null;
}

type PollResponse =
  | { status: "pending" }
  | { status: "unknown" }
  | { status: "expired" }
  | { status: "consumed" }
  | {
      status: "approved";
      signInToken: string;
      userName: string | null;
      storage: PairingStorage | null;
    };

function makeCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Runs the full pairing flow. `onPending` fires once the browser has been
 * opened so the UI can show "waiting for you to approve in the browser".
 * Rejects on expiry, timeout, or explicit cancellation via `signal`.
 */
export async function runPairing(opts: {
  deviceLabel?: string;
  onOpened?: (url: string) => void;
  signal?: { cancelled: boolean };
}): Promise<PairingResult> {
  const code = makeCode();
  const client = new ConvexClient(CONVEX_URL);
  try {
    await client.mutation(
      "desktopAuth:createPairing" as unknown as Parameters<
        typeof client.mutation
      >[0],
      { code, deviceLabel: opts.deviceLabel },
    );

    const url = `${WEB_ORIGIN.replace(/\/$/, "")}/connect-desktop?code=${code}`;
    await api.shell.openExternal(url);
    opts.onOpened?.(url);

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (opts.signal?.cancelled) throw new Error("Pairing cancelled.");
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const res = (await client.mutation(
        "desktopAuth:pollPairing" as unknown as Parameters<
          typeof client.mutation
        >[0],
        { code },
      )) as PollResponse;

      if (res.status === "approved") {
        return {
          signInToken: res.signInToken,
          userName: res.userName,
          storage: res.storage,
        };
      }
      if (res.status === "expired") {
        throw new Error("The pairing request expired. Try again.");
      }
      if (res.status === "consumed") {
        throw new Error("This pairing was already used. Try again.");
      }
      if (res.status === "unknown") {
        throw new Error("Pairing was lost server-side. Try again.");
      }
      // pending → keep polling
    }
    throw new Error("Pairing timed out. Try again.");
  } finally {
    client.close();
  }
}
