import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { STATUS_META, getCategory, statusLabel, type ReportStatus } from "../../shared/catalogs";
import { formatDateTime } from "../utils/format";
import { HEAT_GRADIENT, HEAT_GRADIENT_CSS, STATUS_STYLE, escapeHtml, loadHeat } from "./MonitorMap";

/** Celda agregada por el servidor: centro de la celda y número de reportes. */
export interface HeatCellView {
  lat: number;
  lng: number;
  count: number;
}

export interface HeatPointView {
  id: number;
  folio: string;
  category: string;
  status: ReportStatus;
  latitude: number;
  longitude: number;
  createdAtClient: string;
}

/**
 * Mapa de calor del centro de monitoreo. La intensidad de cada celda es su número de reportes
 * relativo a la celda con más reportes. Los marcadores individuales son opcionales.
 */
export function HeatmapMap({ cells, points, cellSizeMeters }: { cells: HeatCellView[]; points?: HeatPointView[]; cellSizeMeters: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.Layer[]>([]);
  const [tilesError, setTilesError] = useState(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: [23.6, -102.5], zoom: 5, preferCanvas: true });
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
    tiles.on("tileerror", () => setTilesError(true));
    tiles.addTo(m);
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
      layers.current.forEach((l) => m.removeLayer(l));
      layers.current = [];
      const setRendered = (heat: number, markers: number) => el.current?.setAttribute("data-rendered", `cells:${heat};points:${markers}`);
      if (!cells.length) return setRendered(0, 0);

      await loadHeat();
      if (cancelled) return;
      const max = Math.max(...cells.map((c) => c.count));
      const heat = (L as unknown as { heatLayer: (p: [number, number, number][], o: object) => L.Layer }).heatLayer(
        cells.map((c) => [c.lat, c.lng, c.count / max]),
        // maxZoom: 0 desactiva la atenuación por zoom de leaflet.heat: los conteos ya vienen agregados
        // por el servidor, así que la intensidad debe ser la misma a cualquier nivel de zoom.
        { radius: 26, blur: 20, maxZoom: 0, minOpacity: 0.35, max: 1, gradient: HEAT_GRADIENT },
      );
      layers.current.push(heat.addTo(m));

      let markers = 0;
      if (points?.length) {
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
        layers.current.push(group.addTo(m));
        markers = group.getLayers().length;
      }
      setRendered(cells.length, markers);

      // Ajuste automático a las zonas con incidencias (los bordes de las celdas, no solo sus centros).
      const half = cellSizeMeters / 111_320 / 2;
      const b = L.latLngBounds(cells.map((c) => [c.lat - half, c.lng - half] as [number, number]));
      cells.forEach((c) => b.extend([c.lat + half, c.lng + half]));
      m.fitBounds(b.pad(0.15), { maxZoom: 15 });
    })();
    return () => {
      cancelled = true;
    };
  }, [cells, points, cellSizeMeters]);

  return (
    <div className="relative">
      <div ref={el} className="h-[360px] w-full rounded-xl sm:h-[440px] lg:h-[560px]" data-testid="heatmap-map" data-cells={cells.length} />
      {tilesError && (
        <p className="absolute right-2 bottom-2 left-2 z-[500] rounded bg-white/90 p-2 text-xs">
          No se pudo cargar el mapa base (sin conexión a OpenStreetMap). Las concentraciones se muestran igualmente.
        </p>
      )}
    </div>
  );
}

/** Leyenda de intensidad: escala secuencial relativa a la celda con más reportes. */
export function HeatLegend({ maxCount, cellSizeMeters }: { maxCount: number; cellSizeMeters: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-label="Escala del mapa de calor" data-testid="heat-legend">
      <span>1 reporte</span>
      <span className="h-3 w-32 rounded" style={{ background: `linear-gradient(90deg, ${HEAT_GRADIENT_CSS})` }} />
      <span>
        {maxCount} {maxCount === 1 ? "reporte" : "reportes"} (máximo por zona)
      </span>
      <span className="opacity-70">Zonas de ~{cellSizeMeters >= 1000 ? `${(cellSizeMeters / 1000).toFixed(1)} km` : `${cellSizeMeters} m`} de lado</span>
    </div>
  );
}
