import { LIMITS } from "../../shared/catalogs";
import type { GeoLocation } from "../../shared/schemas";

/**
 * Ubicación del dispositivo con navigator.geolocation.
 * No depende de internet: en teléfonos usa el receptor GPS. Nunca bloquea el
 * guardado del reporte; si falla, el reporte puede guardarse sin ubicación.
 */
export type LocationError = "unsupported" | "denied" | "unavailable" | "timeout";

export type LocationState =
  | { phase: "idle" }
  | { phase: "locating"; best: GeoLocation | null }
  | { phase: "ready"; location: GeoLocation; lowAccuracy: boolean }
  | { phase: "error"; error: LocationError };

export const LOCATION_ERROR_TEXT: Record<LocationError, string> = {
  unsupported: "Este dispositivo no permite obtener la ubicación.",
  denied: "Permiso de ubicación denegado. Puedes activarlo en la configuración del navegador.",
  unavailable: "La señal GPS no está disponible en este momento.",
  timeout: "La ubicación tardó demasiado en obtenerse.",
};

export const isLowAccuracy = (loc: GeoLocation) => loc.accuracy === null || loc.accuracy > LIMITS.lowAccuracyMeters;

function toLocation(pos: GeolocationPosition): GeoLocation {
  return {
    latitude: Number(pos.coords.latitude.toFixed(6)),
    longitude: Number(pos.coords.longitude.toFixed(6)),
    accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy * 10) / 10 : null,
    capturedAt: new Date(pos.timestamp || Date.now()).toISOString(),
  };
}

function toError(err: GeolocationPositionError): LocationError {
  if (err.code === err.PERMISSION_DENIED) return "denied";
  if (err.code === err.TIMEOUT) return "timeout";
  return "unavailable";
}

export interface TrackOptions {
  /** Tiempo máximo para conseguir una lectura (ms). */
  timeoutMs?: number;
  /** Precisión suficiente para detenerse antes (m). */
  goodEnoughMeters?: number;
  geolocation?: Geolocation | undefined;
}

/**
 * Sigue la ubicación hasta obtener una lectura suficientemente precisa o agotar
 * el tiempo, conservando siempre la mejor lectura obtenida.
 * Devuelve una función para cancelar.
 */
export function trackLocation(onState: (s: LocationState) => void, opts: TrackOptions = {}): () => void {
  const geo = "geolocation" in opts ? opts.geolocation : typeof navigator !== "undefined" ? navigator.geolocation : undefined;
  if (!geo) {
    onState({ phase: "error", error: "unsupported" });
    return () => undefined;
  }
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const goodEnough = opts.goodEnoughMeters ?? 30;
  let best: GeoLocation | null = null;
  let done = false;

  const finish = (state: LocationState) => {
    if (done) return;
    done = true;
    geo.clearWatch(watchId);
    clearTimeout(timer);
    onState(state);
  };

  onState({ phase: "locating", best: null });
  const watchId = geo.watchPosition(
    (pos) => {
      const loc = toLocation(pos);
      if (!best || (loc.accuracy ?? Infinity) <= (best.accuracy ?? Infinity)) best = loc;
      if ((best.accuracy ?? Infinity) <= goodEnough) finish({ phase: "ready", location: best, lowAccuracy: isLowAccuracy(best) });
      else if (!done) onState({ phase: "locating", best });
    },
    (err) => {
      // Si ya hay una lectura, se conserva aunque las siguientes fallen.
      if (best) finish({ phase: "ready", location: best, lowAccuracy: isLowAccuracy(best) });
      else finish({ phase: "error", error: toError(err) });
    },
    { enableHighAccuracy: true, maximumAge: 30_000, timeout: timeoutMs },
  );
  const timer = setTimeout(() => {
    if (best) finish({ phase: "ready", location: best, lowAccuracy: isLowAccuracy(best) });
    else finish({ phase: "error", error: "timeout" });
  }, timeoutMs + 500);

  return () => {
    done = true;
    geo.clearWatch(watchId);
    clearTimeout(timer);
  };
}
