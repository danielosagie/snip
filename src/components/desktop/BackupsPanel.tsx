import { useQuery } from "convex/react";
import { HardDrive, Folder, Play, Square, Trash2, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type {
  DesktopBackupRun,
  DesktopBackupSource,
  DesktopBackupState,
} from "@/desktop";
import {
  softButton,
  softButtonDanger,
  softButtonPrimary,
  softCard,
  softFieldLabel,
  softHelperText,
  softInput,
} from "@/components/soft";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "@/lib/useIsDesktop";

/**
 * Auto-backup control panel. Desktop only — the engine, the drive detection
 * and the manifests all live in the Electron main process; in a browser
 * window.api is absent and this renders nothing.
 *
 * The panel is deliberately thin: it picks a destination and shows what the
 * native side is doing. Every decision about WHAT to upload is made there.
 */
export function BackupsPanel() {
  const isDesktop = useIsDesktop();
  const teams = useQuery(api.teams.listWithProjects, {});
  const [state, setState] = useState<DesktopBackupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasBackupBridge, setHasBackupBridge] = useState(true);

  useEffect(() => {
    if (!isDesktop) return;
    if (!window.api?.backup) {
      setHasBackupBridge(false);
      return;
    }
    void window.api.backup.state().then(setState).catch(() => {});
    void window.api.backup.volumes().catch(() => {});
    return window.api.backup.onState(setState);
  }, [isDesktop]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        // Handlers that mutate return the fresh snapshot; the rest just ack,
        // so re-read rather than leave the panel showing stale counts.
        const result = (await fn()) as { state?: DesktopBackupState } | undefined;
        if (result?.state) setState(result.state);
        else if (window.api?.backup) setState(await window.api.backup.state());
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const destinations = useMemo(() => {
    if (!teams) return [];
    return teams.flatMap((team) =>
      (team.projects ?? []).map((project) => ({
        key: `${team.slug}/${project.name}`,
        teamSlug: team.slug,
        teamName: team.name,
        projectName: project.name,
      })),
    );
  }, [teams]);

  const [destinationKey, setDestinationKey] = useState("");
  useEffect(() => {
    if (!destinationKey && destinations.length > 0) {
      setDestinationKey(destinations[0].key);
    }
  }, [destinationKey, destinations]);

  const destination = useMemo(() => {
    const picked = destinations.find((d) => d.key === destinationKey);
    if (!picked) return null;
    return {
      teamSlug: picked.teamSlug,
      projectName: picked.projectName,
      folderPath: [] as string[],
    };
  }, [destinationKey, destinations]);

  if (!isDesktop) return null;

  // The web app deploys independently of the desktop app, so a shell older
  // than this feature reaches here with no backup bridge. Say which side is
  // behind instead of rendering buttons that throw on click.
  if (!hasBackupBridge) {
    return (
      <section className={cn(softCard, "mb-3.5")}>
        <h2 className="text-base font-semibold leading-[22px]">Backups</h2>
        <p className={cn(softHelperText, "mt-1.5 max-w-[62ch]")}>
          This version of the desktop app can't run backups yet. Install the
          latest one from Settings, Integrations, then reopen this tab.
        </p>
      </section>
    );
  }

  const sources = state?.sources ?? [];
  const runsById = new Map((state?.runs ?? []).map((run) => [run.sourceId, run]));
  const unbackedVolumes = (state?.volumes ?? []).filter(
    (volume) => !sources.some((source) => source.path === volume.path),
  );

  return (
    <section className={cn(softCard, "mb-3.5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold leading-[22px]">Backups</h2>
          <p className={cn(softHelperText, "mt-1")}>
            Folders and drives, copied into a project.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-[#131315]">
          <input
            type="checkbox"
            checked={state?.enabled ?? false}
            disabled={busy}
            onChange={(e) =>
              void act(() => window.api!.backup.setOptions({ enabled: e.target.checked }))
            }
            className="h-4 w-4 accent-[#FF6600]"
          />
          On
        </label>
      </div>

      {state?.pendingDrive ? (
        <div className="mt-4 rounded-[12px] border border-[#FFD9BF] bg-[#FFF7F2] px-4 py-3.5">
          <div className="text-sm font-medium text-[#131315]">
            {state.pendingDrive.name} is connected
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !destination}
              className={softButtonPrimary}
              onClick={() =>
                void act(() =>
                  window.api!.backup.addVolume({
                    volumePath: state.pendingDrive!.path,
                    destination: destination!,
                  }),
                )
              }
            >
              Back up this drive
            </button>
            <button
              type="button"
              disabled={busy}
              className={softButton}
              onClick={() =>
                void act(() =>
                  window.api!.backup.dismissDrive({ name: state.pendingDrive!.name }),
                )
              }
            >
              Not this one
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label className={softFieldLabel} htmlFor="backup-destination">
            Copy into
          </label>
          <select
            id="backup-destination"
            value={destinationKey}
            onChange={(e) => setDestinationKey(e.target.value)}
            className={cn(softInput, "h-9 w-full px-3")}
          >
            {destinations.length === 0 ? (
              <option value="">No projects yet</option>
            ) : null}
            {destinations.map((d) => (
              <option key={d.key} value={d.key}>
                {d.teamName} / {d.projectName}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={busy || !destination}
          className={cn(softButton, "inline-flex items-center gap-2")}
          onClick={() => void act(() => window.api!.backup.addFolder({ destination: destination! }))}
        >
          <Plus className="h-3.5 w-3.5" />
          Add folder
        </button>
      </div>

      {teams !== undefined && destinations.length === 0 ? (
        <p className={cn(softHelperText, "mt-2")}>
          Create a project first.
        </p>
      ) : null}

      {unbackedVolumes.length > 0 && destination ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={softHelperText}>Connected drives</span>
          {unbackedVolumes.map((volume) => (
            <button
              key={volume.path}
              type="button"
              disabled={busy}
              className={cn(softButton, "inline-flex items-center gap-2")}
              onClick={() =>
                void act(() =>
                  window.api!.backup.addVolume({
                    volumePath: volume.path,
                    destination,
                  }),
                )
              }
            >
              <HardDrive className="h-3.5 w-3.5" />
              {volume.name}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-[13px] leading-[18px] text-[#D8434F]">{error}</p>
      ) : null}

      <div className="mt-4 space-y-2">
        {sources.length === 0 ? (
          <p className={softHelperText}>
            Nothing backed up yet.
          </p>
        ) : (
          sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              run={runsById.get(source.id) ?? null}
              busy={busy}
              onRun={() => void act(() => window.api!.backup.run({ id: source.id }))}
              onCancel={() => void act(() => window.api!.backup.cancel({ id: source.id }))}
              onToggle={(enabled) =>
                void act(() =>
                  window.api!.backup.updateSource({ id: source.id, patch: { enabled } }),
                )
              }
              onRemove={() =>
                void act(() => window.api!.backup.removeSource({ id: source.id }))
              }
            />
          ))
        )}
      </div>
    </section>
  );
}

function SourceRow({
  source,
  run,
  busy,
  onRun,
  onCancel,
  onToggle,
  onRemove,
}: {
  source: DesktopBackupSource;
  run: DesktopBackupRun | null;
  busy: boolean;
  onRun: () => void;
  onCancel: () => void;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  const running = run?.state === "scanning" || run?.state === "uploading";
  const Icon = source.kind === "volume" ? HardDrive : Folder;
  const percent =
    run && run.bytesTotal > 0
      ? Math.min(100, Math.round((run.bytesDone / run.bytesTotal) * 100))
      : 0;

  return (
    <div className="rounded-[12px] border border-[#F1F1F3] px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <ProgressRing percent={percent} indeterminate={run?.state === "scanning"} />
        ) : (
          <Icon className="h-4 w-4 shrink-0 text-[#6E6E73]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-5 text-[#131315]">
            {source.label}
          </div>
          <div className={cn(softHelperText, "truncate")}>
            {source.path} to {source.destination.teamSlug} / {source.destination.projectName}
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-[13px] text-[#6E6E73]">
          <input
            type="checkbox"
            checked={source.enabled !== false}
            disabled={busy}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-4 w-4 accent-[#FF6600]"
          />
          On
        </label>
        <button
          type="button"
          disabled={busy}
          className={cn(softButton, "inline-flex items-center gap-1.5")}
          onClick={running ? onCancel : onRun}
        >
          {running ? (
            <>
              <Square className="h-3 w-3" />
              Stop
            </>
          ) : (
            <>
              <Play className="h-3 w-3" />
              Run
            </>
          )}
        </button>
        <button
          type="button"
          disabled={busy}
          className={cn(softButtonDanger, "inline-flex items-center gap-1.5")}
          onClick={onRemove}
        >
          <Trash2 className="h-3 w-3" />
          Remove
        </button>
      </div>

      <RunStatus run={run} />
    </div>
  );
}

function RunStatus({ run }: { run: DesktopBackupRun | null }) {
  if (!run || run.state === "idle") return null;

  if (run.state === "scanning") {
    return <p className={cn(softHelperText, "mt-1.5")}>Looking for changes</p>;
  }

  if (run.state === "uploading") {
    return (
      <p className={cn(softHelperText, "mt-1.5 truncate")}>
        {run.filesDone} of {run.filesTotal} files · {formatBytes(run.bytesDone)} of{" "}
        {formatBytes(run.bytesTotal)}
        {run.currentFile ? ` · ${run.currentFile}` : ""}
      </p>
    );
  }

  if (run.state === "error") {
    return (
      <p className="mt-2 text-[13px] leading-[18px] text-[#D8434F]">
        {run.error ?? "Backup failed."}
      </p>
    );
  }

  if (run.state === "cancelled") {
    return <p className={cn(softHelperText, "mt-2")}>Stopped.</p>;
  }

  return (
    <p className={cn(softHelperText, "mt-2")}>
      Up to date. {run.filesDone > 0 ? `${run.filesDone} uploaded, ` : ""}
      {run.filesSkipped} already there
    </p>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/**
 * Progress on the folder icon rather than a bar under the row. A bar changed
 * the row's height the moment a source started, which made a list of sources
 * twitch every time one kicked off; the ring occupies the icon slot that was
 * already reserved.
 */
function ProgressRing({
  percent,
  indeterminate,
}: {
  percent: number;
  indeterminate?: boolean;
}) {
  const circumference = 2 * Math.PI * 10;
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-5 w-5 shrink-0", indeterminate && "animate-spin motion-reduce:animate-none")}
      role="img"
      aria-label={indeterminate ? "Scanning" : `${percent}% uploaded`}
    >
      <circle cx="12" cy="12" r="10" fill="none" stroke="#F1F1F3" strokeWidth="2.4" />
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke="#FF6600"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={
          indeterminate ? circumference * 0.75 : circumference * (1 - percent / 100)
        }
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}
