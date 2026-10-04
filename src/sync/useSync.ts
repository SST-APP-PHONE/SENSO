import { useSyncExternalStore } from "react";
import { syncEngine } from "./engine";

export function useSyncState() {
  return useSyncExternalStore(syncEngine.subscribe, syncEngine.getState);
}
