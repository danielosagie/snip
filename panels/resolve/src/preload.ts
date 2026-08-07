import { contextBridge } from "electron";
import { join } from "node:path";
import type { PanelState, SnipResolveBridge } from "./model";
import { publicConfig } from "./config-store";
import { ResolvePanelController } from "./controller";
import { ResolveAdapter } from "./resolve-adapter";
import type { ResolveWorkflowIntegration } from "./resolve-api";

declare const require: NodeRequire;

const PLUGIN_ID = "com.snip.resolve.panel";

function unavailableState(error: unknown): PanelState {
  return {
    status: "unavailable",
    config: publicConfig(),
    teammates: [],
    snapshots: [],
    pushing: false,
    pulling: false,
    error: error instanceof Error ? error.message : "Resolve bridge unavailable.",
  };
}

function exposeUnavailable(error: unknown): void {
  const state = unavailableState(error);
  const fail = async () => {
    throw new Error(state.error);
  };
  const bridge: SnipResolveBridge = {
    getState: async () => state,
    onState: (listener) => listener(state),
    saveConfig: fail,
    refreshSnapshots: fail,
    pullSnapshot: fail,
    pushNow: fail,
  };
  contextBridge.exposeInMainWorld("snipResolve", bridge);
}

try {
  const integrationPath = join(__dirname, "WorkflowIntegration.node");
  const integration = require(integrationPath) as ResolveWorkflowIntegration;
  if (!integration.Initialize(PLUGIN_ID)) {
    throw new Error("Resolve bridge could not initialize.");
  }
  integration.SetAPITimeout?.(2);
  const resolve = integration.GetResolve();
  if (!resolve) throw new Error("Resolve is unavailable.");

  const controller = new ResolvePanelController(new ResolveAdapter(resolve));
  const ready = controller.initialize();
  const bridge: SnipResolveBridge = {
    getState: async () => {
      await ready;
      return controller.getState();
    },
    onState: (listener) => {
      void ready.then(() => controller.subscribe(listener));
    },
    saveConfig: async (input) => {
      await ready;
      return controller.saveConfig(input);
    },
    refreshSnapshots: async () => {
      await ready;
      return controller.refreshSnapshots();
    },
    pullSnapshot: async (snapshotId) => {
      await ready;
      return controller.pullSnapshot(snapshotId);
    },
    pushNow: async () => {
      await ready;
      return controller.pushNow();
    },
  };
  contextBridge.exposeInMainWorld("snipResolve", bridge);
  window.addEventListener("beforeunload", () => {
    controller.stop();
    integration.CleanUp();
  });
} catch (error) {
  exposeUnavailable(error);
}
