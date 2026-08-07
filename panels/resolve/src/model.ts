import type { TimelinePresencePayload, TimelineTime } from "../../../src/lib/timeline/types";

export type NleSurface = "browser" | "desktop" | "premiere" | "resolve";

export interface PanelConfig {
  serverUrl: string;
  pluginToken: string;
  projectId: string;
  displayName: string;
  branch: string;
}

export interface PanelConfigInput {
  serverUrl: string;
  pluginToken?: string;
  projectId: string;
  displayName: string;
  branch: string;
}

export interface PublicPanelConfig {
  serverUrl: string;
  projectId: string;
  displayName: string;
  branch: string;
  configured: boolean;
  tokenHint?: string;
}

export interface ResolveContext {
  projectName: string;
  sourceProjectId: string;
  timelineName: string;
  sourceTimelineId: string;
  frameRate: number;
  startFrame: number;
  endFrame: number;
  playheadFrame: number;
  timecode: string;
  selectedClipIds: string[];
}

export type ResolveTrackKind = "audio" | "subtitle" | "video";

export interface ResolveTimelineItemInventory {
  id: string;
  name: string;
  start: number;
  end: number;
  duration: number;
  mediaId?: string;
  enabled?: boolean;
}

export interface ResolveTrackInventory {
  kind: ResolveTrackKind;
  index: number;
  name: string;
  enabled: boolean;
  locked: boolean;
  items: ResolveTimelineItemInventory[];
}

export interface ResolveTimelineInventory {
  context: ResolveContext;
  tracks: ResolveTrackInventory[];
  markers: Record<string, unknown>;
  signature: string;
}

export interface PresenceHeartbeatRequest {
  projectId: string;
  branch: string;
  sessionId: string;
  sourceProjectId: string;
  sourceTimelineId: string;
  timelineName: string;
  displayName: string;
  surface: "resolve";
  payload: TimelinePresencePayload;
}

export interface TeammatePresence {
  id: string;
  sessionId?: string;
  displayName: string;
  surface: NleSurface;
  timelineName?: string;
  sourceTimelineId?: string;
  payload: TimelinePresencePayload;
  updatedAt: number;
}

export interface PresenceHeartbeatResponse {
  ok: true;
  teammates: TeammatePresence[];
}

export interface TimelineSnapshotPush {
  projectId: string;
  cuts: string;
  color: string;
  audio: string;
  effects: string;
  markers: string;
  metadata: string;
  fcpxml: string;
  branch: string;
  message: string;
  sourceProjectId: string;
  sourceTimelineId: string;
  createdByName: string;
  source: "resolve";
}

export interface TimelineSnapshotSummary {
  id: string;
  branch: string;
  message: string;
  createdAt: number;
  createdByName: string;
  source: "manual" | "premiere" | "resolve";
  sourceProjectId?: string;
  sourceTimelineId?: string;
}

export interface TimelineSnapshotListResponse {
  ok: true;
  snapshots: TimelineSnapshotSummary[];
}

export interface TimelineSnapshotResponse {
  ok: true;
  snapshot: TimelineSnapshotSummary & {
    fcpxml: string;
  };
}

export type PanelConnectionStatus =
  | "connecting"
  | "live"
  | "offline"
  | "setup"
  | "unavailable";

export interface PanelState {
  status: PanelConnectionStatus;
  config: PublicPanelConfig;
  timelineName?: string;
  sourceTimelineId?: string;
  timecode?: string;
  playhead?: TimelineTime;
  lastPushAt?: number;
  teammates: TeammatePresence[];
  snapshots: TimelineSnapshotSummary[];
  pushing: boolean;
  pulling: boolean;
  error?: string;
}

export interface SnipResolveBridge {
  getState(): Promise<PanelState>;
  onState(listener: (state: PanelState) => void): void;
  saveConfig(input: PanelConfigInput): Promise<PanelState>;
  refreshSnapshots(): Promise<PanelState>;
  pullSnapshot(snapshotId: string): Promise<PanelState>;
  pushNow(): Promise<PanelState>;
}
