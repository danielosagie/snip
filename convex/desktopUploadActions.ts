"use node";

import { v } from "convex/values";
import { action, ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { BUCKET_NAME, getS3Client } from "./s3";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

type UploadMode = "create" | "overwrite";
type UploadCommitArgs = {
  mode: UploadMode;
  teamSlug: string;
  projectName: string;
  folderPath?: string[];
  fileName: string;
  size: number;
  contentType: string;
  s3Key: string;
  videoId: Id<"videos"> | null;
  previousS3Key: string | null;
};

const uploadCommitValidators = {
  mode: v.union(v.literal("create"), v.literal("overwrite")),
  teamSlug: v.string(),
  projectName: v.string(),
  folderPath: v.optional(v.array(v.string())),
  fileName: v.string(),
  size: v.number(),
  contentType: v.string(),
  s3Key: v.string(),
  videoId: v.union(v.id("videos"), v.null()),
  previousS3Key: v.union(v.string(), v.null()),
};

async function deleteCandidateObject(s3Key: string): Promise<void> {
  try {
    await getS3Client().send(
      new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key }),
    );
  } catch (error) {
    console.warn(`desktop upload cleanup failed for ${s3Key}:`, error);
  }
}

async function commitCandidate(
  ctx: ActionCtx,
  args: UploadCommitArgs,
): Promise<{ videoId: Id<"videos">; processingPending: boolean }> {
  const target: {
    projectId: Id<"projects">;
    role: string;
    folderId: Id<"folders"> | null;
  } | null = await ctx.runQuery(api.desktopBrowse.resolveUploadTargetForDesktop, {
    teamSlug: args.teamSlug,
    projectName: args.projectName,
    folderPath: args.folderPath,
  });
  if (!target || target.role === "viewer") {
    await deleteCandidateObject(args.s3Key);
    throw new Error("The upload destination is no longer writable.");
  }
  const expectedPrefix = `projects/${args.teamSlug}/${target.projectId}/originals/desktop-pending/`;
  if (!args.s3Key.startsWith(expectedPrefix)) {
    throw new Error("Invalid desktop upload candidate key.");
  }

  let actualSize: number;
  try {
    const head = await getS3Client().send(
      new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: args.s3Key }),
    );
    if (typeof head.ContentLength !== "number" || !Number.isFinite(head.ContentLength)) {
      throw new Error("Uploaded bytes could not be verified.");
    }
    actualSize = head.ContentLength;
    if (actualSize !== args.size) {
      throw new Error(`Upload size mismatch (expected ${args.size}, received ${actualSize}).`);
    }
  } catch (error) {
    await deleteCandidateObject(args.s3Key);
    throw error;
  }

  let videoId: Id<"videos">;
  let createdVideoId: Id<"videos"> | null = null;
  try {
    if (args.mode === "overwrite") {
      if (!args.videoId) throw new Error("Replacement target is missing.");
      await ctx.runMutation(internal.desktopBrowse.commitVideoOverwrite, {
        videoId: args.videoId,
        previousS3Key: args.previousS3Key,
        s3Key: args.s3Key,
        fileSize: actualSize,
        contentType: args.contentType,
      });
      videoId = args.videoId;
    } else {
      const collision = await ctx.runQuery(internal.desktopBrowse.findUploadTarget, {
        projectId: target.projectId,
        folderId: target.folderId ?? undefined,
        fileName: args.fileName,
      });
      if (collision) {
        throw new Error("A file appeared at this path while the upload was running. Retry to replace it.");
      }
      videoId = await ctx.runMutation(api.videos.create, {
        projectId: target.projectId,
        title: args.fileName,
        fileSize: actualSize,
        contentType: args.contentType,
        folderId: target.folderId ?? undefined,
      });
      createdVideoId = videoId;
      await ctx.runMutation(internal.videos.setUploadInfo, {
        videoId,
        s3Key: args.s3Key,
        fileSize: actualSize,
        contentType: args.contentType,
      });
    }
  } catch (error) {
    if (createdVideoId) {
      await ctx.runMutation(internal.desktopBrowse.rollbackNewDesktopUpload, {
        videoId: createdVideoId,
        s3Key: args.s3Key,
      }).catch(() => {});
    }
    await deleteCandidateObject(args.s3Key);
    throw error;
  }

  if (actualSize === 0) {
    await ctx.runMutation(internal.videos.markAsReadyAsFile, {
      videoId,
      fileSize: 0,
      contentType: args.contentType || "application/octet-stream",
    });
    return { videoId, processingPending: false };
  }

  try {
    await ctx.runAction(api.videoActions.markUploadComplete, { videoId });
    return { videoId, processingPending: false };
  } catch (error) {
    console.warn(`desktop upload ${videoId} finalize deferred:`, error);
    await ctx.scheduler.runAfter(
      30_000,
      internal.videoActions.markUploadCompleteInternal,
      { videoId, attempt: 1 },
    );
    return { videoId, processingPending: true };
  }
}

