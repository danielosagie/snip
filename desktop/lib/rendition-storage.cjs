"use strict";

const path = require("node:path");
const { Readable } = require("node:stream");

const RENDITION_MODE_PROXY = "proxy";
const RENDITION_MODE_FULL_RES = "full-res";

function renditionMode(preferProxy) {
  return preferProxy === false ? RENDITION_MODE_FULL_RES : RENDITION_MODE_PROXY;
}

function assertKeySegment(value, label) {
  const segment = String(value || "").trim();
  if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
    throw new Error(`Invalid ${label}.`);
  }
  return segment;
}

function buildProxyR2Key({ teamSlug, projectId, videoId, name }) {
  return [
    "projects",
    assertKeySegment(teamSlug, "team slug"),
    assertKeySegment(projectId, "project id"),
    "proxies",
    assertKeySegment(videoId, "video id"),
    assertKeySegment(name, "rendition name"),
  ].join("/");
}

function assertProxyR2Key(key) {
  const parts = String(key || "").split("/");
  if (
    parts.length !== 6 ||
    parts[0] !== "projects" ||
    parts[3] !== "proxies"
  ) {
    throw new Error("Rendition destination must be a project proxy key.");
  }
  assertKeySegment(parts[1], "team slug");
  assertKeySegment(parts[2], "project id");
  assertKeySegment(parts[4], "video id");
  assertKeySegment(parts[5], "rendition name");
  return parts.join("/");
}

function selectMountedRendition({ preferProxy = true, original, proxies = [] }) {
  if (preferProxy) {
    const ready = proxies.filter(
      (proxy) =>
        proxy?.status === "ready" &&
        typeof proxy.r2Key === "string" &&
        proxy.r2Key.length > 0 &&
        Number(proxy.size ?? proxy.filesizeBytes) > 0,
    );
    const selected =
      ready.find((proxy) => proxy.resolution === "720p") ||
      [...ready].sort(
        (left, right) =>
          Number(left.size ?? left.filesizeBytes) - Number(right.size ?? right.filesizeBytes),
      )[0];
    if (selected) {
      return {
        mode: RENDITION_MODE_PROXY,
        key: selected.r2Key,
        size: Number(selected.size ?? selected.filesizeBytes),
        contentType: selected.contentType || "video/mp4",
      };
    }
  }
  if (!original?.key) return null;
  return {
    mode: RENDITION_MODE_FULL_RES,
    key: original.key,
    size: Number(original.size || 0),
    contentType: original.contentType || "application/octet-stream",
  };
}

function renditionCacheDirectory(baseDirectory, preferProxy) {
  return path.join(baseDirectory, "renditions", renditionMode(preferProxy));
}

function assertMuxRenditionUrl(sourceUrl) {
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error("Rendition source URL is invalid.");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "stream.mux.com") {
    throw new Error("Rendition source must be an HTTPS stream.mux.com URL.");
  }
  return parsed.toString();
}

/**
 * Stream a Mux rendition into R2 with multipart upload. No response body is
 * buffered, so multi-gigabyte feature proxies stay flat in desktop memory.
 * Authorization/context lookup and recording r2Key remain server contracts;
 * this function only performs the byte transfer in the desktop process.
 */
async function mirrorRenditionToR2({
  s3,
  bucket,
  sourceUrl,
  key,
  contentType = "video/mp4",
  fetchImpl = fetch,
  UploadClass,
}) {
  if (!s3) throw new Error("An S3 client is required.");
  if (!bucket) throw new Error("An R2 bucket is required.");
  const safeSourceUrl = assertMuxRenditionUrl(sourceUrl);
  const safeKey = assertProxyR2Key(key);
  const response = await fetchImpl(safeSourceUrl, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Mux rendition download failed with HTTP ${response.status}.`);
  }
  const Upload = UploadClass || require("@aws-sdk/lib-storage").Upload;
  const body =
    typeof response.body.pipe === "function"
      ? response.body
      : Readable.fromWeb(response.body);
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: safeKey,
      Body: body,
      ContentType: response.headers.get("content-type") || contentType,
    },
    queueSize: 4,
    partSize: 64 * 1024 * 1024,
    leavePartsOnError: false,
  });
  await upload.done();
  const advertisedSize = Number(response.headers.get("content-length") || "0");
  return {
    key: safeKey,
    size: Number.isFinite(advertisedSize) && advertisedSize > 0 ? advertisedSize : null,
    contentType: response.headers.get("content-type") || contentType,
  };
}

module.exports = {
  RENDITION_MODE_FULL_RES,
  RENDITION_MODE_PROXY,
  assertMuxRenditionUrl,
  assertProxyR2Key,
  buildProxyR2Key,
  mirrorRenditionToR2,
  renditionCacheDirectory,
  renditionMode,
  selectMountedRendition,
};
