/**
 * Local WebDAV server that the desktop mount exposes to rclone.
 *
 * Why this exists:
 *   The previous mount was a raw `rclone mount videoinfra:bucket/projects`
 *   that surfaced Convex IDs as path segments in Finder (e.g.
 *   `projects/team-slug/k971j4...rd8/originals/...`) and gave drops nowhere
 *   to land — rclone would PUT bytes to S3 but no Convex `videos` row was
 *   ever created, so the web app couldn't see uploaded files.
 *
 * What this does instead:
 *   1. Boots an HTTP server bound to 127.0.0.1 that speaks just enough WebDAV
 *      to satisfy rclone (PROPFIND, OPTIONS, GET, HEAD, PUT).
 *   2. PROPFIND queries Convex via the existing `convexCall` helper to list
 *      teams / projects / videos by human name, with collision suffixes when
 *      duplicates exist.
 *   3. GET 302-redirects to a presigned S3 URL returned by Convex — rclone
 *      follows redirects, so bytes never proxy through this process.
 *   4. PUT calls `createUploadForDesktop` (which inserts the `videos` row and
 *      returns a presigned PUT URL), streams the request body straight to S3,
 *      then fires `completeUploadForDesktop` so Mux ingest kicks off.
 *
 * Auth: rclone connects to localhost only, no token required at this hop.
 * The desktop process holds the user's Convex auth token from the pairing
 * flow; all calls out to Convex go through `convexCall` and carry that bearer
 * token, so the user's actual permissions still gate everything.
 *
 * Lifecycle: `start()` returns a handle. Call `stop()` on unmount or app quit
 * to free the port and abort in-flight uploads.
 */

const http = require("http");
const { Readable } = require("stream");

const DAV_HEADERS = {
  DAV: "1",
  "MS-Author-Via": "DAV",
  Allow: "OPTIONS, GET, HEAD, PROPFIND, PUT",
};

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hrefEncode(parts) {
  return (
    "/" +
    parts
      .map((p) =>
        encodeURIComponent(p)
          .replace(/!/g, "%21")
          .replace(/'/g, "%27")
          .replace(/\(/g, "%28")
          .replace(/\)/g, "%29")
          .replace(/\*/g, "%2A"),
      )
      .join("/")
  );
}

function rfc1123(ts) {
  return new Date(ts).toUTCString();
}

function buildPropfindResponse({ href, isCollection, size, contentType, mtime }) {
  const lastMod = rfc1123(mtime ?? Date.now());
  const resourceType = isCollection
    ? "<D:resourcetype><D:collection/></D:resourcetype>"
    : "<D:resourcetype/>";
  const sizeProp =
    !isCollection && typeof size === "number"
      ? `<D:getcontentlength>${size}</D:getcontentlength>`
      : "";
  const typeProp =
    !isCollection && contentType
      ? `<D:getcontenttype>${xmlEscape(contentType)}</D:getcontenttype>`
      : "";
  return [
    "<D:response>",
    `<D:href>${xmlEscape(href)}</D:href>`,
    "<D:propstat>",
    "<D:prop>",
    resourceType,
    `<D:getlastmodified>${lastMod}</D:getlastmodified>`,
    sizeProp,
    typeProp,
    "</D:prop>",
    "<D:status>HTTP/1.1 200 OK</D:status>",
    "</D:propstat>",
    "</D:response>",
  ].join("");
}

function buildMultiStatus(entries) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<D:multistatus xmlns:D="DAV:">' +
    entries.map(buildPropfindResponse).join("") +
    "</D:multistatus>"
  );
}

function parsePath(rawPath) {
  // Strip the WebDAV mountpoint prefix and decode each segment. The leading
  // `/webdav` is added by the rclone config (url = http://127.0.0.1:PORT/webdav);
  // we accept both `/webdav/...` and `/...` so the server is reachable for
  // diagnostics without going through rclone.
  let p = rawPath.split("?")[0];
  if (p.startsWith("/webdav/")) p = p.slice("/webdav".length);
  else if (p === "/webdav") p = "/";
  // Drop trailing slash for path-component parsing but remember it.
  const hadTrailing = p.length > 1 && p.endsWith("/");
  if (hadTrailing) p = p.slice(0, -1);
  const segments = p === "" || p === "/"
    ? []
    : p.split("/").slice(1).map((s) => decodeURIComponent(s));
  return { segments, hadTrailing };
}

function buildHref(prefix, segments, isCollection) {
  const path = hrefEncode(segments.length > 0 ? [...prefix, ...segments] : prefix);
  return isCollection ? (path === "/" ? "/" : path + "/") : path;
}

