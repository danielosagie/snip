"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getIdentity } from "./auth";

/**
 * Vends storage credentials for the signed-in user.
 *
 * The previous model handed the deployment-wide bucket access key +
 * secret to ANY authenticated caller, and folder ACLs were only
 * enforced by the client-side rclone filter. This replaces that with
 * per-user, short-lived, prefix-scoped credentials:
 *
 *   - R2     → Cloudflare Temporary Access Credentials API, scoped to
 *              the user's `projects/<teamSlug>/` prefixes.
 *   - S3/MinIO → STS AssumeRole with an inline session policy scoped to
 *              the same prefixes.
 *
 * The credential itself cannot read outside the granted prefixes, so
 * this is real server-side enforcement (cross-team isolation) rather
 * than a client honor-system filter.
 *
 * If neither scoping mechanism is configured in the deployment env, it
 * falls back to the shared bucket credentials — but ONLY for actual
 * team members — so deployments that haven't provisioned scoping yet
 * keep working while the blast radius shrinks from "any signed-in user"
 * to "team members". Provision the env below to turn on full scoping.
 *
 * Env to enable scoping:
 *   R2:     R2_ACCOUNT_ID, R2_API_TOKEN (Cloudflare token w/ R2 temp-cred
 *           permission). Reuses R2_ACCESS_KEY_ID as the parent key.
 *   S3/MinIO: STS_ROLE_ARN (+ optional STS_ENDPOINT, STS_REGION). Uses
 *           the existing RAILWAY_* creds as the AssumeRole caller.
 */

type Provider = "r2" | "railway";

export type StorageCredentials = {
  provider: Provider;
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  // Present for scoped (temporary) credentials; null for the legacy
  // shared key. Desktop must pass it to rclone / the S3 client.
  sessionToken: string | null;
  // Epoch ms when the credential expires; null = long-lived shared key.
  // Desktop re-vends (and remounts) before this.
  expiresAt: number | null;
  scoped: boolean;
  prefixes: string[];
};

function detectProvider(): Provider | null {
  if (process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
    return "r2";
  }
  if (
    process.env.RAILWAY_ACCESS_KEY_ID &&
    process.env.RAILWAY_SECRET_ACCESS_KEY
  ) {
    return "railway";
  }
  return null;
}

function readSharedCredentials(): StorageCredentials | null {
  const env = process.env;
  if (env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    return {
      provider: "r2",
      bucket: env.R2_BUCKET_NAME ?? "",
      endpoint: env.R2_ENDPOINT ?? "",
      region: env.R2_REGION ?? "auto",
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      sessionToken: null,
      expiresAt: null,
      scoped: false,
      prefixes: [],
    };
  }
  if (env.RAILWAY_ACCESS_KEY_ID && env.RAILWAY_SECRET_ACCESS_KEY) {
    return {
      provider: "railway",
      bucket: env.RAILWAY_BUCKET_NAME ?? "",
      endpoint: env.RAILWAY_ENDPOINT ?? "",
      region: env.RAILWAY_REGION ?? "us-east-1",
      accessKeyId: env.RAILWAY_ACCESS_KEY_ID,
      secretAccessKey: env.RAILWAY_SECRET_ACCESS_KEY,
      sessionToken: null,
      expiresAt: null,
      scoped: false,
      prefixes: [],
    };
  }
  return null;
}

const SCOPED_TTL_SECONDS = 3600; // 1h — desktop re-vends before expiry.
const MINT_TIMEOUT_MS = 10_000; // hard cap on the R2 cred-mint request.

function isScopingConfigured(provider: Provider): boolean {
  if (provider === "r2") {
    return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_API_TOKEN);
  }
  return Boolean(process.env.STS_ROLE_ARN);
}

