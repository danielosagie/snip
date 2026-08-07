import type { JobStore } from "./jobStore";
import type {
  JobClaim,
  JobHeartbeat,
  RenderJobResult,
  RenderJobSpec,
} from "./types";
import { normalizeJobSpec } from "./validation";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface ConvexJobTransport {
  post<T>(path: string, body: unknown): Promise<T>;
}

export interface HttpConvexJobTransportOptions {
  siteUrl: string;
  pluginToken: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

function normalizeSiteUrl(value: string): string {
  const url = new URL(value.trim());
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("Convex render worker routes require HTTPS, or HTTP on localhost.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export class HttpConvexJobTransport implements ConvexJobTransport {
  private readonly siteUrl: string;
  private readonly pluginToken: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof globalThis.fetch;

  constructor(options: HttpConvexJobTransportOptions) {
    this.siteUrl = normalizeSiteUrl(options.siteUrl);
    this.pluginToken = options.pluginToken.trim();
    if (!this.pluginToken || /[\r\n]/.test(this.pluginToken)) {
      throw new Error("Render worker plugin token is invalid.");
    }
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Render worker HTTP timeout must be positive.");
    }
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("Render worker request timed out.")),
      this.timeoutMs,
    );
    timer.unref();
    try {
      const response = await this.fetchImplementation(new URL(path, `${this.siteUrl}/`), {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.pluginToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
        throw new Error("Render worker response is too large.");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        if (!response.ok) {
          throw new Error(text.slice(0, 500) || `Render worker endpoint returned ${response.status}.`);
        }
        throw new Error("Render worker endpoint returned invalid JSON.");
      }
      if (!response.ok) {
        const message = parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : `Render worker endpoint returned ${response.status}.`;
        throw new Error(message.slice(0, 500));
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

interface ClaimResponse {
  ok: true;
  claim: null | {
    jobId: string;
    claimToken: string;
    workerId: string;
    attempt: number;
    spec: RenderJobSpec;
  };
}

interface WriteResponse {
  ok: true;
  accepted: boolean;
  cancellationRequested?: boolean;
}

function claimEnvelope(claim: JobClaim) {
  return {
    jobId: claim.jobId,
    workerId: claim.workerId,
    claimToken: claim.claimToken,
  };
}

export class ConvexJobStore implements JobStore {
  constructor(private readonly transport: ConvexJobTransport) {}

  async claim(workerId: string, leaseMs: number): Promise<JobClaim | null> {
    const response = await this.transport.post<ClaimResponse>(
      "/render-jobs/claim",
      { workerId, leaseMs },
    );
    if (!response.claim) return null;
    const claim = response.claim;
    if (
      !claim.jobId
      || !claim.claimToken
      || claim.workerId !== workerId
      || !Number.isSafeInteger(claim.attempt)
      || claim.attempt <= 0
    ) {
      throw new Error("Render claim response is invalid.");
    }
    return {
      jobId: claim.jobId,
      claimToken: claim.claimToken,
      workerId: claim.workerId,
      attempt: claim.attempt,
      spec: normalizeJobSpec(claim.spec),
    };
  }

  async heartbeat(
    claim: JobClaim,
    heartbeat: JobHeartbeat,
    leaseMs: number,
  ): Promise<boolean> {
    const response = await this.transport.post<WriteResponse>(
      "/render-jobs/heartbeat",
      { ...claimEnvelope(claim), ...heartbeat, leaseMs },
    );
    return response.accepted && !response.cancellationRequested;
  }

  async complete(claim: JobClaim, result: RenderJobResult): Promise<void> {
    const response = await this.transport.post<WriteResponse>(
      "/render-jobs/complete",
      {
        ...claimEnvelope(claim),
        outputObjectKey: result.outputKey,
        manifestObjectKey: result.manifestKey,
        outputBytes: result.outputBytes,
        cache: result.cache,
      },
    );
    // A cancellation racing the final upload is already terminal server-side.
    // Treat it as an accepted completion call so JobRunner does not overwrite it.
    if (!response.accepted && !response.cancellationRequested) {
      throw new Error(`Worker ${claim.workerId} no longer owns job ${claim.jobId}.`);
    }
  }

  async fail(claim: JobClaim, error: string): Promise<void> {
    const response = await this.transport.post<WriteResponse>(
      "/render-jobs/fail",
      {
        ...claimEnvelope(claim),
        failure: {
          code: "RENDER_FAILED",
          retryable: false,
          message: error,
        },
      },
    );
    if (!response.accepted) {
      throw new Error(`Worker ${claim.workerId} no longer owns job ${claim.jobId}.`);
    }
  }

  async release(claim: JobClaim, reason: string): Promise<void> {
    const response = await this.transport.post<WriteResponse>(
      "/render-jobs/release",
      { ...claimEnvelope(claim), reason },
    );
    if (!response.accepted) {
      throw new Error(`Worker ${claim.workerId} no longer owns job ${claim.jobId}.`);
    }
  }
}
