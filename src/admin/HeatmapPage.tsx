import { useEffect, useMemo, useState } from "react";
import { STATUSES, STATUS_META, getCategory, type ReportStatus } from "../../shared/catalogs";
import { HttpError, adminApi } from "../api/client";
import { HeatLegend, HeatmapMap, type HeatCellView, type HeatPointView } from "../maps/HeatmapMap";
import { formatDateTime } from "../utils/format";
import { Filters, Kpi } from "./DashboardPage";
import { EMPTY_FILTERS, filtersToQuery, type AdminEvent, type AdminUser, type FilterState } from "./types";

const nf = new Intl.NumberFormat("es-MX");
const pct = new Intl.NumberFormat("es-MX", { style: "percent", maximumFractionDigits: 0 });

interface HeatmapResponse {
  generatedAt: string;
  cellSizeDeg: number;
  cellSizeMeters: number;
  totals: { reports: number; withLocation: number; withoutLocation: number; cells: number };
  cellsTruncated: boolean;
  cells: HeatCellView[];
  hotspots: { lat: number; lng: number; count: number; municipality: string | null }[];
  byCategory: { category: string; total: number }[];
  byStatus: { status: ReportStatus; total: number }[];
  points?: HeatPointView[];
  pointsTruncated?: boolean;
}

type ErrorKind = "offline" | "forbidden" | "session" | "server";
/** Resultado de la última consulta respondida (key = filtros con los que se pidió). */
interface Result {
  key: string;
  data: HeatmapResponse | null;
  error: ErrorKind | null;
}

/** Distingue un error de conexión de un error del servidor o de permisos. */
function classify(err: unknown): ErrorKind {
  if (err instanceof HttpError) {
    if (err.status === 401) return "session";
    if (err.status === 403) return "forbidden";
    return "server";
  }
  return "offline";
}

const ERROR_TEXT: Record<ErrorKind, string> = {
  offline: "Sin conexión con el servidor. Revisa la conexión a internet e inténtalo de nuevo.",
  forbidden: "Tu usuario no tiene permiso para consultar el mapa de calor.",
  session: "Tu sesión expiró. Vuelve a iniciar sesión.",
  server: "El servidor no pudo consultar los reportes. Inténtalo de nuevo en unos minutos.",
};

