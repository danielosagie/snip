import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type {
  PanelConfig,
  PresenceHeartbeatRequest,
  PresenceHeartbeatResponse,
  TimelineSnapshotListResponse,
  TimelineSnapshotPush,
  TimelineSnapshotResponse,
} from "./model";
import { buildAuthHeaders } from "./protocol";

const RESPONSE_LIMIT_BYTES = 32 * 1024 * 1024;

interface SnapshotPushResponse {
  ok: true;
  snapshotId: string;
  team: string;
}

export class PluginHttpClient {
  private readonly headers: Record<string, string>;

  constructor(private readonly config: PanelConfig) {
    this.headers = buildAuthHeaders(config.pluginToken);
  }

  heartbeat(payload: PresenceHeartbeatRequest): Promise<PresenceHeartbeatResponse> {
    return this.request("/timelines/presence", "POST", payload);
  }

  pushSnapshot(payload: TimelineSnapshotPush): Promise<SnapshotPushResponse> {
    return this.request("/timelines/snapshot", "POST", payload);
  }

  listSnapshots(): Promise<TimelineSnapshotListResponse> {
    const query = new URLSearchParams({ projectId: this.config.projectId });
    return this.request(`/timelines/snapshots?${query}`, "GET");
  }

  getSnapshot(snapshotId: string): Promise<TimelineSnapshotResponse> {
    const query = new URLSearchParams({
      projectId: this.config.projectId,
      snapshotId,
    });
    return this.request(`/timelines/snapshot?${query}`, "GET");
  }

  private request<T>(path: string, method: "GET" | "POST", payload?: unknown): Promise<T> {
    const url = new URL(path, `${this.config.serverUrl}/`);
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;

    return new Promise<T>((resolve, reject) => {
      const req = request(
        url,
        {
          method,
          headers: {
            ...this.headers,
            ...(body == null ? {} : { "content-length": String(Buffer.byteLength(body)) }),
          },
          timeout: 10_000,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > RESPONSE_LIMIT_BYTES) {
              response.destroy(new Error("Server response is too large."));
              return;
            }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
              let message = text;
              try {
                const parsed = JSON.parse(text) as { error?: string };
                message = parsed.error || text;
              } catch {
                // Plain-text errors are valid for existing plugin routes.
              }
              reject(new Error(message.slice(0, 240) || `Server returned ${response.statusCode}.`));
              return;
            }
            try {
              resolve(JSON.parse(text) as T);
            } catch {
              reject(new Error("Server returned invalid JSON."));
            }
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("Server request timed out.")));
      req.on("error", reject);
      if (body != null) req.write(body);
      req.end();
    });
  }
}
