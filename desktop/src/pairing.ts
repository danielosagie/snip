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

export type PairingFailureCode =
  | "cancelled"
  | "expired"
  | "consumed"
  | "unknown"
  | "timeout"
  | "browser"
  | "network";

export class PairingError extends Error {
  constructor(
    readonly code: PairingFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "PairingError";
  }
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
  webOrigin?: string;
  onOpened?: (url: string) => void;
  signal?: { cancelled: boolean };
}): Promise<PairingResult> {
  const code = makeCode();
  const client = new ConvexClient(CONVEX_URL);
  try {
    try {
      await client.mutation(
        "desktopAuth:createPairing" as unknown as Parameters<
          typeof client.mutation
        >[0],
        { code, deviceLabel: opts.deviceLabel },
      );
    } catch {
      throw new PairingError(
        "network",
        "Could not start the connection. Check your network and try again.",
      );
    }

    if (opts.signal?.cancelled) {
      throw new PairingError(
        "cancelled",
        "Connection cancelled. Try again or use email.",
      );
    }

    const webOrigin = opts.webOrigin?.trim() || WEB_ORIGIN;
    const url = `${webOrigin.replace(/\/$/, "")}/connect-desktop?code=${code}`;
    try {
      await api.shell.openExternal(url);
    } catch {
      throw new PairingError(
        "browser",
        "Could not open your browser. Try again.",
      );
    }
    opts.onOpened?.(url);

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (opts.signal?.cancelled) {
        throw new PairingError(
          "cancelled",
          "Connection cancelled. Try again or use email.",
        );
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (opts.signal?.cancelled) {
        throw new PairingError(
          "cancelled",
          "Connection cancelled. Try again or use email.",
        );
      }

      let res: PollResponse;
      try {
        res = (await client.mutation(
          "desktopAuth:pollPairing" as unknown as Parameters<
            typeof client.mutation
          >[0],
          { code },
        )) as PollResponse;
      } catch {
        throw new PairingError(
          "network",
          "Connection lost. Check your network and try again.",
        );
      }

      if (res.status === "approved") {
        return {
          signInToken: res.signInToken,
          userName: res.userName,
          storage: res.storage,
        };
      }
      if (res.status === "expired") {
        throw new PairingError("expired", "Connection expired. Try again.");
      }
      if (res.status === "consumed") {
        throw new PairingError(
          "consumed",
          "Connection already used. Try again.",
        );
      }
      if (res.status === "unknown") {
        throw new PairingError("unknown", "Connection not found. Try again.");
      }
      // The pending state keeps polling while the waiting screen stays visible.
    }
    throw new PairingError("timeout", "No approval received. Try again.");
  } finally {
    client.close();
  }
}
