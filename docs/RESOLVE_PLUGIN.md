# Resolve integration

> **Heads up:** the standalone Resolve plugin from earlier builds is gone.
> The snip desktop app now talks to Resolve directly via the scripting
> API. Everything — save / open / compare — happens from the desktop app.
> No second install dance, no plugin folder, no `~/.snip/config.json`.

## Prerequisites (one-time, ~3 minutes)

1. **DaVinci Resolve Studio** — the free version blocks external scripting.
2. **Enable external scripting** in Resolve:
   - Preferences → **System** → **General**
   - Set **External scripting using** to `Local`
   - Restart Resolve.
3. **Python 3** — macOS already has `/usr/bin/python3`. If not, install
   via `xcode-select --install`. The desktop app looks for python3 in:
   - `$SNIP_PYTHON` env var
   - `/usr/bin/python3`
   - `/usr/local/bin/python3`
   - `/opt/homebrew/bin/python3`
   - `python3` on `$PATH`

That's it. No Resolve plugin to install.

## How to use

Open the snip desktop app, sign in, open a project. You'll see a
**Resolve history** section under the version folders. Three things to
know:

### "Save current Resolve timeline"

The button at the top of the section. With a timeline open in Resolve,
type what changed (`tightened cold open by 4s`) and hit save. The
desktop app:

1. Tells Resolve to export the current timeline as FCPXML 1.10.
2. Parses it into six domain views (cuts / color / audio / effects /
   markers / metadata).
3. Uploads to snip as a new save on the current thread.

Saves are immutable. To "fix" one, save again — like git commits.

### "Open in Resolve"

Per-row button on every save (except manual milestones — those have no
Resolve data attached). Click it and Resolve imports that snapshot's
FCPXML as a brand-new timeline next to your existing ones. Your current
work is untouched.

### Threads

What other tools call "branches." Each thread is an independent line of
saves. An editor working on `editor_dan` doesn't fight a colorist on
`color_jane`. Pick the thread you're saving into from the picker; type
a name and click **Start** to begin a new thread. The next save lands
there.

### "Compare"

Click **Compare** on any two saves to see a What-Changed summary:
clips added / removed, color corrections, audio adjustments, effects,
markers. No JSON to read.

## Connection status

The "Resolve history" header shows the live status of your Resolve:

| Badge | Meaning | Fix |
|---|---|---|
| `CONNECTED` | Resolve is open, snip can talk to it | — |
| `NOT_RUNNING` | Resolve isn't open | Open Resolve, click **Refresh** |
| `SCRIPTING_OFF` | Resolve is open but scripting is disabled | Preferences → System → General → External scripting = Local |
| `API_UNAVAILABLE` | The scripting Python module isn't installed | Install Resolve Studio (free version blocks this) |
| `NO_PROJECT` / `NO_TIMELINE` | Resolve is open but no project / timeline | Open a project + timeline first |

## What's not there yet

- **AI-assisted merge**: when two threads diverge and need combining,
  there's no UI for resolving cross-domain conflicts yet (e.g. clip
  deleted in `editor_dan`'s cuts but still referenced in
  `color_jane`'s color corrections). Manual merge for now.
- **In-app per-clip diff**: the Compare view shows aggregate deltas. A
  per-clip side-by-side timeline diff is the next iteration.
- **Premiere**: same architecture works, but Premiere's API surface is
  different. Tracked.

## How the desktop ↔ Resolve bridge works

For the curious. The desktop app ships a single Python script
(`desktop/resources/resolve_bridge.py`) and spawns it as a child process
whenever it needs to talk to Resolve. The script imports Blackmagic's
`DaVinciResolveScript` module, finds the running Resolve via the
external scripting socket, exports / imports FCPXML, and prints one
JSON document on stdout. Electron reads that JSON, FCPXML lands in a
temp file, the FCPXML parser in the Electron main process splits into
domain JSONs, and we POST the lot to Convex through a regular
Clerk-authed mutation.

No plugin = one install, one auth flow, one place to fix bugs.