/** Mapa de calor de reportes ciudadanos. Exclusivo del rol ADMIN (el servidor también lo exige). */
export default function HeatmapPage({ user }: { user: AdminUser }) {
  const isAdmin = user.role === "ADMIN";
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [municipalities, setMunicipalities] = useState<string[]>([]);
  const [showPoints, setShowPoints] = useState(false);
  const [result, setResult] = useState<Result>({ key: "", data: null, error: null });
  const [retry, setRetry] = useState(0);

  // El mapa no usa el filtro de zona visible del panel general.
  const query = useMemo(() => filtersToQuery({ ...filters, bbox: null }), [filters]);
  const key = `${query}|${showPoints}|${retry}`;

  useEffect(() => {
    if (!isAdmin) return;
    adminApi.get<{ events: AdminEvent[] }>("/events").then((r) => setEvents(r.events)).catch(() => undefined);
    adminApi.get<{ municipalities: string[] }>("/municipalities").then((r) => setMunicipalities(r.municipalities)).catch(() => undefined);
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    adminApi.get<HeatmapResponse>(`/heatmap?${query}${showPoints ? "&includePoints=1" : ""}`).then(
      (data) => alive && setResult({ key, data, error: null }),
      // Ante un error se conservan los últimos datos mostrados, pero se indica claramente el fallo.
      (err) => alive && setResult((r) => ({ key, data: r.data, error: classify(err) })),
    );
    return () => {
      alive = false;
    };
  }, [isAdmin, key, query, showPoints]);

  if (!isAdmin) {
    return (
      <p role="alert" className="rounded-2xl bg-white p-6 text-center font-semibold shadow-sm" data-testid="heatmap-forbidden">
        El mapa de calor está disponible solo para administradores.
      </p>
    );
  }

  const loading = result.key !== key;
  const data = result.data;
  const error = loading ? null : result.error;
  const maxCell = data?.cells.reduce((m, c) => Math.max(m, c.count), 0) ?? 0;
  const maxCat = Math.max(1, ...(data?.byCategory.map((c) => c.total) ?? [1]));

  return (
    <div className="space-y-5" data-testid="heatmap-page">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black">Mapa de calor</h1>
          <p className="text-sm opacity-75">Concentración de reportes ciudadanos recibidos por el servidor (incluye los sincronizados desde el modo sin conexión).</p>
        </div>
        <p className="text-xs opacity-75" data-testid="heatmap-updated">
          {loading ? "Actualizando…" : data ? `Datos actualizados: ${formatDateTime(data.generatedAt)}` : ""}
        </p>
      </div>

      <Filters filters={filters} set={(p) => setFilters((f) => ({ ...f, ...p }))} events={events} municipalities={municipalities} onReset={() => setFilters(EMPTY_FILTERS)} />

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-alert-100 p-3 font-semibold text-alert-700" data-testid="heatmap-error" data-kind={error}>
          <span>{ERROR_TEXT[error]}</span>
          {error !== "forbidden" && error !== "session" && (
            <button type="button" onClick={() => setRetry((n) => n + 1)} className="min-h-10 rounded-lg bg-white px-3 text-sm">
              Reintentar
            </button>
          )}
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Indicadores del periodo" data-testid="heatmap-kpis">
        <Kpi label="Reportes del periodo" value={data?.totals.reports} testid="heat-kpi-total" />
        <Kpi label="Con coordenadas válidas" value={data?.totals.withLocation} testid="heat-kpi-located" />
        <Kpi label="Sin ubicación (no se dibujan)" value={data?.totals.withoutLocation} testid="heat-kpi-unlocated" />
        <Kpi label="Zonas con reportes" value={data?.totals.cells} testid="heat-kpi-zones" />
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black">Concentración de reportes</h2>
          <label className="flex min-h-10 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={showPoints} onChange={(e) => setShowPoints(e.target.checked)} className="size-5" data-testid="heatmap-toggle-points" />
            Mostrar reportes individuales
          </label>
        </div>
        <div className="relative mt-3">
          <HeatmapMap cells={data?.cells ?? []} points={showPoints ? data?.points : undefined} cellSizeMeters={data?.cellSizeMeters ?? 111} />
          {loading && !data && (
            <p className="absolute inset-0 z-[500] flex items-center justify-center rounded-xl bg-white/70 font-semibold" data-testid="heatmap-loading">
              Cargando reportes…
            </p>
          )}
          {data && !error && !loading && data.totals.withLocation === 0 && (
            <p className="absolute inset-x-4 top-4 z-[500] rounded-xl bg-white/95 p-3 text-center text-sm font-semibold shadow" data-testid="heatmap-empty">
              {data.totals.reports === 0
                ? "No hay reportes para los filtros seleccionados."
                : `Hay ${nf.format(data.totals.reports)} reportes en el periodo, pero ninguno tiene coordenadas válidas para dibujarse.`}
            </p>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {data && maxCell > 0 ? <HeatLegend maxCount={maxCell} cellSizeMeters={data.cellSizeMeters} /> : <span />}
          {data?.cellsTruncated && <p className="text-xs text-alert-700">Se muestran las 10,000 zonas con más reportes.</p>}
          {showPoints && data?.pointsTruncated && <p className="text-xs text-alert-700">Se muestran los 2,000 reportes individuales más recientes.</p>}
        </div>
        <p className="mt-2 text-xs opacity-70">
          Por privacidad, la capa de calor usa zonas agregadas (no la ubicación exacta de cada reporte) y no muestra comentarios ni datos de quien reporta.
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-black">Zonas con mayor concentración</h2>
          {!data?.hotspots.length ? (
            <p className="mt-3 text-sm opacity-70">Sin zonas con reportes ubicados.</p>
          ) : (
            <ol className="mt-3 space-y-2" data-testid="heatmap-hotspots">
              {data.hotspots.map((h, i) => (
                <li key={`${h.lat},${h.lng}`} className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-bold">{i + 1}. {h.municipality ?? "Zona sin municipio declarado"}</span>
                    <span className="block text-xs opacity-70">
                      Centro aprox. {h.lat.toFixed(3)}, {h.lng.toFixed(3)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block text-lg font-black">{nf.format(h.count)}</span>
                    <span className="text-xs opacity-70">{pct.format(h.count / Math.max(1, data.totals.withLocation))}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-black">Por tipo de incidente</h2>
          {!data?.byCategory.length ? (
            <p className="mt-3 text-sm opacity-70">Sin reportes en el periodo.</p>
          ) : (
            <ul className="mt-3 space-y-2" data-testid="heatmap-by-category">
              {data.byCategory.map((c) => {
                const cat = getCategory(c.category);
                return (
                  <li key={c.category} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-sm" title={`${cat?.label}: ${nf.format(c.total)}`}>
                    <span className="truncate font-semibold">
                      <span aria-hidden="true">{cat?.icon}</span> {cat?.label ?? c.category}
                    </span>
                    <span className="h-3 rounded-r bg-surface">
                      <span className="block h-3 rounded-r bg-tech-600" style={{ width: `${(c.total / maxCat) * 100}%` }} />
                    </span>
                    <span className="font-bold tabular-nums">{nf.format(c.total)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-black">Por estado</h2>
          <ul className="mt-3 space-y-2" data-testid="heatmap-by-status">
            {STATUSES.map((s) => (
              <li key={s} className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2 text-sm">
                <span className="font-semibold">
                  <span aria-hidden="true">{STATUS_META[s].dot}</span> {STATUS_META[s].service} / {STATUS_META[s].damage.toLowerCase()}
                </span>
                <span className="text-lg font-black tabular-nums">{nf.format(data?.byStatus.find((b) => b.status === s)?.total ?? 0)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
