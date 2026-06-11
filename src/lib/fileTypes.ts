import {
  FileText,
  FileImage,
  FileAudio,
  FileVideo,
  FileSpreadsheet,
  FileArchive,
  FileCode,
  FileSignature,
  File,
  Folder,
  Film,
  type LucideIcon,
} from "lucide-react";

/**
 * Maps a MIME type to a Google-Drive-style file presentation: a large
 * lucide icon, a brand color tuned to match Drive's visual language, and
 * a short human kind label ("PDF", "Doc", "Spreadsheet"). Used by tile +
 * list renderers so docs / images / audio / zips all look correct in the
 * project grid alongside videos.
 *
 * We keep colors close to Drive's so users get the muscle-memory benefit
 * (red = PDF / video, blue = doc, green = spreadsheet, etc.), but the
 * borders + shadows stay in snip's brutalist palette so it doesn't feel
 * like we ripped off the design.
 */

export type FileKind =
  | "video"
  | "pdf"
  | "doc"
  | "spreadsheet"
  | "presentation"
  | "image"
  | "audio"
  | "archive"
  | "code"
  | "contract"
  | "folder"
  | "project-file" // .prproj, .drp, .aaf, .fcpxml — editorial source files
  | "generic";

export interface FileTypeMeta {
  kind: FileKind;
  /** Short human label like "PDF" or "Image". */
  label: string;
  /** Lucide icon component. */
  Icon: LucideIcon;
  /** Tile background tint (Tailwind hex). */
  tileBg: string;
  /** Icon color on the tile. */
  iconColor: string;
  /** Whether this kind plays inline (video / audio) or needs download. */
  playable: boolean;
}

const PROJECT_FILE_EXTS = new Set([
  "prproj", "drp", "aaf", "xml", "fcpxml", "edl", "cube", "lut", "ale",
]);

export function fileKindFromContentType(
  contentType: string | undefined | null,
  filename?: string | null,
): FileKind {
  const ct = (contentType ?? "").toLowerCase();
  const ext = (filename ?? "").split(".").pop()?.toLowerCase() ?? "";

  if (ext && PROJECT_FILE_EXTS.has(ext)) return "project-file";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("audio/")) return "audio";
  if (ct === "application/pdf" || ext === "pdf") return "pdf";
  if (
    ct.includes("wordprocessingml") ||
    ct === "application/msword" ||
    ext === "docx" ||
    ext === "doc"
  )
    return "doc";
  if (
    ct.includes("spreadsheetml") ||
    ct === "application/vnd.ms-excel" ||
    ct === "text/csv" ||
    ext === "xlsx" ||
    ext === "xls" ||
    ext === "csv"
  )
    return "spreadsheet";
  if (
    ct.includes("presentationml") ||
    ct === "application/vnd.ms-powerpoint" ||
    ext === "pptx" ||
    ext === "ppt" ||
    ext === "key"
  )
    return "presentation";
  if (
    ct === "application/zip" ||
    ct === "application/x-zip-compressed" ||
    ct === "application/x-tar" ||
    ct === "application/gzip" ||
    ext === "zip" ||
    ext === "tar" ||
    ext === "gz" ||
    ext === "rar" ||
    ext === "7z"
  )
    return "archive";
  if (
    ct.startsWith("text/") ||
    ct.includes("javascript") ||
    ct.includes("json") ||
    ct.includes("xml") ||
    ["js", "ts", "tsx", "json", "html", "css", "py", "go", "rs"].includes(ext)
  )
    return "code";
  return "generic";
}

const REGISTRY: Record<FileKind, Omit<FileTypeMeta, "kind">> = {
  video: {
    label: "Video",
    Icon: Film,
    tileBg: "#fee2e2",
    iconColor: "#dc2626",
    playable: true,
  },
  pdf: {
    label: "PDF",
    Icon: FileText,
    tileBg: "#fee2e2",
    iconColor: "#dc2626",
    playable: false,
  },
  doc: {
    label: "Doc",
    Icon: FileText,
    tileBg: "#dbeafe",
    iconColor: "#2563eb",
    playable: false,
  },
  spreadsheet: {
    label: "Sheet",
    Icon: FileSpreadsheet,
    tileBg: "#d1fae5",
    iconColor: "#16a34a",
    playable: false,
  },
  presentation: {
    label: "Slides",
    Icon: FileImage,
    tileBg: "#fef3c7",
    iconColor: "#b45309",
    playable: false,
  },
  image: {
    label: "Image",
    Icon: FileImage,
    tileBg: "#e0e7ff",
    iconColor: "#4338ca",
    playable: false,
  },
  audio: {
    label: "Audio",
    Icon: FileAudio,
    tileBg: "#fef3c7",
    iconColor: "#b45309",
    playable: true,
  },
  archive: {
    label: "Archive",
    Icon: FileArchive,
    tileBg: "#f5e9d8",
    iconColor: "#7c4400",
    playable: false,
  },
  code: {
    label: "Code",
    Icon: FileCode,
    tileBg: "#e8e8e0",
    iconColor: "#1a1a1a",
    playable: false,
  },
  contract: {
    label: "Contract",
    Icon: FileSignature,
    tileBg: "#dde6dd",
    iconColor: "#FF6600",
    playable: false,
  },
  "project-file": {
    label: "Project",
    Icon: FileVideo,
    tileBg: "#fff7ed",
    iconColor: "#7c4400",
    playable: false,
  },
  folder: {
    label: "Folder",
    Icon: Folder,
    tileBg: "#e8e8e0",
    iconColor: "#1a1a1a",
    playable: false,
  },
  generic: {
    label: "File",
    Icon: File,
    tileBg: "#e8e8e0",
    iconColor: "#888",
    playable: false,
  },
};

export function fileTypeFromContent(
  contentType: string | undefined | null,
  filename?: string | null,
): FileTypeMeta {
  const kind = fileKindFromContentType(contentType, filename);
  return { kind, ...REGISTRY[kind] };
}

/**
 * Coarse buckets for the folder "Kind" filter. The full FileKind taxonomy
 * (12 kinds) is too granular for a filter menu — a user thinks "show me the
 * documents", not "show me the spreadsheets AND the presentations AND the
 * PDFs". These five buckets are the practical groupings; the per-tile icon +
 * label still uses the fine-grained kind.
 */
export type FileKindBucket =
  | "video"
  | "image"
  | "audio"
  | "document"
  | "other";

export const FILE_KIND_BUCKET_LABEL: Record<FileKindBucket, string> = {
  video: "Videos",
  image: "Images",
  audio: "Audio",
  document: "Documents",
  other: "Other files",
};

// Stable display order for the filter menu.
export const FILE_KIND_BUCKETS: FileKindBucket[] = [
  "video",
  "image",
  "audio",
  "document",
  "other",
];

export function fileKindBucket(kind: FileKind): FileKindBucket {
  switch (kind) {
    case "video":
      return "video";
    case "image":
      return "image";
    case "audio":
      return "audio";
    case "pdf":
    case "doc":
    case "spreadsheet":
    case "presentation":
    case "contract":
      return "document";
    default:
      return "other";
  }
}

export function fileKindBucketFromContent(
  contentType: string | undefined | null,
  filename?: string | null,
): FileKindBucket {
  return fileKindBucket(fileKindFromContentType(contentType, filename));
}

export function formatBytes(n: number | undefined | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
