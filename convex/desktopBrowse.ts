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
import { action, mutation, query, QueryCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { getUser, requireProjectAccess, requireTeamAccess } from "./auth";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const ID_SUFFIX_LEN = 6;

function shortId(id: string): string {
  return id.slice(-ID_SUFFIX_LEN);
}

function disambiguate<T extends { _id: string; rawName: string }>(
  rows: T[],
): Array<T & { displayName: string }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.rawName, (counts.get(row.rawName) ?? 0) + 1);
  }
  return rows.map((row) => {
    const isDup = (counts.get(row.rawName) ?? 0) > 1;
    return {
      ...row,
      displayName: isDup ? `${row.rawName} (${shortId(row._id)})` : row.rawName,
    };
  });
}

function getS3Client(): S3Client {
  const endpoint = process.env.R2_S3_ENDPOINT ?? process.env.RAILWAY_S3_ENDPOINT;
  const region = process.env.R2_REGION ?? process.env.RAILWAY_REGION ?? "auto";
  const accessKeyId =
    process.env.R2_ACCESS_KEY_ID ?? process.env.RAILWAY_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY ?? process.env.RAILWAY_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Object storage credentials not configured.");
  }
  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

function getBucketName(): string {
  const name = process.env.R2_BUCKET_NAME ?? process.env.RAILWAY_BUCKET_NAME;
  if (!name) throw new Error("Bucket name not configured.");
  return name;
}

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
};

function buildVideoEntries(videos: Doc<"videos">[]): VideoListEntry[] {
  const live = videos.filter((vd) => !vd.deletedAt);
  // Items are content-type agnostic — the `videos` table doubles as the
  // generic file table (PDFs, images, audio, .ai, .psd, anything). The
  // backend's markUploadComplete already routes non-video MIME types
  // through markAsReadyAsFile, so the desktop drive just surfaces whatever
  // landed.
  const rows = live.map((vd) => {
    const ext = extractExt(vd.s3Key ?? undefined) ?? extractExt(vd.title);
    const rawTitle = ext ? stripExt(vd.title, ext) : vd.title;
    return {
      _id: vd._id as string,
      rawName: ext ? `${rawTitle}.${ext}` : rawTitle,
      video: vd,
      rawTitle,
      ext: ext ?? "",
    };
  });
  const disambig = disambiguate(rows);
  return disambig.map((r) => ({
    videoId: r.video._id,
    displayName: r.displayName,
    rawTitle: r.rawTitle,
    ext: r.ext,
    size: r.video.fileSize ?? 0,
    contentType: r.video.contentType ?? "application/octet-stream",
    updatedAt: r.video._creationTime,
    isReady: r.video.status === "ready",
    hasS3Key: Boolean(r.video.s3Key),
  }));
}

// Videos that live directly inside `folderId` — or at the project root when
// folderId is undefined. The drive mirrors the web app's folder tree, so each
// directory shows only its own files, not the whole project flattened (which
// is what the old single-level mount did).
async function listVideosInFolder(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  folderId: Id<"folders"> | undefined,
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
  return buildVideoEntries(videos);
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

    const names = args.folderPath ?? [];
    const walk = await walkFolderPath(ctx, project._id, names);

    // Whole path resolved to folders (or it's the project root) → directory.
    if (walk.matched === names.length) {
      const [folders, videos] = await Promise.all([
        listSubfolders(ctx, project._id, walk.folderId),
        listVideosInFolder(ctx, project._id, walk.folderId),
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
      const videos = await listVideosInFolder(ctx, project._id, walk.folderId);
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
  },
  returns: v.union(
    v.null(),
    v.object({
      videoId: v.id("videos"),
      s3Key: v.string(),
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
    const names = args.folderPath ?? [];
    const walk = await walkFolderPath(ctx, project._id, names);
    if (walk.matched !== names.length) return null;
    const videos = await listVideosInFolder(ctx, project._id, walk.folderId);
    const match = videos.find((vd) => vd.displayName === args.fileName);
    if (!match || !match.hasS3Key) return null;
    const video = await ctx.db.get(match.videoId);
    if (!video || !video.s3Key) return null;
    return {
      videoId: match.videoId,
      s3Key: video.s3Key,
      size: match.size,
      contentType: match.contentType,
      updatedAt: match.updatedAt,
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
  },
  returns: v.union(
    v.null(),
    v.object({
      url: v.string(),
      size: v.number(),
      contentType: v.string(),
      expiresAt: v.number(),
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
  } | null> => {
    const target: {
      videoId: Id<"videos">;
      s3Key: string;
      size: number;
      contentType: string;
      updatedAt: number;
    } | null = await ctx.runQuery(api.desktopBrowse.resolveVideoForDesktop, args);
    if (!target) return null;
    const s3 = getS3Client();
    const cmd = new GetObjectCommand({
      Bucket: getBucketName(),
      Key: target.s3Key,
      ResponseContentType: target.contentType,
    });
    const TTL = 3600;
    const url = await getSignedUrl(s3, cmd, { expiresIn: TTL });
    return {
      url,
      size: target.size,
      contentType: target.contentType,
      expiresAt: Date.now() + TTL * 1000,
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
      Bucket: getBucketName(),
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
