"use strict";

/** Keep Convex latency and outages away from the NLE save path. */
class BufferedWatcherTransport {
  constructor({ send, flushMs = 100, maxBuffered = 200, onLog = () => {} }) {
    if (typeof send !== "function") throw new TypeError("Watcher transport requires send().");
    this.send = send;
    this.flushMs = flushMs;
    this.maxBuffered = maxBuffered;
    this.onLog = onLog;
    this.buffer = [];
    this.timer = null;
    this.inFlight = false;
    this.closed = false;
  }

  publish(events) {
    if (this.closed) return Promise.resolve();
    for (const event of events || []) {
      const key = `${event.kind}:${event.root}:${event.file}:${event.mtime}:${event.hash}`;
      const index = this.buffer.findIndex(
        (candidate) =>
          `${candidate.kind}:${candidate.root}:${candidate.file}:${candidate.mtime}:${candidate.hash}` ===
          key,
      );
      if (index >= 0) this.buffer[index] = event;
      else this.buffer.push(event);
    }
    if (this.buffer.length > this.maxBuffered) {
      this.buffer.splice(0, this.buffer.length - this.maxBuffered);
    }
    this.schedule();
    return Promise.resolve();
  }

  schedule(delay = this.flushMs) {
    if (this.closed || this.timer || this.inFlight || this.buffer.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
    this.timer.unref?.();
  }

  async flush() {
    if (this.closed || this.inFlight || this.buffer.length === 0) return;
    this.inFlight = true;
    const batch = this.buffer.splice(0, 50);
    try {
      await this.send(batch);
    } catch (error) {
      // Keep newest data and retry slowly. The server currently has no client
      // event ID, so an uncertain response can produce a duplicate durable row.
      this.buffer.unshift(...batch);
      if (this.buffer.length > this.maxBuffered) {
        this.buffer.splice(0, this.buffer.length - this.maxBuffered);
      }
      this.onLog(
        `watcher: event publish failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.inFlight = false;
      this.schedule(this.buffer.length > 0 ? 1000 : this.flushMs);
    }
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.buffer.length = 0;
  }
}

function durableEvent(event) {
  return {
    kind: event.kind,
    file: event.file,
    root: event.root,
    mtime: event.mtime,
    observedAt: event.observedAt,
    hash: event.hash,
    parseStatus: event.parseStatus,
    ...(event.parseError ? { parseError: event.parseError } : {}),
  };
}

function createConvexWatcherTransport({
  convexCall,
  getContext,
  onLog,
  legacyPresenceFallback = false,
}) {
  return new BufferedWatcherTransport({
    onLog,
    send: async (events) => {
      const context = await getContext();
      if (!context.projectId) {
        throw new Error("Select a project before publishing watcher events.");
      }
      try {
        await convexCall("mutation", "desktopWatcherEvents:insert", {
          clientId: context.clientId,
          userName: context.userName || undefined,
          projectId: context.projectId,
          events: events.map(durableEvent),
        });
      } catch (error) {
        if (!legacyPresenceFallback) throw error;
        onLog?.("watcher: durable events unavailable, using legacy presence");
        await convexCall("mutation", "desktopPresence:publishWatcherEvents", {
          clientId: context.clientId,
          userName: context.userName || undefined,
          projectId: context.projectId,
          teamId: context.teamId || undefined,
          mountPath: context.mountPath,
          events,
        });
      }
    },
  });
}

const createConvexPresenceTransport = createConvexWatcherTransport;

module.exports = {
  BufferedWatcherTransport,
  createConvexPresenceTransport,
  createConvexWatcherTransport,
  durableEvent,
};
