"use strict";

/**
 * Buffered transport keeps Convex latency and outages away from the NLE save
 * path. Wave 2 can replace `send` with a versioning/ingest channel without
 * changing ProjectFileWatcher.
 */
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
      // Keep newest data and retry slowly. Duplicate event keys are idempotent
      // in desktopPresence, so an uncertain network response is safe to retry.
      this.buffer.unshift(...batch);
      if (this.buffer.length > this.maxBuffered) {
        this.buffer.splice(0, this.buffer.length - this.maxBuffered);
      }
      this.onLog(
        `watcher: presence publish failed: ${error instanceof Error ? error.message : String(error)}`,
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

function createConvexPresenceTransport({ convexCall, getContext, onLog }) {
  return new BufferedWatcherTransport({
    onLog,
    send: async (events) => {
      const context = await getContext();
      await convexCall("mutation", "desktopPresence:publishWatcherEvents", {
        clientId: context.clientId,
        userName: context.userName || undefined,
        projectId: context.projectId || undefined,
        teamId: context.teamId || undefined,
        mountPath: context.mountPath,
        events,
      });
    },
  });
}

module.exports = { BufferedWatcherTransport, createConvexPresenceTransport };
