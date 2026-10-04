import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { STATUS_META, getCategory, statusLabel, type ReportStatus } from "../../shared/catalogs";
import { formatDateTime } from "../utils/format";

export interface MapPoint {
  id: number;
  folio: string;
  category: string;
  categoryGroup: string;
  status: ReportStatus;
  severity: "LOW" | "MEDIUM" | "HIGH";
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  createdAtClient: string;
}

export type MapMode = "heat" | "points";
export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// Estado: color + forma (relleno / anillo / hueco) para no depender solo del color.
const STATUS_STYLE: Record<ReportStatus, L.CircleMarkerOptions> = {
  UNAVAILABLE: { radius: 8, color: "#ffffff", weight: 2, fillColor: "#d92d20", fillOpacity: 1 },
  INTERMITTENT: { radius: 7, color: "#c4560a", weight: 4, fillColor: "#ffffff", fillOpacity: 1 },
  AVAILABLE: { radius: 5, color: "#16a34a", weight: 3, fillColor: "#16a34a", fillOpacity: 0.15 },
};
const SEVERITY_WEIGHT = { LOW: 0.4, MEDIUM: 0.7, HIGH: 1 } as const;
/** Escala secuencial de "calor" (un solo sentido, claro → oscuro). */
export const HEAT_GRADIENT = { 0.2: "#fde68a", 0.45: "#f59e0b", 0.7: "#dc2626", 1: "#7f1d1d" };

let heatLoaded: Promise<unknown> | null = null;
function loadHeat() {
  // leaflet.heat extiende el objeto global L.
  (window as unknown as { L: typeof L }).L = L;
  heatLoaded ??= import("leaflet.heat");
  return heatLoaded;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function MonitorMap({ points, mode, onBoundsChange }: { points: MapPoint[]; mode: MapMode; onBoundsChange?: (b: Bounds) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.Layer | null>(null);
  const [tilesError, setTilesError] = useState(false);
  const boundsCb = useRef(onBoundsChange);
  useEffect(() => {
    boundsCb.current = onBoundsChange;
  }, [onBoundsChange]);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: [23.6, -102.5], zoom: 5, preferCanvas: true });
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
    tiles.on("tileerror", () => setTilesError(true));
    tiles.addTo(m);
    m.on("moveend", () => {
      const b = m.getBounds();
      boundsCb.current?.({ minLat: b.getSouth(), maxLat: b.getNorth(), minLng: b.getWest(), maxLng: b.getEast() });
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    let cancelled = false;
    (async () => {
      if (layer.current) {
        m.removeLayer(layer.current);
        layer.current = null;
      }
      const setRendered = (n: number) => el.current?.setAttribute("data-rendered", `${mode}:${n}`);
      if (!points.length) return setRendered(0);
      if (mode === "heat") {
        await loadHeat();
        if (cancelled) return;
        const heat = (L as unknown as { heatLayer: (p: [number, number, number][], o: object) => L.Layer }).heatLayer(
          points.map((p) => [p.latitude, p.longitude, SEVERITY_WEIGHT[p.severity] ?? 0.7]),
          { radius: 28, blur: 22, maxZoom: 14, minOpacity: 0.35, gradient: HEAT_GRADIENT },
        );
        layer.current = heat.addTo(m);
        setRendered(points.length);
      } else {
        const group = L.layerGroup();
        for (const p of points) {
          const cat = getCategory(p.category);
          L.circleMarker([p.latitude, p.longitude], STATUS_STYLE[p.status] ?? STATUS_STYLE.UNAVAILABLE)
            .bindPopup(
              `<strong>${escapeHtml(p.folio)}</strong><br>${escapeHtml(cat?.label ?? p.category)}<br>${STATUS_META[p.status]?.dot ?? ""} ${escapeHtml(
                statusLabel(p.status, cat?.group),
              )}<br>${escapeHtml(formatDateTime(p.createdAtClient))}`,
            )
            .addTo(group);
        }
        layer.current = group.addTo(m);
        setRendered(group.getLayers().length);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [points, mode]);

  // Encuadra los puntos cuando cambia el conjunto (no al cambiar de modo).
  useEffect(() => {
    const m = map.current;
    if (!m || !points.length) return;
    const b = L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number]));
    m.fitBounds(b.pad(0.2), { maxZoom: 15 });
  }, [points]);

  return (
    <div className="relative">
      <div ref={el} className="h-[420px] w-full rounded-xl md:h-[520px]" data-testid="monitor-map" data-points={points.length} />
      {tilesError && (
        <p className="absolute right-2 bottom-2 left-2 z-[500] rounded bg-white/90 p-2 text-xs">No se pudo cargar el mapa base (sin conexión a OpenStreetMap). Los reportes se muestran igualmente.</p>
      )}
    </div>
  );
}

export function MapLegend({ mode }: { mode: MapMode }) {
  if (mode === "heat") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Escala del mapa de calor">
        <span>Menor concentración</span>
        <span className="h-3 w-32 rounded" style={{ background: `linear-gradient(90deg, ${Object.values(HEAT_GRADIENT).join(",")})` }} />
        <span>Mayor concentración</span>
        <span className="opacity-70">(ponderado por nivel de afectación)</span>
      </div>
    );
  }
  const items: [ReportStatus, string][] = [
    ["UNAVAILABLE", "No disponible / activa"],
    ["INTERMITTENT", "Intermitente / parcial"],
    ["AVAILABLE", "Restablecido / resuelta"],
  ];
  return (
    <ul className="flex flex-wrap gap-4 text-xs">
      {items.map(([s, label]) => {
        const st = STATUS_STYLE[s];
        return (
          <li key={s} className="flex items-center gap-1.5">
            <svg width="18" height="18" aria-hidden="true">
              <circle cx="9" cy="9" r={st.radius! - 1} fill={st.fillColor} fillOpacity={st.fillOpacity} stroke={st.color === "#ffffff" ? st.fillColor : st.color} strokeWidth={st.weight! - 1} />
            </svg>
            {label}
          </li>
        );
      })}
    </ul>
  );
}