function contentTypeFromExt(ext) {
  switch ((ext || "").toLowerCase()) {
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "mkv":
      return "video/x-matroska";
    case "webm":
      return "video/webm";
    case "avi":
      return "video/x-msvideo";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

function isHidden(name) {
  // Finder + macOS spam .DS_Store, ._ AppleDouble files, and the volume's
  // .VolumeIcon.icns. Quietly 404 these so we don't waste a Convex round-trip
  // checking projects/videos with junk names.
  return (
    name.startsWith(".") ||
    name === "Icon\r" ||
    name === "Icon\r\r"
  );
}

function start({ convexCall, pushLog, port = 0 }) {
  let aborted = false;

  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res, { convexCall, pushLog });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushLog?.(`webdav: ${req.method} ${req.url} → 500: ${msg}`);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain" });
      }
      res.end(msg);
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const actualPort = server.address().port;
      pushLog?.(`webdav: listening on http://127.0.0.1:${actualPort}/webdav`);
      resolve({
        port: actualPort,
        stop: () =>
          new Promise((r) => {
            aborted = true;
            server.close(() => r());
          }),
        get aborted() {
          return aborted;
        },
      });
    });
  });
}

async function handle(req, res, { convexCall, pushLog }) {
  const method = req.method?.toUpperCase() ?? "GET";
  const { segments } = parsePath(req.url || "/");
  const depth = (req.headers.depth || "1").toString();

  // Strip Finder/AppleDouble junk early.
  if (segments.some(isHidden)) {
    return notFound(res);
  }

  if (method === "OPTIONS") {
    res.writeHead(200, DAV_HEADERS);
    return res.end();
  }

  if (method === "PROPFIND") {
    return handlePropfind(req, res, segments, depth, { convexCall, pushLog });
  }
  if (method === "GET" || method === "HEAD") {
    return handleGet(req, res, segments, method === "HEAD", { convexCall, pushLog });
  }
  if (method === "PUT") {
    return handlePut(req, res, segments, { convexCall, pushLog });
  }

  res.writeHead(405, { ...DAV_HEADERS, "content-type": "text/plain" });
  return res.end(`Method ${method} not implemented yet.`);
}

function notFound(res) {
  res.writeHead(404, { "content-type": "text/plain" });
  return res.end("Not found");
}

function forbidden(res, msg) {
  res.writeHead(403, { "content-type": "text/plain" });
  return res.end(msg || "Forbidden");
}

async function handlePropfind(req, res, segments, depth, { convexCall, pushLog }) {
  const includeChildren = depth !== "0";

  if (segments.length === 0) {
    // Root: list teams.
    const self = {
      href: "/webdav/",
      isCollection: true,
      mtime: Date.now(),
    };
    if (!includeChildren) return sendMultistatus(res, [self]);
    const teams = await convexCall("query", "desktopBrowse:listTeamsForDesktop", {});
    const entries = [self];
    for (const t of teams) {
      entries.push({
        href: buildHref(["webdav"], [t.slug], true),
        isCollection: true,
        mtime: t.updatedAt,
      });
    }
    return sendMultistatus(res, entries);
  }

  if (segments.length === 1) {
    // /team/ → list projects.
    const [teamSlug] = segments;
    const self = {
      href: buildHref(["webdav"], [teamSlug], true),
      isCollection: true,
      mtime: Date.now(),
    };
    if (!includeChildren) return sendMultistatus(res, [self]);
    let projects;
    try {
      projects = await convexCall(
        "query",
        "desktopBrowse:listProjectsForDesktop",
        { teamSlug },
      );
    } catch (err) {
      pushLog?.(`webdav: listProjectsForDesktop(${teamSlug}) failed: ${err.message}`);
      return notFound(res);
    }
    if (!Array.isArray(projects) || projects.length === 0) {
      return sendMultistatus(res, [self]);
    }
    const entries = [self];
    for (const p of projects) {
      entries.push({
        href: buildHref(["webdav"], [teamSlug, p.displayName], true),
        isCollection: true,
        mtime: p.updatedAt,
      });
    }
    return sendMultistatus(res, entries);
  }

  if (segments.length === 2) {
    // /team/project/ → list videos.
    const [teamSlug, projectName] = segments;
    const self = {
      href: buildHref(["webdav"], [teamSlug, projectName], true),
      isCollection: true,
      mtime: Date.now(),
    };
    if (!includeChildren) return sendMultistatus(res, [self]);
    const summary = await convexCall(
      "query",
      "desktopBrowse:listVideosForDesktop",
      { teamSlug, projectName },
    );
    if (!summary) return notFound(res);
    const entries = [self];
    for (const v of summary.videos) {
      entries.push({
        href: buildHref(["webdav"], [teamSlug, projectName, v.displayName], false),
        isCollection: false,
        size: v.size,
        contentType: v.contentType || contentTypeFromExt(v.ext),
        mtime: v.updatedAt,
      });
    }
    return sendMultistatus(res, entries);
  }

  if (segments.length === 3) {
    // /team/project/file.ext — PROPFIND of a single file. Always Depth 0.
    const [teamSlug, projectName, fileName] = segments;
    const target = await convexCall(
      "query",
      "desktopBrowse:resolveVideoForDesktop",
      { teamSlug, projectName, fileName },
    );
    if (!target) return notFound(res);
    return sendMultistatus(res, [
      {
        href: buildHref(["webdav"], [teamSlug, projectName, fileName], false),
        isCollection: false,
        size: target.size,
        contentType: target.contentType,
        mtime: target.updatedAt,
      },
    ]);
  }

  // Deeper paths (folders, versions) not implemented yet.
  return notFound(res);
}

