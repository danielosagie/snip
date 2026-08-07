import type {
  PanelConfigInput,
  PanelState,
  SnipResolveBridge,
  TeammatePresence,
  TimelineSnapshotSummary,
} from "./model";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found as T;
}

const statusLabel = element<HTMLSpanElement>("status-label");
const statusDot = element<HTMLSpanElement>("status-dot");
const timelineName = element<HTMLDivElement>("timeline-name");
const timecode = element<HTMLDivElement>("timecode");
const lastPush = element<HTMLSpanElement>("last-push");
const teamList = element<HTMLDivElement>("team-list");
const teamCount = element<HTMLSpanElement>("team-count");
const branchSelect = element<HTMLSelectElement>("branch-select");
const snapshotSelect = element<HTMLSelectElement>("snapshot-select");
const pullButton = element<HTMLButtonElement>("pull-button");
const pushButton = element<HTMLButtonElement>("push-button");
const refreshButton = element<HTMLButtonElement>("refresh-button");
const configButton = element<HTMLButtonElement>("config-button");
const settings = element<HTMLElement>("settings");
const settingsForm = element<HTMLFormElement>("settings-form");
const cancelButton = element<HTMLButtonElement>("cancel-button");
const errorBanner = element<HTMLDivElement>("error-banner");
const serverInput = element<HTMLInputElement>("server-input");
const projectInput = element<HTMLInputElement>("project-input");
const nameInput = element<HTMLInputElement>("name-input");
const tokenInput = element<HTMLInputElement>("token-input");
const pushBranchInput = element<HTMLInputElement>("push-branch-input");

let currentState: PanelState;
let selectedBranch = "";

function sampleState(): PanelState {
  const payload = {
    playheadPosition: { value: 2_184, rate: 24 },
    selectedClipIds: [],
    viewportRange: {
      start: { value: 0, rate: 24 },
      duration: { value: 8_640, rate: 24 },
    },
    softLocks: [],
  };
  return {
    status: "live",
    config: {
      serverUrl: "https://example.convex.site",
      projectId: "preview",
      displayName: "Morgan",
      branch: "main",
      configured: true,
      tokenHint: "••••demo",
    },
    timelineName: "Launch Film 04",
    timecode: "01:01:31:00",
    playhead: payload.playheadPosition,
    lastPushAt: Date.now() - 18_000,
    teammates: [
      {
        id: "avery",
        displayName: "Avery",
        surface: "browser",
        timelineName: "Launch Film 04",
        payload,
        updatedAt: Date.now(),
      },
      {
        id: "priya",
        displayName: "Priya",
        surface: "premiere",
        timelineName: "Social Cut",
        payload: { ...payload, playheadPosition: { value: 912, rate: 24 } },
        updatedAt: Date.now(),
      },
    ],
    snapshots: [
      {
        id: "snapshot-preview",
        branch: "main",
        message: "Editor pass",
        createdAt: Date.now() - 65_000,
        createdByName: "Avery",
        source: "resolve",
      },
    ],
    pushing: false,
    pulling: false,
  };
}

function previewBridge(): SnipResolveBridge {
  let state = sampleState();
  const listeners = new Set<(next: PanelState) => void>();
  const emit = () => listeners.forEach((listener) => listener(state));
  return {
    getState: async () => state,
    onState(listener) {
      listeners.add(listener);
      listener(state);
    },
    async saveConfig(input) {
      state = {
        ...state,
        config: {
          serverUrl: input.serverUrl,
          projectId: input.projectId,
          displayName: input.displayName,
          branch: input.branch,
          configured: true,
          tokenHint: "••••demo",
        },
      };
      emit();
      return state;
    },
    async refreshSnapshots() {
      emit();
      return state;
    },
    async pullSnapshot() {
      state = { ...state, timelineName: "Snip Editor pass preview" };
      emit();
      return state;
    },
    async pushNow() {
      state = { ...state, lastPushAt: Date.now() };
      emit();
      return state;
    },
  };
}

const bridge = window.snipResolve ?? previewBridge();

function statusText(status: PanelState["status"]): string {
  return {
    connecting: "Connecting",
    live: "Live",
    offline: "Offline",
    setup: "Needs setup",
    unavailable: "No timeline",
  }[status];
}

function formatFrameTime(value: number, rate: number): string {
  const frameRate = Math.max(1, Math.round(rate));
  const frames = Math.max(0, Math.round(value));
  const hours = Math.floor(frames / (frameRate * 3_600));
  const minutes = Math.floor(frames / (frameRate * 60)) % 60;
  const seconds = Math.floor(frames / frameRate) % 60;
  const remainder = frames % frameRate;
  return [hours, minutes, seconds, remainder].map((part) => String(part).padStart(2, "0")).join(":");
}

