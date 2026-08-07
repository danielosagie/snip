# Snip Premiere scaffold

Wave 2 ships Resolve first. This directory reserves both Premiere extension surfaces without implementing feature code.

## Preferred surface: UXP

`uxp/` targets Premiere Pro 25.6 or newer with a manifest v5 panel. UXP is the primary implementation path because Premiere DOM calls are asynchronous and do not block the editor UI.

The Wave 3 mapping is:

| Snip capability | Premiere UXP surface |
| --- | --- |
| Presence out | `Project.getActiveProject()`, `project.getActiveSequence()`, the sequence GUID, sequence playhead APIs, and `EventManager` sequence or track events with a low-frequency fallback poll. |
| Presence in | UXP network requests to the same token-authenticated timeline presence route, rendered in the persistent panel. |
| Sequence export | Feature-detect `ProjectConverter.exportAsOpenTimelineIO()` or `exportAsFinalCutProXML()` on Premiere 26.2 or newer, then send OTIO or XML to the hub. Older supported UXP builds need the CEP fallback until the converter APIs are available. |
| Pull copy | Download a chosen hub snapshot, import it as a new project sequence, and never mutate the active sequence. |

Before packaging, replace the placeholder Convex domain in `uxp/manifest.json` with the production deployment domain. Do not use unrestricted network permissions.

## Compatibility surface: CEP

`cep/` reserves a CEP 11 panel for Premiere versions that do not expose the needed UXP conversion APIs. The host-side ExtendScript bridge will map:

| Snip capability | Premiere CEP surface |
| --- | --- |
| Presence out | `app.project.activeSequence`, sequence ID, and CTI polling through `CSInterface.evalScript`. Keep calls small because ExtendScript is synchronous. |
| Presence in | Browser-side HTTPS from the CEP panel with the plugin token kept outside the DOM. |
| Sequence export | `activeSequence.exportAsFinalCutProXML()` to a temporary file, followed by upload to the hub. |
| Pull copy | Import XML as a new sequence through the project API. Never merge it into the active sequence. |

No Premiere protocol or host code is included in this wave. The shell exists so the next implementation can share the Resolve wire contract without changing package layout.