async function mintR2ScopedCredentials(
  prefixes: string[],
): Promise<StorageCredentials | null> {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const apiToken = process.env.R2_API_TOKEN?.trim();
  const parentAccessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  if (!accountId || !apiToken || !parentAccessKeyId || !bucket) return null;
  if (prefixes.length === 0) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MINT_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/temp-access-credentials`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bucket,
          parentAccessKeyId,
          permission: "object-read-write",
          ttlSeconds: SCOPED_TTL_SECONDS,
          prefixes,
        }),
        signal: controller.signal,
      },
    );
  } catch (e) {
    console.error(
      "storageCredentials: R2 temp-cred request failed",
      e instanceof Error ? e.message : e,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "<unreadable>");
    console.error("storageCredentials: R2 temp-cred mint failed", {
      status: resp.status,
      body: body.slice(0, 500),
    });
    return null;
  }
  const json = (await resp.json()) as {
    result?: {
      accessKeyId?: string;
      secretAccessKey?: string;
      sessionToken?: string;
    };
  };
  const r = json.result;
  if (!r?.accessKeyId || !r.secretAccessKey || !r.sessionToken) return null;

  return {
    provider: "r2",
    bucket,
    endpoint: process.env.R2_ENDPOINT?.trim() ?? "",
    region: process.env.R2_REGION?.trim() || "auto",
    accessKeyId: r.accessKeyId,
    secretAccessKey: r.secretAccessKey,
    sessionToken: r.sessionToken,
    expiresAt: Date.now() + SCOPED_TTL_SECONDS * 1000,
    scoped: true,
    prefixes,
  };
}

async function mintStsScopedCredentials(
  prefixes: string[],
): Promise<StorageCredentials | null> {
  const roleArn = process.env.STS_ROLE_ARN?.trim();
  if (!roleArn) return null;
  if (prefixes.length === 0) return null;

  const bucket = process.env.RAILWAY_BUCKET_NAME?.trim();
  const accessKeyId = process.env.RAILWAY_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.RAILWAY_SECRET_ACCESS_KEY?.trim();
  const endpoint = process.env.RAILWAY_ENDPOINT?.trim() ?? "";
  if (!bucket || !accessKeyId || !secretAccessKey) return null;

  const region =
    process.env.STS_REGION?.trim() ||
    process.env.RAILWAY_REGION?.trim() ||
    "us-east-1";

  const { STSClient, AssumeRoleCommand } = await import("@aws-sdk/client-sts");
  const sts = new STSClient({
    region,
    endpoint: process.env.STS_ENDPOINT?.trim() || endpoint || undefined,
    credentials: { accessKeyId, secretAccessKey },
  });

  const policy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        Resource: prefixes.map((p) => `arn:aws:s3:::${bucket}/${p}*`),
      },
      {
        Effect: "Allow",
        Action: ["s3:ListBucket"],
        Resource: [`arn:aws:s3:::${bucket}`],
        Condition: {
          StringLike: { "s3:prefix": prefixes.map((p) => `${p}*`) },
        },
      },
    ],
  });

  const out = await sts.send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: `snip-desktop-${Date.now()}`,
      Policy: policy,
      DurationSeconds: SCOPED_TTL_SECONDS,
    }),
  );
  const c = out.Credentials;
  if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) return null;

  return {
    provider: "railway",
    bucket,
    endpoint,
    region,
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
    expiresAt: c.Expiration ? c.Expiration.getTime() : Date.now() + SCOPED_TTL_SECONDS * 1000,
    scoped: true,
    prefixes,
  };
}

export const getScopedStorageCredentials = action({
  args: {},
  handler: async (ctx): Promise<StorageCredentials> => {
    await getIdentity(ctx); // throws when signed out
    const scope = await ctx.runQuery(
      internal.storageAccess.getUserStorageScope,
      {},
    );
    if (!scope.isMember) {
      throw new Error("Storage access requires team membership.");
    }

    const provider = detectProvider();
    if (!provider) throw new Error("Object storage is not configured.");

    const scoped =
      provider === "r2"
        ? await mintR2ScopedCredentials(scope.prefixes)
        : await mintStsScopedCredentials(scope.prefixes);
    if (scoped) return scoped;

    // Fail closed: if scoping is configured for this provider but the
    // mint failed (network, API error, timeout), do NOT silently hand
    // back the shared long-lived key — that would defeat scoping.
    if (isScopingConfigured(provider)) {
      throw new Error(
        "Failed to mint scoped storage credentials for the configured provider.",
      );
    }

    const shared = readSharedCredentials();
    if (!shared) throw new Error("Object storage is not configured.");
    console.warn(
      "storageCredentials: vending shared (unscoped) credentials — set " +
        "R2_ACCOUNT_ID+R2_API_TOKEN (R2) or STS_ROLE_ARN (S3/MinIO) to " +
        "enable per-user scoping.",
    );
    return shared;
  },
});
