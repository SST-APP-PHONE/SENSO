import { describe, expect, it, vi } from "vitest";
import { trackLocation, type LocationState } from "../../src/gps/geolocation";

type Success = (p: GeolocationPosition) => void;
type Failure = (e: GeolocationPositionError) => void;

/** Geolocalización simulada controlable. */
function fakeGeo() {
  let success: Success = () => undefined;
  let failure: Failure = () => undefined;
  const geo = {
    watchPosition: vi.fn((s: Success, f: Failure) => {
      success = s;
      failure = f;
      return 1;
    }),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  } as unknown as Geolocation & { clearWatch: ReturnType<typeof vi.fn> };
  return {
    geo,
    fix: (lat: number, lng: number, accuracy: number) =>
      success({ coords: { latitude: lat, longitude: lng, accuracy } as GeolocationCoordinates, timestamp: Date.now() } as GeolocationPosition),
    fail: (code: 1 | 2 | 3) => failure({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: "" } as GeolocationPositionError),
  };
}

describe("GPS", () => {
  it("GPS disponible: lectura precisa → ready", () => {
    const g = fakeGeo();
    const states: LocationState[] = [];
    trackLocation((s) => states.push(s), { geolocation: g.geo });
    g.fix(23.06051234, -109.69771234, 8);
    const last = states.at(-1)!;
    expect(last.phase).toBe("ready");
    if (last.phase === "ready") {
      expect(last.location).toMatchObject({ latitude: 23.060512, longitude: -109.697712, accuracy: 8 });
      expect(last.lowAccuracy).toBe(false);
    }
    expect(g.geo.clearWatch).toHaveBeenCalled();
  });

  it("GPS no disponible / permiso denegado / sin soporte → error claro", () => {
    for (const [code, expected] of [
      [2, "unavailable"],
      [1, "denied"],
      [3, "timeout"],
    ] as const) {
      const g = fakeGeo();
      const states: LocationState[] = [];
      trackLocation((s) => states.push(s), { geolocation: g.geo });
      g.fail(code);
      expect(states.at(-1)).toEqual({ phase: "error", error: expected });
    }
    const states: LocationState[] = [];
    trackLocation((s) => states.push(s), { geolocation: undefined });
    expect(states.at(-1)).toEqual({ phase: "error", error: "unsupported" });
  });

  it("GPS con baja precisión: conserva la mejor lectura y la marca como aproximada", () => {
    vi.useFakeTimers();
    const g = fakeGeo();
    const states: LocationState[] = [];
    trackLocation((s) => states.push(s), { geolocation: g.geo, timeoutMs: 10_000 });
    g.fix(19.4, -99.1, 1500);
    g.fix(19.41, -99.11, 600);
    g.fix(19.5, -99.2, 2000); // peor: se ignora
    expect(states.at(-1)).toMatchObject({ phase: "locating", best: { accuracy: 600 } });
    vi.advanceTimersByTime(11_000);
    expect(states.at(-1)).toMatchObject({ phase: "ready", lowAccuracy: true, location: { latitude: 19.41, accuracy: 600 } });
    vi.useRealTimers();
  });

  it("si falla después de una lectura, se conserva la lectura obtenida", () => {
    const g = fakeGeo();
    const states: LocationState[] = [];
    trackLocation((s) => states.push(s), { geolocation: g.geo });
    g.fix(19.4, -99.1, 250);
    g.fail(2);
    expect(states.at(-1)).toMatchObject({ phase: "ready", lowAccuracy: true });
  });

  it("GPS recuperado después: un reintento tras el error obtiene ubicación", () => {
    const g = fakeGeo();
    const states: LocationState[] = [];
    trackLocation((s) => states.push(s), { geolocation: g.geo });
    g.fail(2);
    expect(states.at(-1)?.phase).toBe("error");
    trackLocation((s) => states.push(s), { geolocation: g.geo }); // botón "Reintentar ubicación"
    g.fix(19.4, -99.1, 20);
    expect(states.at(-1)?.phase).toBe("ready");
  });

  it("sin ninguna lectura antes del tiempo límite → timeout", () => {
    vi.useFakeTimers();
    const g = fakeGeo();
    const states: LocationState[] = [];
    trackLocation((s) => states.push(s), { geolocation: g.geo, timeoutMs: 5_000 });
    vi.advanceTimersByTime(6_000);
    expect(states.at(-1)).toEqual({ phase: "error", error: "timeout" });
    vi.useRealTimers();
  });
});
