/**
 * Convex surface for the desktop WebDAV mount.
 *
 * The desktop app runs a local WebDAV server (see desktop/electron-webdav.cjs)
 * that exposes a `<team> / <project> / <video>` directory hierarchy in Finder
 * with human-readable names — the raw S3 mount served Convex IDs as path
 * segments, which is what we're replacing. These functions resolve names to
 * IDs and provide the listing + upload primitives the WebDAV layer needs.
 *
 * Name → ID resolution: project and video names aren't enforced unique inside
 * their parents, so we append ` (<id-suffix>)` to disambiguate duplicates and
 * persist that exact display string in the listing response — the WebDAV
 * layer echoes it back when resolving so collisions are deterministic.
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  QueryCtx,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { getUser, requireProjectAccess, requireTeamAccess } from "./auth";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client, BUCKET_NAME } from "./s3";

const ID_SUFFIX_LEN = 6;

function shortId(id: string): string {
  return id.slice(-ID_SUFFIX_LEN);
}

function disambiguate<
  T extends { _id: string; rawName: string; createdAt?: number },
>(rows: T[]): Array<T & { displayName: string }> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const g = groups.get(row.rawName) ?? [];
    g.push(row);
    groups.set(row.rawName, g);
  }
  return rows.map((row) => {
    const group = groups.get(row.rawName) ?? [row];
    if (group.length <= 1) return { ...row, displayName: row.rawName };
    // Keep the OLDEST occurrence under the plain name so the name the user (or
    // rclone) wrote always resolves. Suffixing EVERY duplicate made the plain
    // name vanish from the listing — which made rclone believe its just-
    // uploaded file was missing and re-upload it on every dir-cache refresh,
    // each retry spawning yet another duplicate. (See createUploadForDesktop.)
    const oldest = group.reduce((a, b) =>
      (a.createdAt ?? 0) <= (b.createdAt ?? 0) ? a : b,
    );
    return {
      ...row,
      displayName:
        row._id === oldest._id
          ? row.rawName
          : `${row.rawName} (${shortId(row._id)})`,
    };
  });
}

// Storage client + bucket name come from the canonical ./s3 helpers (imported
// above). This file USED to define its own getS3Client/getBucketName that read
// R2_S3_ENDPOINT / RAILWAY_S3_ENDPOINT — env names that don't exist in prod
// (the real ones are R2_ENDPOINT / RAILWAY_ENDPOINT). So every drive PUT/GET
// presign threw "Object storage credentials not configured", which orphaned a
// no-s3Key "uploading" row on each upload. Using the shared helpers fixes it
// and keeps R2-vs-Railway detection in one place.

function extractExt(name: string | undefined): string | null {
  if (!name) return null;
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) return null;
  return name.slice(idx + 1).toLowerCase();
}

function stripExt(name: string, ext: string): string {
  const lower = name.toLowerCase();
  const suffix = `.${ext}`;
  if (lower.endsWith(suffix)) return name.slice(0, name.length - suffix.length);
  return name;
}

async function resolveTeamBySlug(
  ctx: QueryCtx,
  slug: string,
): Promise<Doc<"teams"> | null> {
  return await ctx.db
    .query("teams")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

async function resolveProjectByName(
  ctx: QueryCtx,
  teamId: Id<"teams">,
  displayName: string,
): Promise<Doc<"projects"> | null> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_team", (q) => q.eq("teamId", teamId))
    .collect();
  const live = projects.filter((p) => !p.deletedAt);
  const rows = disambiguate(
    live.map((p) => ({ _id: p._id as string, rawName: p.name, project: p })),
  );
  const match = rows.find((r) => r.displayName === displayName);
  return match?.project ?? null;
}

// ── Proxy-vs-original resolution for the drive ───────────────────────────────
//
// Proxy-first editing is what makes the drive LucidLink-fast AND cheap: the
// ~720p edit proxy is ~10% the bytes, so it streams cold off R2 in real time
// and fits the local VFS cache far better than a full-res master. When proxy
// mode is on we serve the R2-mirrored rendition; otherwise (or when no proxy
// has been generated/mirrored yet) we serve the original. The SAME predicate
// runs in both the directory listing (PROPFIND size) and the GET redirect, so
// the advertised Content-Length always matches the bytes actually served — a
// mismatch would corrupt reads through FUSE. See plans/proxies-unified.md.

type DriveObject = {
  key: string | null;
  size: number;
  contentType: string;
  isProxy: boolean;
};

// A rendition is usable for the drive only if it's ready, mirrored to R2
// (r2Key), AND has a known byte size — without the size we can't advertise a
// correct Content-Length, so we fall back to the original instead.
function pickReadyProxy(
  video: Doc<"videos">,
): { r2Key: string; size: number; contentType: string } | null {
  const rends = video.staticRenditions ?? [];
  const usable = rends.filter(
    (r) =>
      r.status === "ready" &&
      typeof r.r2Key === "string" &&
      r.r2Key.length > 0 &&
      typeof r.filesizeBytes === "number" &&
      r.filesizeBytes > 0,
  );
  if (usable.length === 0) return null;
  // Prefer the 720p edit proxy; otherwise take the smallest ready rendition.
  const sorted = [...usable].sort(
    (a, b) => (a.filesizeBytes ?? 0) - (b.filesizeBytes ?? 0),
  );
  const pick = usable.find((r) => r.resolution === "720p") ?? sorted[0];
  return {
    r2Key: pick.r2Key as string,
    size: pick.filesizeBytes as number,
    contentType: pick.ext === "m4a" ? "audio/mp4" : "video/mp4",
  };
}

// Resolve which object the drive should serve for a video, given proxy mode.
function pickDriveObject(video: Doc<"videos">, preferProxy: boolean): DriveObject {
  if (preferProxy) {
    const proxy = pickReadyProxy(video);
    if (proxy) {
      return {
        key: proxy.r2Key,
        size: proxy.size,
        contentType: proxy.contentType,
        isProxy: true,
      };
    }
  }
  return {
    key: video.s3Key ?? null,
    size: video.fileSize ?? 0,
    contentType: video.contentType ?? "application/octet-stream",
    isProxy: false,
  };
}

type VideoListEntry = {
  videoId: Id<"videos">;
  displayName: string;
  rawTitle: string;
  ext: string;
  size: number;
  contentType: string;
  updatedAt: number;
  isReady: boolean;
  hasS3Key: boolean;
  isProxy: boolean;
};

function buildVideoEntries(
  videos: Doc<"videos">[],
  preferProxy: boolean,
): VideoListEntry[] {
  const live = videos.filter((vd) => !vd.deletedAt);
  // Items are content-type agnostic — the `videos` table doubles as the
  // generic file table (PDFs, images, audio, .ai, .psd, anything). The
  // backend's markUploadComplete already routes non-video MIME types
  // through markAsReadyAsFile, so the desktop drive just surfaces whatever
  // landed.
  const rows = live.map((vd) => {
    // Keep the ORIGINAL name+extension even when serving a proxy — the drive
    // exposes one logical file per video whose bytes flip with proxy mode.
    const ext = extractExt(vd.s3Key ?? undefined) ?? extractExt(vd.title);
    const rawTitle = ext ? stripExt(vd.title, ext) : vd.title;
    return {
      _id: vd._id as string,
      rawName: ext ? `${rawTitle}.${ext}` : rawTitle,
      createdAt: vd._creationTime,
      video: vd,
      rawTitle,
      ext: ext ?? "",
    };
  });
  const disambig = disambiguate(rows);
  return disambig.map((r) => {
    const obj = pickDriveObject(r.video, preferProxy);
    return {
      videoId: r.video._id,
      displayName: r.displayName,
      rawTitle: r.rawTitle,
      ext: r.ext,
      // Size + content-length reflect the object we'll actually serve (proxy
      // when present + enabled, else original) so PROPFIND == GET bytes.
      size: obj.size,
      contentType: obj.contentType,
      updatedAt: r.video._creationTime,
      isReady: r.video.status === "ready",
      hasS3Key: Boolean(obj.key),
      isProxy: obj.isProxy,
    };
  });
}

// Videos that live directly inside `folderId` — or at the project root when
// folderId is undefined. The drive mirrors the web app's folder tree, so each
// directory shows only its own files, not the whole project flattened (which
// is what the old single-level mount did).
async function listVideosInFolder(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  folderId: Id<"folders"> | undefined,
  preferProxy: boolean,
): Promise<VideoListEntry[]> {
  let videos: Doc<"videos">[];
  if (folderId) {
    videos = (
      await ctx.db
        .query("videos")
        .withIndex("by_folder", (q) => q.eq("folderId", folderId))
        .collect()
    ).filter((vd) => vd.projectId === projectId);
  } else {
    videos = (
      await ctx.db
        .query("videos")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect()
    ).filter((vd) => !vd.folderId);
  }
  return buildVideoEntries(videos, preferProxy);
}

type FolderListEntry = {
  folderId: Id<"folders">;
  displayName: string;
  updatedAt: number;
};

// Subfolders directly under `parentFolderId` (project root when undefined).
// Folder names are already unique case-insensitively within a parent (enforced
// by folders.create), so the display name is just the name — no id suffix.
async function listSubfolders(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  parentFolderId: Id<"folders"> | undefined,
): Promise<FolderListEntry[]> {
  const rows = await ctx.db
    .query("folders")
    .withIndex("by_project_and_parent", (q) =>
      q.eq("projectId", projectId).eq("parentFolderId", parentFolderId),
    )
    .collect();
  return rows.map((f) => ({
    folderId: f._id,
    displayName: f.name,
    updatedAt: f._creationTime,
  }));
}

// Walk a list of folder NAMES from the project root, returning the id of the
// deepest folder matched. `matched` is how many names were consumed — callers
// use a short-fall of exactly 1 to treat the final segment as a file name.
async function walkFolderPath(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  names: string[],
): Promise<{ folderId: Id<"folders"> | undefined; matched: number }> {
  let parent: Id<"folders"> | undefined = undefined;
  let matched = 0;
  for (const name of names) {
    const lower = name.toLowerCase();
    const siblings = await ctx.db
      .query("folders")
      .withIndex("by_project_and_parent", (q) =>
        q.eq("projectId", projectId).eq("parentFolderId", parent),
      )
      .collect();
    const hit = siblings.find((s) => s.name.toLowerCase() === lower);
    if (!hit) break;
    parent = hit._id;
    matched += 1;
  }
  return { folderId: parent, matched };
}

/**
 * Root listing: teams the signed-in user is a member of. Same membership rule
 * as the web sidebar — viewers see their teams but can only read.
 */
