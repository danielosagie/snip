# Snip Resolve panel

The Resolve panel is a DaVinci Resolve Studio Workflow Integration plugin. It reports the active timeline and playhead, shows teammates in the same Snip project, pushes debounced FCPXML snapshots when cuts change, and imports a chosen snapshot as a new timeline.

## Requirements

- DaVinci Resolve Studio 18.1 or newer on macOS or Windows
- Bun 1.3 or newer for local builds
- A Snip team plugin token
- The Snip project ID to connect
- A deployed Convex HTTP URL such as `https://example.convex.site`

Resolve Studio installs its platform-specific `WorkflowIntegration.node` bridge with the developer examples. The bridge is copied into the installed plugin by the local installer and is not committed to this repository.

## Local development

From `panels/resolve`:

```sh
bun run test
bun run typecheck
bun run lint
bun run build
```

Preview the renderer in a regular browser with sample data:

```sh
bun run start
```

The preview runs at `http://localhost:4173`. It does not load the Resolve native bridge.

## Install in Resolve

1. Quit Resolve.
2. Run `bun run install:local` from `panels/resolve`.
3. If the installer reports a permission error, grant your terminal access to the Resolve system plugin folder and run it again.
4. Start Resolve Studio.
5. Open `Workspace > Workflow Integrations > Snip Resolve`.
6. Enter the server URL, Snip project ID, your display name, team plugin token, and push branch.
7. Select `Save`.

The installer copies the built plugin to:

- macOS: `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.snip.resolve.panel`
- Windows: `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.snip.resolve.panel`

The token is stored in the current user's Snip application-support directory. The directory and file are created with user-only permissions where the operating system supports POSIX modes. The renderer receives only a masked token hint. Plain HTTP is rejected except on localhost.

## Runtime behavior

- Presence polls every 1.5 seconds and uses the active Resolve timeline timecode.
- Edit signatures poll every 2 seconds. A poll is skipped if the previous one is still running.
- Changed cuts are pushed after 3 seconds of idle time, with a 12 second maximum wait during continuous editing.
- Resolve API calls time out after 2 seconds.
- FCPXML export runs only for a pending push or `Push Now`.
- `Pull Copy` calls `ImportTimelineFromFile` with a unique name. It never writes into the active timeline.

## Plugin HTTP contract

All routes use `Authorization: Bearer <pluginToken>`. The server verifies that the requested project belongs to the token's team.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/timelines/snapshot` | Existing route. Push FCPXML plus domain summaries. |
| `POST` | `/timelines/presence` | Resolve project and branch to a timeline doc, heartbeat, and return teammates. |
| `GET` | `/timelines/snapshots?projectId=...` | List pull choices without full payloads. |
| `GET` | `/timelines/snapshot?projectId=...&snapshotId=...` | Fetch one FCPXML snapshot for import. |

The presence request embeds Agent A's `TimelinePresencePayload` unchanged under `payload`. The envelope adds the branch, display name, NLE surface, Resolve project ID, Resolve timeline ID, and session ID needed by the panel transport. The HTTP adapter resolves the project and branch to `timelineDocId` and joins Agent C's canonical `timeline-doc:<timelineDocId>` room, so browser and NLE cursors share one channel.

The current branch contains the timeline document schema, TypeScript contracts, and browser presence channel, but it does not contain `convex/timelineDocs.ts` or `src/lib/timeline/otio.ts`. Agent A must connect successful FCPXML snapshot ingest to the OTIO import hub and timeline document upsert. The panel already sends the required FCPXML on every live push. Presence returns `409` until that branch has a timeline document.

## Troubleshooting

- `Resolve bridge could not initialize`: confirm the plugin ID in `manifest.xml` is `com.snip.resolve.panel` and reinstall the native bridge from the same Resolve version.
- `Open a Resolve project`: open a project and timeline, then leave the panel running.
- `Offline`: verify the Convex HTTP URL, project ID, token, and team membership.
- `Snapshot has no FCPXML`: choose a Resolve snapshot that contains the original FCPXML payload.
