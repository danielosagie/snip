import type { SnipResolveBridge } from "./model";

declare global {
  interface Window {
    snipResolve?: SnipResolveBridge;
  }
}

export {};