export const listTeamsForDesktop = query({
  args: {},
  returns: v.array(
    v.object({
      slug: v.string(),
      name: v.string(),
      role: v.string(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return [];
    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userClerkId", user.subject))
      .collect();
    const rows = await Promise.all(
      memberships.map(async (m) => {
        const team = await ctx.db.get(m.teamId);
        if (!team) return null;
        return {
          slug: team.slug,
          name: team.name,
          role: m.role,
          updatedAt: team._creationTime,
        };
      }),
    );
    return rows.filter((r): r is NonNullable<typeof r> => Boolean(r));
  },
});

/**
 * Projects in a team, keyed by slug. Returns `displayName` that the WebDAV
 * layer should use as the path segment — disambiguated for duplicates.
 */
export const listProjectsForDesktop = query({
  args: { teamSlug: v.string() },
  returns: v.array(
    v.object({
      projectId: v.id("projects"),
      displayName: v.string(),
      rawName: v.string(),
      updatedAt: v.number(),
      videoCount: v.number(),
      role: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) return [];
    const team = await resolveTeamBySlug(ctx, args.teamSlug);
    if (!team) return [];
    const { membership } = await requireTeamAccess(ctx, team._id);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_team", (q) => q.eq("teamId", team._id))
      .collect();
    const live = projects.filter((p) => !p.deletedAt);
    const disambig = disambiguate(
      live.map((p) => ({ _id: p._id as string, rawName: p.name, project: p })),
    );
    const withCounts = await Promise.all(
      disambig.map(async (r) => {
        const videos = await ctx.db
          .query("videos")
          .withIndex("by_project", (q) => q.eq("projectId", r.project._id))
          .collect();
        return {
          projectId: r.project._id,
          displayName: r.displayName,
          rawName: r.rawName,
          updatedAt: r.project._creationTime,
          videoCount: videos.filter((v) => !v.deletedAt).length,
          role: membership.role,
        };
      }),
    );
    return withCounts;
  },
});

/**
 * Browse one node of the drive tree below a project: a directory (its
 * subfolders + the videos that live directly in it) or a single file. The
 * WebDAV layer hands us the path segments *after* the project name — which may
 * end in a file — and we figure out whether it's a folder or a file by walking
 * the `folders` tree. This is what makes the mount mirror the web app's
 * workspace → project → folders → subfolders → files hierarchy instead of the
 * old flat project → all-videos listing.
 */
export const browsePathForDesktop = query({
  args: {
    teamSlug: v.string(),
    projectName: v.string(),
    folderPath: v.optional(v.array(v.string())),
    // When true (default), file sizes/types reflect the ~720p edit proxy where
    // a ready R2-mirrored rendition exists. Must match the GET path's choice.
    preferProxy: v.optional(v.boolean()),
  },
  returns: v.union(
    v.null(),
    v.object({
      type: v.literal("folder"),
      folders: v.array(
        v.object({ displayName: v.string(), updatedAt: v.number() }),
      ),
      videos: v.array(
        v.object({
          displayName: v.string(),
          ext: v.string(),
          size: v.number(),
          contentType: v.string(),
          updatedAt: v.number(),
          isReady: v.boolean(),
        }),
      ),
    }),
    v.object({
      type: v.literal("file"),
      displayName: v.string(),
      size: v.number(),
      contentType: v.string(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) return null;
    const team = await resolveTeamBySlug(ctx, args.teamSlug);
    if (!team) return null;
    await requireTeamAccess(ctx, team._id);
    const project = await resolveProjectByName(ctx, team._id, args.projectName);
    if (!project) return null;
    await requireProjectAccess(ctx, project._id);

    const preferProxy = args.preferProxy ?? true;
    const names = args.folderPath ?? [];
    const walk = await walkFolderPath(ctx, project._id, names);

    // Whole path resolved to folders (or it's the project root) → directory.
    if (walk.matched === names.length) {
      const [folders, videos] = await Promise.all([
        listSubfolders(ctx, project._id, walk.folderId),
        listVideosInFolder(ctx, project._id, walk.folderId, preferProxy),
      ]);
      return {
        type: "folder" as const,
        folders: folders.map((f) => ({
          displayName: f.displayName,
          updatedAt: f.updatedAt,
        })),
        videos: videos.map((vd) => ({
          displayName: vd.displayName,
          ext: vd.ext,
          size: vd.size,
          contentType: vd.contentType,
          updatedAt: vd.updatedAt,
          isReady: vd.isReady,
        })),
      };
    }

    // All but the last segment resolved → the last is a file in the deepest
    // matched folder.
    if (walk.matched === names.length - 1) {
      const fileName = names[names.length - 1];
      const videos = await listVideosInFolder(
        ctx,
        project._id,
        walk.folderId,
        preferProxy,
      );
      const match = videos.find((vd) => vd.displayName === fileName);
      if (match) {
        return {
          type: "file" as const,
          displayName: match.displayName,
          size: match.size,
          contentType: match.contentType,
          updatedAt: match.updatedAt,
        };
      }
    }

    return null;
  },
});

/**
 * Resolve the destination project + folder for a desktop upload. Uploads only
 * land in folders that already exist (Finder issues MKCOL → ensureFolderForDesktop
 * before PUT-ing into a new folder), so a path that doesn't fully resolve is
 * rejected rather than silently dropping the file at the project root.
 */
export const resolveUploadTargetForDesktop = query({
  args: {
    teamSlug: v.string(),
    projectName: v.string(),
    folderPath: v.optional(v.array(v.string())),
  },
  returns: v.union(
    v.null(),
    v.object({
      projectId: v.id("projects"),
      role: v.string(),
      folderId: v.union(v.null(), v.id("folders")),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) return null;
    const team = await resolveTeamBySlug(ctx, args.teamSlug);
    if (!team) return null;
    await requireTeamAccess(ctx, team._id);
    const project = await resolveProjectByName(ctx, team._id, args.projectName);
    if (!project) return null;
    const { membership } = await requireProjectAccess(ctx, project._id);
    const names = args.folderPath ?? [];
    const walk = await walkFolderPath(ctx, project._id, names);
    if (walk.matched !== names.length) return null;
    return {
      projectId: project._id,
      role: membership.role,
      folderId: walk.folderId ?? null,
    };
  },
});

/**
 * Resolve a WebDAV path to a concrete video id + s3 key. Used by GET/HEAD and
 * to gate operations on a known target.
 */
export const resolveVideoForDesktop = query({
  args: {
    teamSlug: v.string(),
    projectName: v.string(),
    folderPath: v.optional(v.array(v.string())),
    fileName: v.string(),
    // Mirror browsePathForDesktop: resolve the proxy object when enabled so the
    // presigned GET points at the same bytes PROPFIND advertised.
    preferProxy: v.optional(v.boolean()),
  },
  returns: v.union(
    v.null(),
    v.object({
      videoId: v.id("videos"),
      // The key to serve — proxy r2Key when proxy mode is on and a ready
      // rendition exists, else the original s3Key. Field name kept as `s3Key`
      // for call-site compatibility.
      s3Key: v.string(),
      size: v.number(),
      contentType: v.string(),
      updatedAt: v.number(),
      isProxy: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) return null;
    const team = await resolveTeamBySlug(ctx, args.teamSlug);
    if (!team) return null;
    await requireTeamAccess(ctx, team._id);
    const project = await resolveProjectByName(ctx, team._id, args.projectName);
    if (!project) return null;
    await requireProjectAccess(ctx, project._id);
    const preferProxy = args.preferProxy ?? true;
    const names = args.folderPath ?? [];
    const walk = await walkFolderPath(ctx, project._id, names);
    if (walk.matched !== names.length) return null;
    const videos = await listVideosInFolder(
      ctx,
      project._id,
      walk.folderId,
      preferProxy,
    );
    const match = videos.find((vd) => vd.displayName === args.fileName);
    if (!match) return null;
    const video = await ctx.db.get(match.videoId);
    if (!video) return null;
    const obj = pickDriveObject(video, preferProxy);
    if (!obj.key) return null;
    return {
      videoId: match.videoId,
      s3Key: obj.key,
      size: obj.size,
      contentType: obj.contentType,
      updatedAt: match.updatedAt,
      isProxy: obj.isProxy,
    };
  },
});

/**
 * Issue a presigned GET so Finder can stream a file directly from object
 * storage. We never proxy bytes through Convex — the desktop WebDAV server
 * 302-redirects rclone here, rclone follows.
 */
export const getDownloadUrlForDesktop = action({
  args: {
    teamSlug: v.string(),
    projectName: v.string(),
    folderPath: v.optional(v.array(v.string())),
    fileName: v.string(),
    preferProxy: v.optional(v.boolean()),
  },
  returns: v.union(
    v.null(),
    v.object({
      url: v.string(),
      size: v.number(),
      contentType: v.string(),
      expiresAt: v.number(),
      isProxy: v.boolean(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{
    url: string;
    size: number;
    contentType: string;
    expiresAt: number;
    isProxy: boolean;
  } | null> => {
    const target: {
      videoId: Id<"videos">;
      s3Key: string;
      size: number;
      contentType: string;
      updatedAt: number;
      isProxy: boolean;
    } | null = await ctx.runQuery(api.desktopBrowse.resolveVideoForDesktop, args);
    if (!target) return null;
    const s3 = getS3Client();
    const cmd = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: target.s3Key,
      ResponseContentType: target.contentType,
    });
    // Size-aware TTL: the URL must outlive a full cold read of the object. With
    // vfs-cache-mode=full rclone downloads the whole file once on open; a big
    // full-res original at a pessimistic ~3 MB/s sustained can take hours, and
    // a URL that expired mid-download would 403. Floor 6h (plenty for proxies),
    // cap 24h.
    const PESSIMISTIC_BYTES_PER_SEC = 3 * 1024 * 1024;
    const TTL = Math.min(
      24 * 3600,
      Math.max(6 * 3600, Math.ceil(target.size / PESSIMISTIC_BYTES_PER_SEC)),
    );
    const url = await getSignedUrl(s3, cmd, { expiresIn: TTL });
    return {
      url,
      size: target.size,
      contentType: target.contentType,
      expiresAt: Date.now() + TTL * 1000,
      isProxy: target.isProxy,
    };
  },
});

/**
 * Create a video row + a presigned PUT URL for the desktop WebDAV server to
 * stream the request body straight into S3. The actual finalize (Mux ingest,
 * status flip) happens via `completeUploadForDesktop` once the PUT lands.
 */
export const createUploadForDesktop = action({
  args: {
    teamSlug: v.string(),
    projectName: v.string(),
    folderPath: v.optional(v.array(v.string())),
    fileName: v.string(),
    size: v.number(),
    contentType: v.string(),
  },
  returns: v.object({
    videoId: v.id("videos"),
    uploadUrl: v.string(),
    s3Key: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ videoId: Id<"videos">; uploadUrl: string; s3Key: string }> => {
    const target: {
      projectId: Id<"projects">;
      role: string;
      folderId: Id<"folders"> | null;
    } | null = await ctx.runQuery(
      api.desktopBrowse.resolveUploadTargetForDesktop,
      {
        teamSlug: args.teamSlug,
        projectName: args.projectName,
        folderPath: args.folderPath,
      },
    );
    if (!target) {
      const where =
        args.folderPath && args.folderPath.length
          ? ` / folder "${args.folderPath.join("/")}"`
          : "";
      throw new Error(
        `No project "${args.projectName}"${where} in team "${args.teamSlug}".`,
      );
    }
    if (target.role === "viewer") {
      throw new Error("Viewer role can't upload to this project.");
    }
    // Idempotency. rclone re-PUTs the same drop repeatedly under
    // vfs-cache-mode full (it can't confirm the upload "took" — we serve no
    // mtime), so without this each retry spawned a fresh video row + a new
    // ~full-size R2 upload + Mux ingest. Reuse the in-flight row + object key.
    const inflight = await ctx.runQuery(
      internal.desktopBrowse.findInflightUpload,
      {
        projectId: target.projectId,
        folderId: target.folderId ?? undefined,
        title: args.fileName,
      },
    );
    if (inflight) {
      const reuseUrl = await getSignedUrl(
        getS3Client(),
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: inflight.s3Key,
          ContentType: args.contentType,
        }),
        { expiresIn: 3600 },
      );
      return {
        videoId: inflight.videoId,
        uploadUrl: reuseUrl,
        s3Key: inflight.s3Key,
      };
    }
    const videoId: Id<"videos"> = await ctx.runMutation(api.videos.create, {
      projectId: target.projectId,
      title: args.fileName,
      fileSize: args.size,
      contentType: args.contentType,
      folderId: target.folderId ?? undefined,
    });
    const ext = extractExt(args.fileName) ?? "bin";
    const key = `projects/${args.teamSlug}/${target.projectId}/originals/${videoId}/${Date.now()}.${ext}`;
    const s3 = getS3Client();
    const cmd = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: args.contentType,
    });
    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
    await ctx.runMutation(internal.videos.setUploadInfo, {
      videoId,
      s3Key: key,
      fileSize: args.size,
      contentType: args.contentType,
    });
    return { videoId, uploadUrl, s3Key: key };
  },
});

// Find the user's still-uploading video of the same name in the same folder, so
// a re-PUT of the same drop reuses that row + object instead of duplicating it.
// Oldest match wins so concurrent retries all converge on one row.
export const findInflightUpload = internalQuery({
  args: {
    projectId: v.id("projects"),
    folderId: v.optional(v.id("folders")),
    title: v.string(),
  },
  returns: v.union(
    v.object({ videoId: v.id("videos"), s3Key: v.string() }),
    v.null(),
  ),
  handler: async (ctx: QueryCtx, args) => {
    const rows = args.folderId
      ? await ctx.db
          .query("videos")
          .withIndex("by_folder", (q) => q.eq("folderId", args.folderId))
          .collect()
      : await ctx.db
          .query("videos")
          .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
          .collect();
    const match = rows
      .filter(
        (vd) =>
          vd.projectId === args.projectId &&
          (args.folderId ? vd.folderId === args.folderId : !vd.folderId) &&
          vd.title === args.title &&
          vd.status === "uploading" &&
          !vd.deletedAt &&
          typeof vd.s3Key === "string",
      )
      .sort((a, b) => a._creationTime - b._creationTime)[0];
    return match
      ? { videoId: match._id, s3Key: match.s3Key as string }
      : null;
  },
});

// One-off remediation for the duplicate-upload storm: collapse same-named
// videos stuck in "uploading" down to the oldest one (which owns the real R2
// object), soft-deleting the rest. Dry-run unless `apply` is true. Run via
// `npx convex run desktopBrowse:cleanupStuckDriveDuplicates '{"apply":true}'`.
export const cleanupStuckDriveDuplicates = internalMutation({
  args: {
    projectId: v.optional(v.id("projects")),
    apply: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    dupGroups: v.number(),
    removed: v.number(),
    kept: v.number(),
  }),
  handler: async (ctx, args) => {
    const cap = Math.min(args.limit ?? 8000, 16000);
    const all = args.projectId
      ? await ctx.db
          .query("videos")
          .withIndex("by_project", (q) =>
            q.eq("projectId", args.projectId as Id<"projects">),
          )
          .take(cap)
      : await ctx.db.query("videos").take(cap);
    const stuck = all.filter((vd) => vd.status === "uploading" && !vd.deletedAt);
    const byKey = new Map<string, Doc<"videos">[]>();
    for (const vd of stuck) {
      const k = `${vd.projectId}::${vd.folderId ?? "root"}::${vd.title}`;
      const g = byKey.get(k) ?? [];
      g.push(vd);
      byKey.set(k, g);
    }
    let dupGroups = 0;
    let removed = 0;
    let kept = 0;
    const now = Date.now();
    for (const g of byKey.values()) {
      if (g.length <= 1) continue;
      dupGroups++;
      g.sort((a, b) => a._creationTime - b._creationTime);
      kept++; // keep the oldest (g[0]) — it owns the real upload
      for (const dup of g.slice(1)) {
        removed++;
        if (args.apply) await ctx.db.patch(dup._id, { deletedAt: now });
      }
    }
    return { scanned: all.length, dupGroups, removed, kept };
  },
});

// Purge targets for the duplicate-upload storm cleanup: videos stuck in
// "uploading" for a while (deleted or not), with the R2/Mux refs we must free.
export const listStuckDriveUploads = internalQuery({
  args: { olderThanMs: v.optional(v.number()), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      videoId: v.id("videos"),
      s3Key: v.union(v.string(), v.null()),
      muxAssetId: v.union(v.string(), v.null()),
      proxyKeys: v.array(v.string()),
    }),
  ),
  handler: async (ctx: QueryCtx, args) => {
    const cutoff = Date.now() - (args.olderThanMs ?? 30 * 60 * 1000);
    const rows = await ctx.db.query("videos").take(args.limit ?? 8000);
    return rows
      .filter((vd) => vd.status === "uploading" && vd._creationTime < cutoff)
      .map((vd) => ({
        videoId: vd._id,
        s3Key: vd.s3Key ?? null,
        muxAssetId: vd.muxAssetId ?? null,
        proxyKeys: (vd.staticRenditions ?? [])
          .map((r) => r.r2Key)
          .filter((k): k is string => typeof k === "string"),
      }));
  },
});

// Soft-delete + fail a stuck upload after its R2/Mux bytes have been freed, so
// it leaves the grid and the active-uploads indicator and can't be reused.
export const markDriveUploadPurged = internalMutation({
  args: { videoId: v.id("videos") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const vd = await ctx.db.get(args.videoId);
    if (vd) {
      await ctx.db.patch(args.videoId, {
        deletedAt: Date.now(),
        status: "failed",
      });
    }
    return null;
  },
});

// TEMP diagnostic: recent videos with upload-completion fields, to see why
// drive uploads stall. No s3Key ⇒ createUploadForDesktop died before
// setUploadInfo; uploadError ⇒ a byte/ingest failure with the reason.
export const inspectRecentVideos = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.any()),
  handler: async (ctx: QueryCtx, args) => {
    const rows = await ctx.db
      .query("videos")
      .order("desc")
      .take(args.limit ?? 24);
    return rows.map((vd) => ({
      title: vd.title.slice(0, 24),
      status: vd.status,
      muxPlayback: vd.muxPlaybackId ? "yes" : "no",
      muxAssetStatus: vd.muxAssetStatus ?? null,
      thumb: vd.thumbnailUrl ? vd.thumbnailUrl.slice(0, 38) : null,
      hasS3Key: typeof vd.s3Key === "string" && vd.s3Key.length > 0,
      deleted: Boolean(vd.deletedAt),
    }));
  },
});

/**
 * Mark the upload as complete. Delegates to `videoActions.markUploadComplete`
 * which does the HEAD check + Mux handoff for video MIME types.
 */
export const completeUploadForDesktop = action({
  args: { videoId: v.id("videos") },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const result: { success: boolean } = await ctx.runAction(
      api.videoActions.markUploadComplete,
      { videoId: args.videoId },
    );
    return result;
  },
});

