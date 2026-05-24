import { S3Client } from "@aws-sdk/client-s3";

/**
 * Storage layer. Auto-detects which provider to use based on env vars:
 *
 *   - Cloudflare R2: set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *                    R2_ENDPOINT, R2_BUCKET_NAME, R2_PUBLIC_URL
 *   - Railway S3:    set RAILWAY_* (the original setup)
 *
 * R2 takes precedence when both sets are present. If neither is configured,
 * S3-dependent actions throw a friendly "configure storage" error rather
 * than crash at module load — see featureFlags.objectStorage().
 */

type StorageProvider = "r2" | "railway";

function pick(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function detectProvider(): StorageProvider | null {
  if (pick(process.env.R2_ACCESS_KEY_ID) && pick(process.env.R2_SECRET_ACCESS_KEY)) {
    return "r2";
  }
  if (
    pick(process.env.RAILWAY_ACCESS_KEY_ID) &&
    pick(process.env.RAILWAY_SECRET_ACCESS_KEY)
  ) {
    return "railway";
  }
  return null;
}

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Bucket name resolves at module load. Falls back to "videos" so importing
// this file never crashes on a misconfigured deployment — getS3Client() is the
// real gate that throws when actually called without creds.
export const BUCKET_NAME =
  pick(process.env.R2_BUCKET_NAME, process.env.RAILWAY_BUCKET_NAME) ?? "videos";

function getBasePublicUrl(): string {
  const provider = detectProvider();
  if (provider === "r2") {
    const value = pick(process.env.R2_PUBLIC_URL, process.env.R2_ENDPOINT);
    if (!value) {
      throw new Error("Missing R2_PUBLIC_URL or R2_ENDPOINT for bucket URLs");
    }
    return value;
  }
  if (provider === "railway") {
    const value = pick(process.env.RAILWAY_PUBLIC_URL, process.env.RAILWAY_ENDPOINT);
    if (!value) {
      throw new Error("Missing RAILWAY_PUBLIC_URL or RAILWAY_ENDPOINT for bucket URLs");
    }
    return value;
  }
  throw new Error(
    "Object storage is not configured. Set R2_* or RAILWAY_* env vars (see docs/setup.md).",
  );
}

export function buildPublicUrl(key: string): string {
  const provider = detectProvider();
  // R2's R2_PUBLIC_URL is typically a fully-public bucket subdomain
  // (https://pub-xxx.r2.dev or a custom domain) where the path is just /<key>.
  // Railway prepends the bucket name unless RAILWAY_PUBLIC_URL_INCLUDE_BUCKET=false.
  const includeBucket =
    provider === "r2"
      ? process.env.R2_PUBLIC_URL_INCLUDE_BUCKET === "true"
      : process.env.RAILWAY_PUBLIC_URL_INCLUDE_BUCKET !== "false";
  const url = new URL(getBasePublicUrl());
  const basePath = url.pathname.endsWith("/")
    ? url.pathname.slice(0, -1)
    : url.pathname;
  const objectPath = includeBucket ? `${BUCKET_NAME}/${key}` : key;
  url.pathname = `${basePath}/${objectPath}`;
  return url.toString();
}

export function getS3Client(): S3Client {
  const provider = detectProvider();
  if (!provider) {
    throw new Error(
      "Object storage is not configured. Set R2_* or RAILWAY_* env vars (see docs/setup.md).",
    );
  }

  if (provider === "r2") {
    return new S3Client({
      region: pick(process.env.R2_REGION) ?? "auto",
      endpoint: envOrThrow("R2_ENDPOINT"),
      credentials: {
        accessKeyId: envOrThrow("R2_ACCESS_KEY_ID"),
        secretAccessKey: envOrThrow("R2_SECRET_ACCESS_KEY"),
      },
      forcePathStyle: false,
    });
  }

  return new S3Client({
    region: pick(process.env.RAILWAY_REGION) ?? "us-east-1",
    endpoint: envOrThrow("RAILWAY_ENDPOINT"),
    credentials: {
      accessKeyId: envOrThrow("RAILWAY_ACCESS_KEY_ID"),
      secretAccessKey: envOrThrow("RAILWAY_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: true,
  });
}

export function isStorageConfigured(): boolean {
  return detectProvider() !== null;
}

export function getStorageProviderName(): "r2" | "railway" | "none" {
  return detectProvider() ?? "none";
}

/**
 * Reusable S3 prefixes. Mental model:
 *
 *   projects/<teamSlug>/<projectId>/             ← project root
 *     contract.docx                              ← canonical contract file
 *     v1/                                        ← version subfolders
 *       <files>
 *     v2/
 *       <files>
 *
 * Desktop sync pulls the ROOT prefix → contract sits next to version
 * folders locally, which is what most agencies expect.
 */
export function projectRootPrefix(teamSlug: string, projectId: string): string {
  return `projects/${teamSlug}/${projectId}/`;
}

export function projectVersionPrefix(teamSlug: string, projectId: string, version: number): string {
  return `${projectRootPrefix(teamSlug, projectId)}v${version}/`;
}

export function projectContractKey(teamSlug: string, projectId: string): string {
  return `${projectRootPrefix(teamSlug, projectId)}contract.docx`;
}
