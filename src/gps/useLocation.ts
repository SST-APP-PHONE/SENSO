import { useCallback, useEffect, useRef, useState } from "react";
import { trackLocation, type LocationState } from "./geolocation";

/** Hook: inicia la búsqueda de ubicación al montar y permite reintentar. */
export function useLocation(enabled: boolean, timeoutMs = 20_000) {
  const [state, setState] = useState<LocationState>({ phase: "idle" });
  const cancel = useRef<() => void>(() => undefined);

  const start = useCallback(() => {
    cancel.current();
    cancel.current = trackLocation(setState, { timeoutMs });
  }, [timeoutMs]);

  useEffect(() => {
    if (!enabled) return;
    start();
    return () => cancel.current();
  }, [enabled, start]);

  return { state, retry: start };
}