/**
 * Create a folder at `folderPath` (its last element is the new folder's name;
 * every segment before it must already exist). Backs WebDAV MKCOL so making a
 * new folder in Finder creates a real `folders` row the web app also sees.
 * Idempotent — re-creating an existing folder is a no-op.
 */
export const ensureFolderForDesktop = mutation({
  args: {
    teamSlug: v.string(),
    projectName: v.string(),
    folderPath: v.array(v.string()),
  },
  returns: v.object({ ok: v.boolean(), created: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) throw new Error("Not signed in.");
    const team = await resolveTeamBySlug(ctx, args.teamSlug);
    if (!team) throw new Error(`No team "${args.teamSlug}".`);
    await requireTeamAccess(ctx, team._id);
    const project = await resolveProjectByName(ctx, team._id, args.projectName);
    if (!project) throw new Error(`No project "${args.projectName}".`);
    await requireProjectAccess(ctx, project._id, "member");

    if (args.folderPath.length === 0) throw new Error("Folder name required.");
    const parentNames = args.folderPath.slice(0, -1);
    const rawName = args.folderPath[args.folderPath.length - 1];

    const walk = await walkFolderPath(ctx, project._id, parentNames);
    if (walk.matched !== parentNames.length) {
      throw new Error("Parent folder doesn't exist yet.");
    }

    const name = rawName.trim().replace(/\s+/g, " ").slice(0, 120);
    if (!name) throw new Error("Folder name can't be empty.");
    if (/[\\/:*?"<>|]/.test(name)) {
      throw new Error('Folder names can\'t contain \\ / : * ? " < > |');
    }

    const siblings = await ctx.db
      .query("folders")
      .withIndex("by_project_and_parent", (q) =>
        q.eq("projectId", project._id).eq("parentFolderId", walk.folderId),
      )
      .collect();
    if (siblings.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      return { ok: true, created: false };
    }

    await ctx.db.insert("folders", {
      projectId: project._id,
      parentFolderId: walk.folderId,
      name,
      createdByClerkId: user.subject,
      createdByName:
        (user as { name?: string; email?: string }).name ??
        (user as { email?: string }).email ??
        "Unknown",
    });
    return { ok: true, created: true };
  },
});
