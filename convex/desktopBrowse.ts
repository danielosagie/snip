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
  MutationCtx,
  query,
  QueryCtx,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { getUser, identityName, requireProjectAccess, requireTeamAccess } from "./auth";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client, BUCKET_NAME } from "./s3";
import { indexSearchable, removeSearchableForVideo } from "./search";

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

function desktopPathCandidates(
  teamSlug: string,
  projectName: string,
  projectId: Id<"projects">,
  itemPath: string[],
): string[] {
  const suffix = itemPath.filter(Boolean).join("/");
  const join = (base: string) => (suffix ? `${base}/${suffix}` : base);
  return [
    join(`projects/${teamSlug}/${projectId}`),
    join(`projects/${teamSlug}/${projectName}`),
    join(`projects/${projectName}`),
    join(`${teamSlug}/${projectName}`),
  ];
}

/** Server-side enforcement for the folder-permission intent table. */
async function hasDesktopPathAccess(
  ctx: QueryCtx | MutationCtx,
  teamId: Id<"teams">,
  role: string,
  userSubject: string,
  candidates: string[],
  allowAncestor: boolean,
): Promise<boolean> {
  const grants = await ctx.db
    .query("folderPermissions")
    .withIndex("by_team", (q) => q.eq("teamId", teamId))
    .collect();
  if (grants.length === 0) return true;

  for (const rawCandidate of candidates) {
    const candidate = rawCandidate.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    const exactMatches = grants
      .filter((grant) => {
        const prefix = grant.pathPrefix.replace(/^[/\\]+/, "").replace(/\\/g, "/");
        return candidate === prefix.replace(/\/$/, "") || candidate.startsWith(prefix);
      })
      .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length);
    if (exactMatches.length > 0) {
      const best = exactMatches[0];
      return best.allowedRoles.includes(role) || best.allowedClerkIds.includes(userSubject);
    }
    if (allowAncestor) {
      const ancestorPrefix = candidate.endsWith("/") ? candidate : `${candidate}/`;
      const visibleDescendant = grants.some((grant) => {
        const prefix = grant.pathPrefix.replace(/^[/\\]+/, "").replace(/\\/g, "/");
        return (
          prefix.startsWith(ancestorPrefix) &&
          (grant.allowedRoles.includes(role) || grant.allowedClerkIds.includes(userSubject))
        );
      });
      if (visibleDescendant) return true;
    }
  }
  return false;
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
  etag: string;
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
      updatedAt: r.video.driveModifiedAt ?? r.video._creationTime,
      etag: `"${r.video._id}-${r.video.driveVersion ?? 1}"`,
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
  etag: string;
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
    updatedAt: f.driveModifiedAt ?? f._creationTime,
    etag: `"${f._id}-${f.driveVersion ?? 1}"`,
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
    const visible = (
      await Promise.all(
        live.map(async (project) =>
          (await hasDesktopPathAccess(
            ctx,
            team._id,
            membership.role,
            user.subject,
            desktopPathCandidates(args.teamSlug, project.name, project._id, []),
            true,
          ))
            ? project
            : null,
        ),
      )
    ).filter((project): project is Doc<"projects"> => Boolean(project));
    const disambig = disambiguate(
      visible.map((p) => ({ _id: p._id as string, rawName: p.name, project: p })),
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
        v.object({ displayName: v.string(), updatedAt: v.number(), etag: v.string() }),
      ),
      videos: v.array(
        v.object({
          displayName: v.string(),
          ext: v.string(),
          size: v.number(),
          contentType: v.string(),
          updatedAt: v.number(),
          etag: v.string(),
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
      etag: v.string(),
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

    const preferProxy = args.preferProxy ?? true;
    const names = args.folderPath ?? [];
    const walk = await walkFolderPath(ctx, project._id, names);

    // Whole path resolved to folders (or it's the project root) → directory.
    if (walk.matched === names.length) {
      if (
        !(await hasDesktopPathAccess(
          ctx,
          team._id,
          membership.role,
          user.subject,
          desktopPathCandidates(args.teamSlug, project.name, project._id, names),
          true,
        ))
      ) {
        return null;
      }
      const [folders, videos] = await Promise.all([
        listSubfolders(ctx, project._id, walk.folderId),
        listVideosInFolder(ctx, project._id, walk.folderId, preferProxy),
      ]);
      const visibleFolders = (
        await Promise.all(
          folders.map(async (folder) =>
            (await hasDesktopPathAccess(
              ctx,
              team._id,
              membership.role,
              user.subject,
              desktopPathCandidates(
                args.teamSlug,
                project.name,
                project._id,
                [...names, folder.displayName],
              ),
              true,
            ))
              ? folder
              : null,
          ),
        )
      ).filter((folder): folder is FolderListEntry => Boolean(folder));
      const visibleVideos = (
        await Promise.all(
          videos.map(async (video) => {
            const row = await ctx.db.get(video.videoId);
            if (!row) return null;
            const candidates = [
              ...(row.s3Key ? [row.s3Key] : []),
              ...desktopPathCandidates(
                args.teamSlug,
                project.name,
                project._id,
                [...names, video.displayName],
              ),
            ];
            return (await hasDesktopPathAccess(
              ctx,
              team._id,
              membership.role,
              user.subject,
              candidates,
              false,
            ))
              ? video
              : null;
          }),
        )
      ).filter((video): video is VideoListEntry => Boolean(video));
      return {
        type: "folder" as const,
        folders: visibleFolders.map((f) => ({
          displayName: f.displayName,
          updatedAt: f.updatedAt,
          etag: f.etag,
        })),
        videos: visibleVideos.map((vd) => ({
          displayName: vd.displayName,
          ext: vd.ext,
          size: vd.size,
          contentType: vd.contentType,
          updatedAt: vd.updatedAt,
          etag: vd.etag,
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
      const match = videos.find(
        (vd) => vd.displayName.toLowerCase() === fileName.toLowerCase(),
      );
      if (match) {
        const row = await ctx.db.get(match.videoId);
        const allowed =
          row &&
          (await hasDesktopPathAccess(
            ctx,
            team._id,
            membership.role,
            user.subject,
            [
              ...(row.s3Key ? [row.s3Key] : []),
              ...desktopPathCandidates(args.teamSlug, project.name, project._id, names),
            ],
            false,
          ));
        if (!allowed) return null;
        return {
          type: "file" as const,
          displayName: match.displayName,
          size: match.size,
          contentType: match.contentType,
          updatedAt: match.updatedAt,
          etag: match.etag,
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
    if (
      !(await hasDesktopPathAccess(
        ctx,
        team._id,
        membership.role,
        user.subject,
        desktopPathCandidates(args.teamSlug, project.name, project._id, names),
        false,
      ))
    ) {
      return null;
    }
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
    const { membership } = await requireProjectAccess(ctx, project._id);
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
    const match = videos.find(
      (vd) => vd.displayName.toLowerCase() === args.fileName.toLowerCase(),
    );
    if (!match) return null;
    const video = await ctx.db.get(match.videoId);
    if (!video) return null;
    if (
      !(await hasDesktopPathAccess(
        ctx,
        team._id,
        membership.role,
        user.subject,
        [
          ...(video.s3Key ? [video.s3Key] : []),
          ...desktopPathCandidates(
            args.teamSlug,
            project.name,
            project._id,
            [...names, args.fileName],
          ),
        ],
        false,
      ))
    ) {
      return null;
    }
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
 * Begin a desktop upload without mutating the live file row. Every PUT lands
 * at a unique candidate key; `commitUploadForDesktop` HEAD-verifies those bytes
 * before atomically creating/swapping the row. A cancelled request can therefore
 * delete the candidate without touching the existing file.
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
    mode: v.union(v.literal("create"), v.literal("overwrite")),
    videoId: v.union(v.id("videos"), v.null()),
    previousS3Key: v.union(v.string(), v.null()),
    uploadUrl: v.string(),
    s3Key: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    mode: "create" | "overwrite";
    videoId: Id<"videos"> | null;
    previousS3Key: string | null;
    uploadUrl: string;
    s3Key: string;
  }> => {
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
    const existing = await ctx.runQuery(
      internal.desktopBrowse.findUploadTarget,
      {
        projectId: target.projectId,
        folderId: target.folderId ?? undefined,
        fileName: args.fileName,
      },
    );
    const ext = extractExt(args.fileName) ?? "bin";
    const candidateId = crypto.randomUUID();
    const key = `projects/${args.teamSlug}/${target.projectId}/originals/desktop-pending/${candidateId}.${ext}`;
    const s3 = getS3Client();
    const cmd = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: args.contentType,
    });
    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
    return {
      mode: existing ? "overwrite" : "create",
      videoId: existing?.videoId ?? null,
      previousS3Key: existing?.s3Key ?? null,
      uploadUrl,
      s3Key: key,
    };
  },
});

// The one live row a drive PUT to this path should write into, if any —
// regardless of status. Matching only "uploading" rows (the original
// idempotency fix) left a hole: a re-PUT landing AFTER the row completed
// fell through and minted a duplicate sibling. Oldest match wins so retries
// and legacy duplicates all converge on the row whose plain name the listing
// shows (disambiguate is oldest-wins).
export const findUploadTarget = internalQuery({
  args: {
    projectId: v.id("projects"),
    folderId: v.optional(v.id("folders")),
    fileName: v.string(),
  },
  returns: v.union(
    v.object({
      videoId: v.id("videos"),
      s3Key: v.union(v.string(), v.null()),
    }),
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
    const scoped = rows.filter(
      (vd) =>
        vd.projectId === args.projectId &&
        (args.folderId ? vd.folderId === args.folderId : !vd.folderId) &&
        !vd.deletedAt,
    );
    // Match the exact display name produced by the mount, not the raw title.
    // Web uploads store a title without an extension while drive uploads store
    // the original file name; buildVideoEntries normalizes both representations.
    const displayed = buildVideoEntries(scoped, false);
    const hit = displayed.find(
      (entry) => entry.displayName.toLowerCase() === args.fileName.toLowerCase(),
    );
    const match = hit ? scoped.find((vd) => vd._id === hit.videoId) : null;
    return match
      ? {
          videoId: match._id,
          s3Key: typeof match.s3Key === "string" ? match.s3Key : null,
        }
      : null;
  },
});

// In-place overwrite for a drive PUT over an existing completed file: point
// the row at the new object key and clear every derivative of the old bytes
// (playback IDs, previews, renditions, thumbnails) so markUploadComplete
// re-processes from scratch. The replaced original + encoded assets are GC'd
// best-effort in the background — a leaked object is a COGS leak, not a
// correctness bug. Comments/timelines stay attached to the row, same as any
// filesystem overwrite.
export const commitVideoOverwrite = internalMutation({
  args: {
    videoId: v.id("videos"),
    previousS3Key: v.union(v.string(), v.null()),
    s3Key: v.string(),
    fileSize: v.number(),
    contentType: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const vd = await ctx.db.get(args.videoId);
    if (!vd) throw new Error("Video row vanished mid-overwrite.");
    const currentKey = typeof vd.s3Key === "string" ? vd.s3Key : null;
    if (currentKey !== args.previousS3Key) {
      throw new Error("The destination changed while the replacement was uploading. Retry it.");
    }
    const replacedObjectKeys = [
      ...(typeof vd.s3Key === "string" && vd.s3Key !== args.s3Key
        ? [vd.s3Key]
        : []),
      ...(vd.staticRenditions ?? [])
        .map((r) => r.r2Key)
        .filter((k): k is string => Boolean(k)),
      ...(vd.imagePreviewS3Key ? [vd.imagePreviewS3Key] : []),
    ];
    const replacedMuxAssetIds = [
      ...(vd.muxAssetId ? [vd.muxAssetId] : []),
      ...(vd.muxPreviewAssetId ? [vd.muxPreviewAssetId] : []),
    ];
    const replacedStreamUid = vd.streamUid;
    await ctx.db.patch(args.videoId, {
      s3Key: args.s3Key,
      fileSize: args.fileSize,
      contentType: args.contentType,
      status: "uploading",
      uploadError: undefined,
      muxUploadId: undefined,
      muxAssetId: undefined,
      muxPlaybackId: undefined,
      muxSignedPlaybackId: undefined,
      muxAssetStatus: "preparing",
      muxCaptionsTrackId: undefined,
      muxPreviewAssetId: undefined,
      muxPreviewPlaybackId: undefined,
      muxPreviewAssetStatus: undefined,
      muxPreviewAssetError: undefined,
      muxPreviewAssetUpdatedAt: undefined,
      staticRenditions: undefined,
      streamUid: undefined,
      encodingDeferred: undefined,
      thumbnailUrl: undefined,
      imagePreviewS3Key: undefined,
      imagePreviewStatus: undefined,
      driveModifiedAt: Date.now(),
      driveVersion: (vd.driveVersion ?? 0) + 1,
    });
    if (
      replacedObjectKeys.length > 0 ||
      replacedMuxAssetIds.length > 0 ||
      replacedStreamUid
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.retentionActions.purgeReplacedAssets,
        {
          s3Keys: replacedObjectKeys,
          muxAssetIds: replacedMuxAssetIds,
          streamUid: replacedStreamUid,
        },
      );
    }
    return null;
  },
});

/** Roll back the tiny create→setUploadInfo window if publishing a new row fails. */
export const rollbackNewDesktopUpload = internalMutation({
  args: { videoId: v.id("videos"), s3Key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (
      video &&
      video.status === "uploading" &&
      (!video.s3Key || video.s3Key === args.s3Key)
    ) {
      await removeSearchableForVideo(ctx, video._id).catch(() => {});
      await ctx.db.delete(video._id);
    }
    return null;
  },
});

// Status probe for completeUploadForDesktop's idempotency guard.
export const getVideoStatusForDesktop = internalQuery({
  args: { videoId: v.id("videos") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx: QueryCtx, args) => {
    const vd = await ctx.db.get(args.videoId);
    return vd && !vd.deletedAt ? vd.status : null;
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

// Second-wave remediation: the storm also left COMPLETED duplicates — rows
// that finished processing before the idempotent-PUT fix landed, plus
// post-completion re-PUTs the in-flight-only matcher missed. Collapse
// same-named completed rows whose byte count matches the kept (oldest) row,
// soft-deleting the rest. The byte-count match keeps this conservative: two
// genuinely different files sharing a name are left alone. Dry-run unless
// `apply` is true. Run via
// `npx convex run desktopBrowse:cleanupCompletedDriveDuplicates '{"apply":true}'`.
export const cleanupCompletedDriveDuplicates = internalMutation({
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
    skippedSizeMismatch: v.number(),
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
    const live = all.filter(
      (vd) => !vd.deletedAt && vd.status !== "uploading",
    );
    const byKey = new Map<string, Doc<"videos">[]>();
    for (const vd of live) {
      const k = `${vd.projectId}::${vd.folderId ?? "root"}::${vd.title}`;
      const g = byKey.get(k) ?? [];
      g.push(vd);
      byKey.set(k, g);
    }
    let dupGroups = 0;
    let removed = 0;
    let kept = 0;
    let skippedSizeMismatch = 0;
    const now = Date.now();
    for (const g of byKey.values()) {
      if (g.length <= 1) continue;
      dupGroups++;
      g.sort((a, b) => a._creationTime - b._creationTime);
      kept++; // the oldest owns the plain name in the drive listing
      for (const dup of g.slice(1)) {
        if (dup.fileSize !== g[0].fileSize) {
          skippedSizeMismatch++;
          continue;
        }
        removed++;
        if (args.apply) await ctx.db.patch(dup._id, { deletedAt: now });
      }
    }
    return { scanned: all.length, dupGroups, removed, kept, skippedSizeMismatch };
  },
});

// Storage/encoding refs held by soft-deleted rows that are byte-identical
// duplicates of a still-live row (same project/folder/title/fileSize) — the
// rows cleanupCompletedDriveDuplicates trashes. Their assets are pure
// redundancy: the kept row serves the same bytes. Also returns every ref any
// LIVE row uses so the purge can refuse to delete anything still served.
// (Restoring one of these from trash would yield a row with no assets — but
// it's an exact copy of a live file, so there's nothing to restore it FOR.)
export const listDeletedDuplicateRefs = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.object({
    deleted: v.array(
      v.object({
        videoId: v.id("videos"),
        muxAssetIds: v.array(v.string()),
        streamUid: v.union(v.string(), v.null()),
        objectKeys: v.array(v.string()),
      }),
    ),
    liveMuxAssetIds: v.array(v.string()),
    liveStreamUids: v.array(v.string()),
    liveObjectKeys: v.array(v.string()),
  }),
  handler: async (ctx: QueryCtx, args) => {
    const cap = Math.min(args.limit ?? 8000, 16000);
    const all = await ctx.db.query("videos").take(cap);
    const live = all.filter((vd) => !vd.deletedAt);
    const liveKeySet = new Set(
      live.map(
        (vd) => `${vd.projectId}::${vd.folderId ?? "root"}::${vd.title}::${vd.fileSize ?? -1}`,
      ),
    );
    const refsOf = (vd: Doc<"videos">) => ({
      muxAssetIds: [
        ...(vd.muxAssetId ? [vd.muxAssetId] : []),
        ...(vd.muxPreviewAssetId ? [vd.muxPreviewAssetId] : []),
      ],
      streamUid: vd.streamUid ?? null,
      objectKeys: [
        ...(typeof vd.s3Key === "string" ? [vd.s3Key] : []),
        ...(vd.staticRenditions ?? [])
          .map((r) => r.r2Key)
          .filter((k): k is string => Boolean(k)),
        ...(vd.imagePreviewS3Key ? [vd.imagePreviewS3Key] : []),
      ],
    });
    const deleted = all
      .filter(
        (vd) =>
          vd.deletedAt &&
          vd.status !== "uploading" &&
          liveKeySet.has(
            `${vd.projectId}::${vd.folderId ?? "root"}::${vd.title}::${vd.fileSize ?? -1}`,
          ),
      )
      .map((vd) => ({ videoId: vd._id, ...refsOf(vd) }));
    const liveRefs = live.map(refsOf);
    return {
      deleted,
      liveMuxAssetIds: liveRefs.flatMap((r) => r.muxAssetIds),
      liveStreamUids: liveRefs
        .map((r) => r.streamUid)
        .filter((s): s is string => Boolean(s)),
      liveObjectKeys: liveRefs.flatMap((r) => r.objectKeys),
    };
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
      .filter(
        (vd) =>
          vd.status === "uploading" &&
          !vd.encodingDeferred &&
          (vd.driveModifiedAt ?? vd._creationTime) < cutoff,
      )
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
// Drops every storage/encoding ref from an already-soft-deleted row after
// its assets were purged, so re-running the purge (and any future GC) sees
// nothing left to do. Refuses to touch live rows.
export const clearPurgedAssetRefs = internalMutation({
  args: { videoId: v.id("videos") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const vd = await ctx.db.get(args.videoId);
    if (!vd || !vd.deletedAt) return null;
    await ctx.db.patch(args.videoId, {
      s3Key: undefined,
      muxUploadId: undefined,
      muxAssetId: undefined,
      muxPlaybackId: undefined,
      muxSignedPlaybackId: undefined,
      muxCaptionsTrackId: undefined,
      muxPreviewAssetId: undefined,
      muxPreviewPlaybackId: undefined,
      staticRenditions: undefined,
      streamUid: undefined,
      imagePreviewS3Key: undefined,
    });
    return null;
  },
});

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
    return rows
      .filter((vd) => !vd.deletedAt)
      .map((vd) => ({
        title: vd.title.slice(0, 24),
        status: vd.status,
        kind: vd.kind ?? "video",
        muxPlayback: vd.muxPlaybackId ? "yes" : "no",
        muxAssetStatus: vd.muxAssetStatus ?? null,
        captions: vd.muxCaptionsTrackId ? "yes" : "no",
        previewAsset: vd.muxPreviewAssetStatus ?? null,
        previewError: vd.muxPreviewAssetError
          ? vd.muxPreviewAssetError.slice(0, 60)
          : null,
        evictedAt: vd.renditionEvictedAt ?? null,
        deferred: Boolean(vd.encodingDeferred),
        hasS3Key: typeof vd.s3Key === "string" && vd.s3Key.length > 0,
      }));
  },
});

/**
 * Mark the upload as complete. Delegates to `videoActions.markUploadComplete`
 * which does the HEAD check + Mux handoff for video MIME types.
 *
 * Idempotent: rclone re-PUTs (and the same-bytes reuse path in
 * createUploadForDesktop) re-fire this after the row already completed or
 * while ingest is mid-flight. markUploadComplete unconditionally re-runs
 * startEncoding, which would bill a second Mux asset — so only fresh uploads
 * ("uploading") and retryable failures ("failed") proceed.
 */
export const completeUploadForDesktop = action({
  args: { videoId: v.id("videos") },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const status: string | null = await ctx.runQuery(
      internal.desktopBrowse.getVideoStatusForDesktop,
      { videoId: args.videoId },
    );
    if (status === null) return { success: false };
    if (status !== "uploading" && status !== "failed") {
      return { success: true };
    }
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
    const { membership } = await requireProjectAccess(ctx, project._id, "member");

    if (args.folderPath.length === 0) throw new Error("Folder name required.");
    if (
      !(await hasDesktopPathAccess(
        ctx,
        team._id,
        membership.role,
        user.subject,
        desktopPathCandidates(
          args.teamSlug,
          project.name,
          project._id,
          args.folderPath,
        ),
        false,
      ))
    ) {
      throw new Error("Folder path is not writable.");
    }
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

    const now = Date.now();
    await ctx.db.insert("folders", {
      projectId: project._id,
      parentFolderId: walk.folderId,
      name,
      createdByClerkId: user.subject,
      createdByName:
        (user as { name?: string; email?: string }).name ??
        (user as { email?: string }).email ??
        "Unknown",
      driveModifiedAt: now,
      driveVersion: 1,
    });
    return { ok: true, created: true };
  },
});

type DesktopResolvedItem =
  | { type: "folder"; folder: Doc<"folders"> }
  | { type: "file"; video: Doc<"videos">; displayName: string };

async function resolveDesktopItem(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  itemPath: string[],
): Promise<DesktopResolvedItem | null> {
  if (itemPath.length === 0) return null;
  const walk = await walkFolderPath(ctx, projectId, itemPath);
  if (walk.matched === itemPath.length && walk.folderId) {
    const folder = await ctx.db.get(walk.folderId);
    return folder ? { type: "folder", folder } : null;
  }
  if (walk.matched !== itemPath.length - 1) return null;
  const rows = walk.folderId
    ? await ctx.db
        .query("videos")
        .withIndex("by_folder", (q) => q.eq("folderId", walk.folderId))
        .collect()
    : await ctx.db
        .query("videos")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect();
  const scoped = rows.filter(
    (vd) =>
      vd.projectId === projectId &&
      (walk.folderId ? vd.folderId === walk.folderId : !vd.folderId) &&
      !vd.deletedAt,
  );
  const wanted = itemPath[itemPath.length - 1].toLowerCase();
  const entry = buildVideoEntries(scoped, false).find(
    (candidate) => candidate.displayName.toLowerCase() === wanted,
  );
  if (!entry) return null;
  const video = scoped.find((vd) => vd._id === entry.videoId);
  return video ? { type: "file", video, displayName: entry.displayName } : null;
}

function cleanDesktopFileName(raw: string): string {
  const name = raw.normalize("NFC");
  if (!name || name === "." || name === "..") throw new Error("File name is required.");
  if (name.includes("/") || name.includes("\0")) throw new Error("Invalid file name.");
  if (name.length > 255) throw new Error("File name is too long.");
  return name;
}

export const deletePathForDesktop = mutation({
  args: {
    teamSlug: v.string(),
    projectName: v.string(),
    itemPath: v.array(v.string()),
  },
  returns: v.object({ type: v.union(v.literal("file"), v.literal("folder")) }),
  handler: async (ctx, args) => {
    const team = await resolveTeamBySlug(ctx, args.teamSlug);
    if (!team) throw new Error("Team not found.");
    const project = await resolveProjectByName(ctx, team._id, args.projectName);
    if (!project) throw new Error("Project not found.");
    const { user, membership } = await requireProjectAccess(ctx, project._id, "member");
    const item = await resolveDesktopItem(ctx, project._id, args.itemPath);
    if (!item) throw new Error("File or folder not found.");
    const candidates = [
      ...(item.type === "file" && item.video.s3Key ? [item.video.s3Key] : []),
      ...desktopPathCandidates(args.teamSlug, project.name, project._id, args.itemPath),
    ];
    if (
      !(await hasDesktopPathAccess(
        ctx,
        team._id,
        membership.role,
        user.subject,
        candidates,
        false,
      ))
    ) {
      throw new Error("Path is not writable.");
    }
    if (item.type === "file") {
      await ctx.db.patch(item.video._id, {
        deletedAt: Date.now(),
        deletedByName: identityName(user),
        driveModifiedAt: Date.now(),
        driveVersion: (item.video.driveVersion ?? 0) + 1,
      });
      await removeSearchableForVideo(ctx, item.video._id).catch(() => {});
      return { type: "file" as const };
    }
    const [children, videos] = await Promise.all([
      ctx.db
        .query("folders")
        .withIndex("by_project_and_parent", (q) =>
          q.eq("projectId", project._id).eq("parentFolderId", item.folder._id),
        )
        .collect(),
      ctx.db
        .query("videos")
        .withIndex("by_folder", (q) => q.eq("folderId", item.folder._id))
        .collect(),
    ]);
    if (children.length > 0 || videos.some((video) => !video.deletedAt)) {
      throw new Error("Folder isn't empty. Delete or move its contents first.");
    }
    await ctx.db.delete(item.folder._id);
    return { type: "folder" as const };
  },
});

export const movePathForDesktop = mutation({
  args: {
    teamSlug: v.string(),
    projectName: v.string(),
    itemPath: v.array(v.string()),
    destinationTeamSlug: v.string(),
    destinationProjectName: v.string(),
    destinationPath: v.array(v.string()),
    overwrite: v.boolean(),
  },
  returns: v.object({
    type: v.union(v.literal("file"), v.literal("folder")),
    overwritten: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (args.destinationPath.length === 0) throw new Error("Destination name is required.");
    const sourceTeam = await resolveTeamBySlug(ctx, args.teamSlug);
    const destinationTeam = await resolveTeamBySlug(ctx, args.destinationTeamSlug);
    if (!sourceTeam || !destinationTeam) throw new Error("Team not found.");
    const sourceProject = await resolveProjectByName(ctx, sourceTeam._id, args.projectName);
    const destinationProject = await resolveProjectByName(
      ctx,
      destinationTeam._id,
      args.destinationProjectName,
    );
    if (!sourceProject || !destinationProject) throw new Error("Project not found.");
    const sourceAccess = await requireProjectAccess(ctx, sourceProject._id, "member");
    const destinationAccess = await requireProjectAccess(
      ctx,
      destinationProject._id,
      "member",
    );
    const source = await resolveDesktopItem(ctx, sourceProject._id, args.itemPath);
    if (!source) throw new Error("Source not found.");
    if (
      !(await hasDesktopPathAccess(
        ctx,
        sourceTeam._id,
        sourceAccess.membership.role,
        sourceAccess.user.subject,
        [
          ...(source.type === "file" && source.video.s3Key ? [source.video.s3Key] : []),
          ...desktopPathCandidates(
            args.teamSlug,
            sourceProject.name,
            sourceProject._id,
            args.itemPath,
          ),
        ],
        false,
      ))
    ) {
      throw new Error("Source path is not writable.");
    }

    const destinationName = cleanDesktopFileName(
      args.destinationPath[args.destinationPath.length - 1],
    );
    const destinationParents = args.destinationPath.slice(0, -1);
    const parentWalk = await walkFolderPath(ctx, destinationProject._id, destinationParents);
    if (parentWalk.matched !== destinationParents.length) {
      throw new Error("Destination folder not found.");
    }
    const destination = await resolveDesktopItem(
      ctx,
      destinationProject._id,
      args.destinationPath,
    );
    if (
      !(await hasDesktopPathAccess(
        ctx,
        destinationTeam._id,
        destinationAccess.membership.role,
        destinationAccess.user.subject,
        [
          ...(destination?.type === "file" && destination.video.s3Key
            ? [destination.video.s3Key]
            : []),
          ...desktopPathCandidates(
            args.destinationTeamSlug,
            destinationProject.name,
            destinationProject._id,
            args.destinationPath,
          ),
        ],
        false,
      ))
    ) {
      throw new Error("Destination path is not writable.");
    }
    if (
      destination &&
      ((source.type === "file" && destination.type === "file" && source.video._id === destination.video._id) ||
        (source.type === "folder" && destination.type === "folder" && source.folder._id === destination.folder._id))
    ) {
      return { type: source.type, overwritten: false };
    }

    if (source.type === "folder") {
      if (sourceProject._id !== destinationProject._id) {
        throw new Error("Folders can only be moved within the same project.");
      }
      if (destination) throw new Error("A file or folder already exists at the destination.");
      if (parentWalk.folderId === source.folder._id) {
        throw new Error("Can't move a folder into itself.");
      }
      let cursor = parentWalk.folderId;
      while (cursor) {
        if (cursor === source.folder._id) {
          throw new Error("Can't move a folder into one of its descendants.");
        }
        const parent: Doc<"folders"> | null = await ctx.db.get(cursor);
        cursor = parent?.parentFolderId;
      }
      await ctx.db.patch(source.folder._id, {
        parentFolderId: parentWalk.folderId,
        name: destinationName,
        driveModifiedAt: Date.now(),
        driveVersion: (source.folder.driveVersion ?? 0) + 1,
      });
      return { type: "folder" as const, overwritten: false };
    }

    let overwritten = false;
    if (destination) {
      if (destination.type !== "file") throw new Error("A folder already exists at the destination.");
      if (!args.overwrite) throw new Error("Destination already exists and overwrite is disabled.");
      await ctx.db.patch(destination.video._id, {
        deletedAt: Date.now(),
        driveModifiedAt: Date.now(),
        driveVersion: (destination.video.driveVersion ?? 0) + 1,
      });
      await removeSearchableForVideo(ctx, destination.video._id).catch(() => {});
      overwritten = true;
    }
    const now = Date.now();
    await ctx.db.patch(source.video._id, {
      projectId: destinationProject._id,
      folderId: parentWalk.folderId,
      title: destinationName,
      driveModifiedAt: now,
      driveVersion: (source.video.driveVersion ?? 0) + 1,
    });
    await indexSearchable(ctx, {
      kind: "video",
      refId: source.video._id,
      teamId: destinationProject.teamId,
      projectId: destinationProject._id,
      videoId: source.video._id,
      title: destinationName,
      contextLabel: `${destinationProject.name} · ${source.video.contentType ?? "file"}`,
      text: `${destinationName} ${source.video.description ?? ""}`,
    }).catch(() => {});
    return { type: "file" as const, overwritten };
  },
});
