"use strict";

/**
 * Detects external volumes being attached and detached.
 *
 * There is no cross-platform Electron/Node event for "a disk was plugged in",
 * so this polls the platform's mount directory. That is cheap: one readdir of
 * a directory that holds a handful of entries. Electron's `powerMonitor` and
 * the various USB libraries all either need a native module or only see the
 * bus, not the mounted filesystem — and the mounted filesystem is the thing a
 * backup actually needs.
 *
 * Identity: a volume is keyed by its mount path plus its name. macOS remounts
 * a given disk at /Volumes/<Name> every time, so the pair is stable across
 * unplug/replug, which is what auto-on-connect matching needs. A second disk
 * with the same name mounts as "<Name> 1" and is therefore a different key,
 * which is the correct outcome — it is a different disk.
 */

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");

/**
 * Poll cadence. A person plugging in a drive tolerates a couple of seconds
 * before the app reacts; a readdir every 4s is invisible on any machine. Not a
 * budget, a responsiveness choice — lower it freely.
 */
const DEFAULT_POLL_MS = 4000;

/**
 * Mount points that are the machine itself, not removable media. Backing up
 * the boot volume by accident would try to upload the whole OS.
 */
const MAC_EXCLUDED = new Set(["Macintosh HD", "com.apple.TimeMachine.localsnapshots"]);

/** Where each platform mounts removable media. */
function volumeRootsFor(platform, homedir) {
  if (platform === "darwin") return ["/Volumes"];
  if (platform === "linux") {
    const user = path.basename(homedir || "");
    return ["/media", user ? `/media/${user}` : null, user ? `/run/media/${user}` : null].filter(
      Boolean,
    );
  }
  return [];
}

/** Windows has no mount directory; probe drive letters instead. C: is the system disk. */
async function listWindowsVolumes({ access = fs.access } = {}) {
  const letters = "DEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const found = [];
  await Promise.all(
    letters.map(async (letter) => {
      const root = `${letter}:\\`;
      try {
        await access(root);
        found.push({ path: root, name: `${letter}:` });
      } catch {
        // Not mounted.
      }
    }),
  );
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

async function listVolumes({
  platform = process.platform,
  homedir = os.homedir(),
  readdir = fs.readdir,
  stat = fs.stat,
  access = fs.access,
} = {}) {
  if (platform === "win32") return listWindowsVolumes({ access });

  const roots = volumeRootsFor(platform, homedir);
  const out = [];
  const seen = new Set();
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith(".")) continue;
      if (platform === "darwin" && MAC_EXCLUDED.has(name)) continue;
      const full = path.join(root, name);
      if (seen.has(full)) continue;

      // On macOS the boot volume shows up in /Volumes as a symlink to /.
      // Skipping symlinks drops it without hardcoding its name.
      if (entry.isSymbolicLink?.()) continue;
      if (entry.isDirectory?.() === false) continue;
      if (entry.isDirectory === undefined) {
        const s = await stat(full).catch(() => null);
        if (!s?.isDirectory()) continue;
      }
      seen.add(full);
      out.push({ path: full, name });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * @param {object} options
 * @param {(volume: {path: string, name: string}) => void} options.onAttached
 * @param {(volume: {path: string, name: string}) => void} [options.onDetached]
 */
function createVolumeWatcher({
  onAttached,
  onDetached = () => {},
  pollMs = DEFAULT_POLL_MS,
  list = listVolumes,
  setTimer = setInterval,
  clearTimer = clearInterval,
  onLog = () => {},
} = {}) {
  let known = new Map();
  let timer = null;
  let primed = false;
  let polling = false;

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const current = await list();
      const next = new Map(current.map((v) => [v.path, v]));

      if (!primed) {
        // First poll establishes the baseline. Volumes already mounted when
        // the app launched were not "just plugged in" and must not trigger a
        // backup prompt on every start.
        known = next;
        primed = true;
        return;
      }

      for (const [key, volume] of next) {
        if (!known.has(key)) {
          onLog(`volumes: attached ${volume.name} at ${volume.path}`);
          onAttached(volume);
        }
      }
      for (const [key, volume] of known) {
        if (!next.has(key)) {
          onLog(`volumes: detached ${volume.name}`);
          onDetached(volume);
        }
      }
      known = next;
    } catch (error) {
      onLog(`volumes: poll failed: ${error.message}`);
    } finally {
      polling = false;
    }
  }

  return {
    async start() {
      if (timer) return;
      await poll(); // prime synchronously so start() implies a known baseline
      timer = setTimer(() => void poll(), pollMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearTimer(timer);
      timer = null;
      known = new Map();
      primed = false;
    },
    /** Current volumes as of the last poll. */
    list: () => [...known.values()],
    poll,
  };
}

module.exports = {
  DEFAULT_POLL_MS,
  createVolumeWatcher,
  listVolumes,
  listWindowsVolumes,
  volumeRootsFor,
};