/** Verify candidate bytes, atomically publish them, then start processing. */
export const commitUploadForDesktop = action({
  args: uploadCommitValidators,
  returns: v.object({
    videoId: v.id("videos"),
    processingPending: v.boolean(),
  }),
  handler: commitCandidate,
});

/** Remove an uncommitted candidate after a client abort or failed transfer. */
export const abortUploadForDesktop = action({
  args: {
    teamSlug: v.string(),
    projectName: v.string(),
    folderPath: v.optional(v.array(v.string())),
    s3Key: v.string(),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const target: { projectId: Id<"projects">; role: string } | null =
      await ctx.runQuery(api.desktopBrowse.resolveUploadTargetForDesktop, {
        teamSlug: args.teamSlug,
        projectName: args.projectName,
        folderPath: args.folderPath,
      });
    if (!target || target.role === "viewer") return { ok: false };
    const expectedPrefix = `projects/${args.teamSlug}/${target.projectId}/originals/desktop-pending/`;
    if (!args.s3Key.startsWith(expectedPrefix)) return { ok: false };
    await deleteCandidateObject(args.s3Key);
    return { ok: true };
  },
});

function cleanDesktopFileName(raw: string): string {
  const name = raw.normalize("NFC");
  if (!name || name === "." || name === "..") throw new Error("File name is required.");
  if (name.includes("/") || name.includes("\0")) throw new Error("Invalid file name.");
  if (name.length > 255) throw new Error("File name is too long.");
  return name;
}

export const copyPathForDesktop = action({
  args: {
    teamSlug: v.string(),
    projectName: v.string(),
    itemPath: v.array(v.string()),
    destinationTeamSlug: v.string(),
    destinationProjectName: v.string(),
    destinationPath: v.array(v.string()),
    overwrite: v.boolean(),
  },
  returns: v.object({ overwritten: v.boolean(), videoId: v.id("videos") }),
  handler: async (ctx, args): Promise<{ overwritten: boolean; videoId: Id<"videos"> }> => {
    if (args.itemPath.length === 0 || args.destinationPath.length === 0) {
      throw new Error("Source and destination file names are required.");
    }
    const source = await ctx.runQuery(api.desktopBrowse.resolveVideoForDesktop, {
      teamSlug: args.teamSlug,
      projectName: args.projectName,
      folderPath: args.itemPath.slice(0, -1),
      fileName: args.itemPath[args.itemPath.length - 1],
      preferProxy: false,
    });
    if (!source) throw new Error("Source file not found.");
    const destinationFileName = cleanDesktopFileName(
      args.destinationPath[args.destinationPath.length - 1],
    );
    const destinationFolderPath = args.destinationPath.slice(0, -1);
    const destinationTarget: {
      projectId: Id<"projects">;
      role: string;
      folderId: Id<"folders"> | null;
    } | null = await ctx.runQuery(api.desktopBrowse.resolveUploadTargetForDesktop, {
      teamSlug: args.destinationTeamSlug,
      projectName: args.destinationProjectName,
      folderPath: destinationFolderPath,
    });
    if (!destinationTarget || destinationTarget.role === "viewer") {
      throw new Error("Destination is not writable.");
    }
    const existing = await ctx.runQuery(internal.desktopBrowse.findUploadTarget, {
      projectId: destinationTarget.projectId,
      folderId: destinationTarget.folderId ?? undefined,
      fileName: destinationFileName,
    });
    if (existing && !args.overwrite) {
      throw new Error("Destination already exists and overwrite is disabled.");
    }
    const extension = destinationFileName.includes(".")
      ? destinationFileName.split(".").pop() || "bin"
      : "bin";
    const candidateKey = `projects/${args.destinationTeamSlug}/${destinationTarget.projectId}/originals/desktop-pending/${crypto.randomUUID()}.${extension}`;
    const encodedSource = `/${BUCKET_NAME}/${source.s3Key
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`;
    await getS3Client().send(
      new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        Key: candidateKey,
        CopySource: encodedSource,
        ContentType: source.contentType,
        MetadataDirective: "REPLACE",
      }),
    );
    const committed = await commitCandidate(ctx, {
      mode: existing ? "overwrite" : "create",
      teamSlug: args.destinationTeamSlug,
      projectName: args.destinationProjectName,
      folderPath: destinationFolderPath,
      fileName: destinationFileName,
      size: source.size,
      contentType: source.contentType,
      s3Key: candidateKey,
      videoId: existing?.videoId ?? null,
      previousS3Key: existing?.s3Key ?? null,
    });
    return { overwritten: Boolean(existing), videoId: committed.videoId };
  },
});
