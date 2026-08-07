import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
} from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface ObjectInfo {
  key: string;
  bytes: number;
  etag?: string;
}

export interface PutFileOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  ifAbsent?: boolean;
}

export interface ObjectStore {
  head(key: string): Promise<ObjectInfo | null>;
  downloadToFile(key: string, destination: string): Promise<ObjectInfo>;
  putFile(key: string, source: string, options?: PutFileOptions): Promise<ObjectInfo>;
}

function cleanObjectKey(key: string): string {
  const normalized = key.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => part === "..")) {
    throw new Error(`Unsafe object key: ${key}`);
  }
  return normalized;
}

async function atomicDestination(destination: string, write: (partPath: string) => Promise<void>) {
  await mkdir(dirname(destination), { recursive: true });
  const partPath = `${destination}.${randomUUID()}.part`;
  try {
    await write(partPath);
    await rename(partPath, destination);
  } catch (error) {
    await rm(partPath, { force: true });
    throw error;
  }
}

export class LocalObjectStore implements ObjectStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    const path = resolve(this.root, cleanObjectKey(key));
    const rel = relative(this.root, path);
    if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
      throw new Error(`Object key escapes local store: ${key}`);
    }
    return path;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const path = this.pathFor(key);
    try {
      const details = await stat(path);
      return { key: cleanObjectKey(key), bytes: details.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async downloadToFile(key: string, destination: string): Promise<ObjectInfo> {
    const source = this.pathFor(key);
    const info = await this.head(key);
    if (!info) throw new Error(`Object not found: ${key}`);
    await atomicDestination(destination, async (partPath) => {
      await copyFile(source, partPath);
    });
    return info;
  }

  async putFile(
    key: string,
    source: string,
    options: PutFileOptions = {},
  ): Promise<ObjectInfo> {
    const destination = this.pathFor(key);
    await mkdir(dirname(destination), { recursive: true });
    if (options.ifAbsent) {
      try {
        await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    } else {
      await atomicDestination(destination, async (partPath) => {
        await copyFile(source, partPath);
      });
    }
    const details = await stat(destination);
    return { key: cleanObjectKey(key), bytes: details.size };
  }
}

export interface R2ObjectStoreConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region?: string;
}

function isNotFound(error: unknown): boolean {
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return candidate.name === "NotFound" || candidate.$metadata?.httpStatusCode === 404;
}

function isPreconditionFailure(error: unknown): boolean {
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412;
}

export class R2ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: R2ObjectStoreConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region ?? "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: false,
    });
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const cleanKey = cleanObjectKey(key);
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: cleanKey }),
      );
      return {
        key: cleanKey,
        bytes: response.ContentLength ?? 0,
        etag: response.ETag?.replaceAll('"', ""),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async downloadToFile(key: string, destination: string): Promise<ObjectInfo> {
    const cleanKey = cleanObjectKey(key);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: cleanKey }),
    );
    if (!response.Body) throw new Error(`R2 returned an empty body for ${cleanKey}.`);
    await atomicDestination(destination, async (partPath) => {
      const body = response.Body;
      if (!body) throw new Error(`R2 returned an empty body for ${cleanKey}.`);
      const readable = body instanceof Readable
        ? body
        : Readable.fromWeb(body.transformToWebStream() as never);
      await pipeline(readable, createWriteStream(partPath, { flags: "wx" }));
    });
    const details = await stat(destination);
    return {
      key: cleanKey,
      bytes: details.size,
      etag: response.ETag?.replaceAll('"', ""),
    };
  }

  async putFile(
    key: string,
    source: string,
    options: PutFileOptions = {},
  ): Promise<ObjectInfo> {
    const cleanKey = cleanObjectKey(key);
    const details = await stat(source);
    try {
      const response = await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: cleanKey,
          Body: createReadStream(source),
          ContentLength: details.size,
          ContentType: options.contentType,
          Metadata: options.metadata,
          IfNoneMatch: options.ifAbsent ? "*" : undefined,
        }),
      );
      return {
        key: cleanKey,
        bytes: details.size,
        etag: response.ETag?.replaceAll('"', ""),
      };
    } catch (error) {
      if (!options.ifAbsent || !isPreconditionFailure(error)) throw error;
      const existing = await this.head(cleanKey);
      if (!existing) throw error;
      return existing;
    }
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function createR2ObjectStoreFromEnv(): R2ObjectStore {
  return new R2ObjectStore({
    endpoint: requiredEnv("R2_ENDPOINT"),
    accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    bucket: requiredEnv("R2_BUCKET_NAME"),
    region: process.env.R2_REGION?.trim() || "auto",
  });
}

export function createObjectStoreFromEnv(): ObjectStore {
  const backend = process.env.OBJECT_STORE_BACKEND?.trim().toLowerCase() ?? "r2";
  if (backend === "local") {
    return new LocalObjectStore(requiredEnv("LOCAL_OBJECT_STORE_DIR"));
  }
  if (backend !== "r2") {
    throw new Error("OBJECT_STORE_BACKEND must be r2 or local.");
  }
  return createR2ObjectStoreFromEnv();
}

export async function assertReadableFile(path: string): Promise<void> {
  await access(path, fsConstants.R_OK);
}