function sendMultistatus(res, entries) {
  const xml = buildMultiStatus(entries);
  res.writeHead(207, {
    ...DAV_HEADERS,
    "content-type": 'application/xml; charset="utf-8"',
    "content-length": Buffer.byteLength(xml),
  });
  res.end(xml);
}

async function handleGet(req, res, segments, headOnly, { convexCall, pushLog }) {
  if (segments.length !== 3) return notFound(res);
  const [teamSlug, projectName, fileName] = segments;
  const result = await convexCall(
    "action",
    "desktopBrowse:getDownloadUrlForDesktop",
    { teamSlug, projectName, fileName },
  );
  if (!result) return notFound(res);
  // rclone follows redirects; we hand back the presigned S3 URL so bytes
  // never proxy through this process. HEAD just needs the headers.
  res.writeHead(302, {
    location: result.url,
    "content-type": result.contentType,
    "content-length": String(result.size),
  });
  return res.end();
}

async function handlePut(req, res, segments, { convexCall, pushLog }) {
  if (segments.length !== 3) {
    return forbidden(res, "Uploads must be at /team/project/file.ext");
  }
  const [teamSlug, projectName, fileName] = segments;
  const declaredSize = Number(req.headers["content-length"] || "0");
  if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
    return forbidden(res, "Content-Length is required for uploads.");
  }
  const contentType =
    (req.headers["content-type"] || "").toString().split(";")[0].trim() ||
    contentTypeFromExt(fileName.split(".").pop());

  let upload;
  try {
    upload = await convexCall(
      "action",
      "desktopBrowse:createUploadForDesktop",
      {
        teamSlug,
        projectName,
        fileName,
        size: declaredSize,
        contentType,
      },
    );
  } catch (err) {
    pushLog?.(
      `webdav: PUT ${teamSlug}/${projectName}/${fileName} create failed: ${err.message}`,
    );
    return forbidden(res, err.message);
  }

  // Stream the request body directly to the presigned S3 URL. We don't read
  // into memory — for multi-GB video uploads that would OOM the renderer.
  let putRes;
  try {
    putRes = await fetch(upload.uploadUrl, {
      method: "PUT",
      // Node's undici accepts a stream body and pipes it through.
      body: Readable.toWeb(req),
      duplex: "half",
      headers: {
        "content-type": contentType,
        "content-length": String(declaredSize),
      },
    });
  } catch (err) {
    pushLog?.(`webdav: S3 PUT failed: ${err.message}`);
    return forbidden(res, `S3 upload failed: ${err.message}`);
  }
  if (!putRes.ok) {
    const body = await putRes.text().catch(() => "");
    pushLog?.(
      `webdav: S3 PUT ${putRes.status} ${putRes.statusText}: ${body.slice(0, 200)}`,
    );
    return forbidden(
      res,
      `S3 rejected upload (${putRes.status}): ${body.slice(0, 200)}`,
    );
  }

  // Kick off finalize (Mux ingest for video/*, status flip for everything
  // else). We don't await heavy work — markUploadComplete returns quickly
  // because Mux ingest is a follow-up webhook.
  try {
    await convexCall("action", "desktopBrowse:completeUploadForDesktop", {
      videoId: upload.videoId,
    });
  } catch (err) {
    pushLog?.(
      `webdav: completeUploadForDesktop(${upload.videoId}) failed: ${err.message}`,
    );
    // The bytes are in S3; the row is in Convex. The next dashboard refresh
    // will reconcile. We still return 201 because the WebDAV PUT itself
    // succeeded and rclone retrying would re-upload the same bytes.
  }
  res.writeHead(201, { "content-type": "text/plain" });
  res.end("created");
}

module.exports = { start };
