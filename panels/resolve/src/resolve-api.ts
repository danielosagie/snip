export interface ResolveWorkflowIntegration {
  Initialize(pluginId: string): boolean;
  GetResolve(): ResolveApi;
  SetAPITimeout?(seconds: number): boolean;
  CleanUp(): boolean;
}

export interface ResolveApi {
  EXPORT_NONE?: number;
  EXPORT_FCPXML_1_10?: number;
  GetProjectManager(): ResolveProjectManager | undefined;
}

export interface ResolveProjectManager {
  GetCurrentProject(): ResolveProject | undefined;
}

export interface ResolveProject {
  GetName(): string;
  GetUniqueId?(): string;
  GetSetting?(name: string): unknown;
  GetCurrentTimeline(): ResolveTimeline | undefined;
  SetCurrentTimeline?(timeline: ResolveTimeline): boolean;
  GetMediaPool(): ResolveMediaPool | undefined;
  ExportCurrentTimelineToFile?(path: string, exportType: number): boolean;
}

export interface ResolveMediaPool {
  ImportTimelineFromFile(
    path: string,
    options?: {
      timelineName?: string;
      importSourceClips?: boolean;
    },
  ): ResolveTimeline | boolean | undefined;
}

export interface ResolveTimeline {
  GetName(): string;
  GetUniqueId?(): string;
  GetSetting?(name: string): unknown;
  GetStartFrame(): number;
  GetEndFrame(): number;
  GetStartTimecode?(): string;
  GetCurrentTimecode?(): string;
  GetCurrentVideoItem?(): ResolveTimelineItem | undefined;
  GetTrackCount(kind: "audio" | "subtitle" | "video"): number;
  GetTrackName?(kind: "audio" | "subtitle" | "video", index: number): string;
  GetIsTrackEnabled?(kind: "audio" | "subtitle" | "video", index: number): boolean;
  GetIsTrackLocked?(kind: "audio" | "subtitle" | "video", index: number): boolean;
  GetItemListInTrack(
    kind: "audio" | "subtitle" | "video",
    index: number,
  ): ResolveTimelineItem[] | Record<string, ResolveTimelineItem> | undefined;
  GetMarkers?(): Record<string, unknown> | undefined;
  Export?(path: string, exportType: number, exportSubtype?: number): boolean;
}

export interface ResolveTimelineItem {
  GetName(): string;
  GetUniqueId?(): string;
  GetStart(): number;
  GetEnd(): number;
  GetDuration(): number;
  GetMediaPoolItem?(): ResolveMediaPoolItem | undefined;
  GetClipEnabled?(): boolean;
}

export interface ResolveMediaPoolItem {
  GetUniqueId?(): string;
}