function relativeTime(timestamp?: number): string {
  if (!timestamp) return "Not yet";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function teammateRow(teammate: TeammatePresence): HTMLElement {
  const row = document.createElement("div");
  row.className = "teammate-row";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = teammate.displayName.trim().slice(0, 1).toUpperCase() || "?";

  const identity = document.createElement("div");
  identity.className = "teammate-identity";
  const name = document.createElement("strong");
  name.textContent = teammate.displayName;
  const surface = document.createElement("span");
  surface.textContent = `${teammate.surface} · ${teammate.timelineName || "Timeline"}`;
  identity.append(name, surface);

  const position = document.createElement("span");
  position.className = "teammate-time";
  position.textContent = formatFrameTime(
    teammate.payload.playheadPosition.value,
    teammate.payload.playheadPosition.rate,
  );
  row.append(avatar, identity, position);
  return row;
}

function fillSnapshots(snapshots: TimelineSnapshotSummary[]): void {
  const branches = [...new Set(snapshots.map((snapshot) => snapshot.branch))].sort();
  const priorBranch = selectedBranch || branchSelect.value;
  branchSelect.replaceChildren();
  for (const branch of branches) {
    const option = new Option(branch, branch);
    branchSelect.add(option);
  }
  selectedBranch = branches.includes(priorBranch) ? priorBranch : branches[0] || "";
  branchSelect.value = selectedBranch;

  const priorSnapshot = snapshotSelect.value;
  const filtered = snapshots
    .filter((snapshot) => snapshot.branch === selectedBranch)
    .sort((left, right) => right.createdAt - left.createdAt);
  snapshotSelect.replaceChildren();
  for (const snapshot of filtered) {
    const label = `${snapshot.message} · ${snapshot.createdByName}`;
    snapshotSelect.add(new Option(label, snapshot.id));
  }
  if (filtered.some((snapshot) => snapshot.id === priorSnapshot)) {
    snapshotSelect.value = priorSnapshot;
  }
  pullButton.disabled = filtered.length === 0 || currentState.pulling;
}

function render(state: PanelState): void {
  currentState = state;
  document.body.dataset.status = state.status;
  statusLabel.textContent = statusText(state.status);
  statusDot.className = `status-dot status-${state.status}`;
  timelineName.textContent = state.timelineName || "No timeline";
  timecode.textContent = state.timecode || "00:00:00:00";
  lastPush.textContent = relativeTime(state.lastPushAt);
  errorBanner.hidden = !state.error;
  errorBanner.textContent = state.error || "";

  teamList.replaceChildren();
  teamCount.textContent = String(state.teammates.length);
  if (state.teammates.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-row";
    empty.textContent = state.status === "live" ? "No teammates" : "Waiting for sync";
    teamList.append(empty);
  } else {
    state.teammates.forEach((teammate) => teamList.append(teammateRow(teammate)));
  }

  fillSnapshots(state.snapshots);
  pushButton.disabled = !state.config.configured || state.pushing;
  pushButton.textContent = state.pushing ? "Pushing" : "Push Now";
  pullButton.textContent = state.pulling ? "Pulling" : "Pull Copy";
  cancelButton.hidden = !state.config.configured;
  if (!state.config.configured) openSettings();
}

function openSettings(): void {
  serverInput.value = currentState?.config.serverUrl || "";
  projectInput.value = currentState?.config.projectId || "";
  nameInput.value = currentState?.config.displayName || "";
  pushBranchInput.value = currentState?.config.branch || "main";
  tokenInput.value = "";
  tokenInput.placeholder = currentState?.config.configured ? "Keep existing" : "snip_...";
  settings.hidden = false;
  serverInput.focus();
}

function closeSettings(): void {
  if (currentState.config.configured) settings.hidden = true;
}

async function runAction(action: () => Promise<PanelState>): Promise<void> {
  try {
    render(await action());
  } catch (error) {
    render({
      ...currentState,
      error: error instanceof Error ? error.message : "Action failed.",
    });
  }
}

branchSelect.addEventListener("change", () => {
  selectedBranch = branchSelect.value;
  fillSnapshots(currentState.snapshots);
});
refreshButton.addEventListener("click", () => void runAction(() => bridge.refreshSnapshots()));
pullButton.addEventListener("click", () => {
  if (snapshotSelect.value) void runAction(() => bridge.pullSnapshot(snapshotSelect.value));
});
pushButton.addEventListener("click", () => void runAction(() => bridge.pushNow()));
configButton.addEventListener("click", openSettings);
cancelButton.addEventListener("click", closeSettings);
settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const input: PanelConfigInput = {
    serverUrl: serverInput.value,
    projectId: projectInput.value,
    displayName: nameInput.value,
    pluginToken: tokenInput.value || undefined,
    branch: pushBranchInput.value,
  };
  void runAction(async () => {
    const next = await bridge.saveConfig(input);
    settings.hidden = true;
    return next;
  });
});

void bridge.getState().then(render);
bridge.onState(render);
setInterval(() => {
  if (currentState) lastPush.textContent = relativeTime(currentState.lastPushAt);
}, 1_000);
