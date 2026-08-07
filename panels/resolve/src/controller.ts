import { randomUUID } from "node:crypto";
import { PanelConfigStore, publicConfig } from "./config-store";
import { PluginHttpClient } from "./http-client";
import type {
  PanelConfig,
  PanelConfigInput,
  PanelState,
  TimelineSnapshotSummary,
} from "./model";
import {
  buildPresenceRequest,
  buildSnapshotPayload,
  createDebouncedTask,
} from "./protocol";
import { ResolveAdapter, ResolveUnavailableError } from "./resolve-adapter";

const PRESENCE_INTERVAL_MS = 1_500;
const EDIT_INTERVAL_MS = 2_000;
const PUSH_DEBOUNCE_MS = 3_000;
const PUSH_MAX_WAIT_MS = 12_000;

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export class ResolvePanelController {
  private config?: PanelConfig;
  private http?: PluginHttpClient;
  private readonly sessionId = randomUUID();
  private listeners = new Set<(state: PanelState) => void>();
  private presenceTimer?: ReturnType<typeof setInterval>;
  private editTimer?: ReturnType<typeof setInterval>;
  private presenceBusy = false;
  private editBusy = false;
  private pushPromise?: Promise<void>;
  private lastPushedSignature?: string;
  private state: PanelState = {
    status: "setup",
    config: publicConfig(),
    teammates: [],
    snapshots: [],
    pushing: false,
    pulling: false,
  };

  private readonly debouncedPush = createDebouncedTask(
    () => this.pushCurrentTimeline(),
    PUSH_DEBOUNCE_MS,
    { maxWaitMs: PUSH_MAX_WAIT_MS },
  );

  constructor(
    private readonly resolve: ResolveAdapter,
    private readonly configStore = new PanelConfigStore(),
  ) {}

  async initialize(): Promise<PanelState> {
    this.config = await this.configStore.load();
    if (!this.config) {
      this.setState({ status: "setup", config: publicConfig() });
      return this.state;
    }
    this.startRuntime();
    return this.state;
  }

  subscribe(listener: (state: PanelState) => void): void {
    this.listeners.add(listener);
    listener(this.state);
  }

  getState(): PanelState {
    return this.state;
  }

  async saveConfig(input: PanelConfigInput): Promise<PanelState> {
    this.config = await this.configStore.save(input, this.config);
    this.startRuntime();
    return this.state;
  }

  async refreshSnapshots(): Promise<PanelState> {
    const http = this.httpOrThrow();
    try {
      const response = await http.listSnapshots();
      this.setState({ snapshots: response.snapshots, error: undefined });
    } catch (error) {
      this.setState({ error: message(error) });
    }
    return this.state;
  }

  async pullSnapshot(snapshotId: string): Promise<PanelState> {
    const http = this.httpOrThrow();
    if (!snapshotId.trim()) throw new Error("Choose a snapshot.");
    this.setState({ pulling: true, error: undefined });
    try {
      const response = await http.getSnapshot(snapshotId);
      if (!response.snapshot.fcpxml) throw new Error("Snapshot has no FCPXML.");
      const timelineName = await this.resolve.importSnapshot({
        branch: response.snapshot.branch,
        fcpxml: response.snapshot.fcpxml,
        message: response.snapshot.message,
        snapshotId: response.snapshot.id,
      });
      const inventory = this.resolve.inspectTimeline();
      this.lastPushedSignature = inventory.signature;
      this.setState({
        timelineName,
        sourceTimelineId: inventory.context.sourceTimelineId,
        timecode: inventory.context.timecode,
        playhead: buildPresenceRequest(
          this.configOrThrow(),
          inventory.context,
          this.sessionId,
        ).payload.playheadPosition,
        error: undefined,
      });
      void this.tickPresence();
    } catch (error) {
      this.setState({ error: message(error) });
    } finally {
      this.setState({ pulling: false });
    }
    return this.state;
  }

  async pushNow(): Promise<PanelState> {
    this.debouncedPush.cancel();
    await this.pushCurrentTimeline();
    return this.state;
  }

  stop(): void {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    if (this.editTimer) clearInterval(this.editTimer);
    this.presenceTimer = undefined;
    this.editTimer = undefined;
    this.debouncedPush.cancel();
  }

  private startRuntime(): void {
    this.stop();
    this.http = new PluginHttpClient(this.configOrThrow());
    this.lastPushedSignature = undefined;
    this.setState({
      status: "connecting",
      config: publicConfig(this.config),
      error: undefined,
      teammates: [],
      snapshots: [],
    });
    void this.tickPresence();
    void this.tickEdits();
    void this.refreshSnapshots();
    this.presenceTimer = setInterval(() => void this.tickPresence(), PRESENCE_INTERVAL_MS);
    this.editTimer = setInterval(() => void this.tickEdits(), EDIT_INTERVAL_MS);
  }

  private async tickPresence(): Promise<void> {
    if (this.presenceBusy || !this.http || !this.config) return;
    this.presenceBusy = true;
    try {
      const context = this.resolve.getContext();
      const request = buildPresenceRequest(this.config, context, this.sessionId);
      const response = await this.http.heartbeat(request);
      this.setState({
        status: "live",
        timelineName: context.timelineName,
        sourceTimelineId: context.sourceTimelineId,
        timecode: context.timecode,
        playhead: request.payload.playheadPosition,
        teammates: response.teammates
          .filter((teammate) => teammate.sessionId !== this.sessionId)
          .sort((left, right) => left.displayName.localeCompare(right.displayName)),
        error: undefined,
      });
    } catch (error) {
      this.setState({
        status: error instanceof ResolveUnavailableError ? "unavailable" : "offline",
        error: message(error),
      });
    } finally {
      this.presenceBusy = false;
    }
  }

  private async tickEdits(): Promise<void> {
    if (this.editBusy || !this.config) return;
    this.editBusy = true;
    try {
      const inventory = this.resolve.inspectTimeline();
      this.setState({
        timelineName: inventory.context.timelineName,
        sourceTimelineId: inventory.context.sourceTimelineId,
        timecode: inventory.context.timecode,
      });
      if (inventory.signature !== this.lastPushedSignature) this.debouncedPush.trigger();
    } catch (error) {
      if (error instanceof ResolveUnavailableError) {
        this.setState({ status: "unavailable", error: message(error) });
      }
    } finally {
      this.editBusy = false;
    }
  }

  private async pushCurrentTimeline(): Promise<void> {
    if (this.pushPromise) return this.pushPromise;
    const config = this.configOrThrow();
    const http = this.httpOrThrow();
    this.pushPromise = (async () => {
      this.setState({ pushing: true, error: undefined });
      try {
        const inventory = this.resolve.inspectTimeline();
        const fcpxml = await this.resolve.exportCurrentTimeline();
        await http.pushSnapshot(buildSnapshotPayload(config, inventory, fcpxml));
        this.lastPushedSignature = inventory.signature;
        this.debouncedPush.cancel();
        this.setState({
          status: "live",
          lastPushAt: Date.now(),
          timelineName: inventory.context.timelineName,
          sourceTimelineId: inventory.context.sourceTimelineId,
          error: undefined,
        });
        void this.refreshSnapshots();
      } catch (error) {
        this.setState({ status: "offline", error: message(error) });
      } finally {
        this.setState({ pushing: false });
      }
    })().finally(() => {
      this.pushPromise = undefined;
    });
    return this.pushPromise;
  }

  private configOrThrow(): PanelConfig {
    if (!this.config) throw new Error("Complete setup first.");
    return this.config;
  }

  private httpOrThrow(): PluginHttpClient {
    if (!this.http) throw new Error("Complete setup first.");
    return this.http;
  }

  private setState(patch: Partial<PanelState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // A failed renderer listener must never stop background sync.
      }
    }
  }
}

export function branchesFromSnapshots(snapshots: TimelineSnapshotSummary[]): string[] {
  return [...new Set(snapshots.map((snapshot) => snapshot.branch))].sort((left, right) =>
    left.localeCompare(right),
  );
}
