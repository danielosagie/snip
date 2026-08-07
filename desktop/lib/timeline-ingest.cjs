"use strict";

const path = require("node:path");

const INGEST_PATH = "/desktop/timelines/ingest";
const DEFAULT_TIMEOUT_MS = 15_000;

function convexSiteUrl(value) {
  const url = new URL(String(value || ""));
  if (url.hostname.endsWith(".convex.cloud")) {
    url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function sourceFormatForFile(file, intermediate) {
  const extension = path.extname(String(file || "")).toLowerCase();
  const name = intermediate?.sourceFormat || extension.replace(/^\./, "") || "unknown";
  return {
    name,
    version:
      intermediate?.version === undefined ? undefined : String(intermediate.version),
    extension: extension || undefined,
    mimeType: extension === ".fcpxml" ? "application/xml" : "application/octet-stream",
  };
}

/**
 * Agent A's endpoint scopes idempotency to project plus source file hash. Keep
 * the same pair in the request header so logs and future gateways can dedupe
 * without inspecting the JSON body.
 */
function timelineIngestIdempotencyKey(projectId, sourceFileHash) {
  if (!projectId || !sourceFileHash) {
    throw new Error("Project ID and source file hash are required.");
  }
  return `desktop-timeline:${projectId}:${sourceFileHash}`;
}

function buildTimelineIngestPayload({
  projectId,
  branch,
  event,
  intermediate,
  otio,
  createdByName,
}) {
  if (!projectId) throw new Error("Timeline ingest requires a project ID.");
  if (!event?.hash) throw new Error("Timeline ingest requires a source file hash.");
  if (!otio) throw new Error("Timeline ingest requires OTIO data.");
  const sequence = intermediate?.sequences?.[0];
  return {
    projectId,
    ...(branch ? { branch } : {}),
    sourceFileHash: event.hash,
    sourceFile: event.file,
    sourceFormat: sourceFormatForFile(event.file, intermediate),
    sourceMetadata: {
      root: event.root,
      mtime: event.mtime,
      observedAt: event.observedAt,
      projectName: intermediate?.projectName ?? null,
      sequenceCount: intermediate?.sequences?.length ?? 0,
      warnings: intermediate?.warnings ?? [],
    },
    otio,
    message: "Desktop save",
    ...(createdByName ? { createdByName } : {}),
    ...(sequence?.id ? { sourceTimelineId: sequence.id } : {}),
  };
}

async function postTimelineIngest({
  siteUrl,
  pluginToken,
  payload,
  fetchFn = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!pluginToken?.trim()) throw new Error("Timeline ingest token is not configured.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchFn(`${convexSiteUrl(siteUrl)}${INGEST_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pluginToken.trim()}`,
        "Idempotency-Key": timelineIngestIdempotencyKey(
          payload.projectId,
          payload.sourceFileHash,
        ),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok || body?.ok === false) {
      throw new Error(
        body?.error || text || `Timeline ingest failed with HTTP ${response.status}.`,
      );
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  INGEST_PATH,
  buildTimelineIngestPayload,
  convexSiteUrl,
  postTimelineIngest,
  sourceFormatForFile,
  timelineIngestIdempotencyKey,
};
