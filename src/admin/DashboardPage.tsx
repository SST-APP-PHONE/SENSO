import { useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORIES,
  EVENT_TYPE_LABEL,
  SEVERITY_LABEL,
  STATUSES,
  STATUS_META,
  getCategory,
  statusLabel,
  type EventType,
  type ReportStatus,
} from "../../shared/catalogs";
import { API_BASE, adminApi } from "../api/client";
import { StatusBadge } from "../components/ui";
import { MapLegend, MonitorMap, type Bounds, type MapMode, type MapPoint } from "../maps/MonitorMap";
import { formatAccuracy, formatDateTime } from "../utils/format";
import { EMPTY_FILTERS, filtersToQuery, type AdminEvent, type AdminReport, type AdminUser, type FilterState, type Summary } from "./types";

const nf = new Intl.NumberFormat("es-MX");
const PAGE_SIZE = 25;

export default function DashboardPage({ user }: { user: AdminUser }) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [municipalities, setMunicipalities] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [list, setList] = useState<{ total: number; rows: AdminReport[] } | null>(null);
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<MapMode>("heat");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const viewBounds = useRef<Bounds | null>(null);

  const query = useMemo(() => filtersToQuery(filters), [filters]);

  useEffect(() => {
    adminApi.get<{ events: AdminEvent[] }>("/events").then((r) => setEvents(r.events)).catch(() => undefined);
    adminApi.get<{ municipalities: string[] }>("/municipalities").then((r) => setMunicipalities(r.municipalities)).catch(() => undefined);
  }, []);

  // Actualización automática cada minuto.
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setRefreshKey((k) => k + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      adminApi.get<Summary>(`/summary?${query}`),
      adminApi.get<{ points: MapPoint[]; truncated: boolean }>(`/map?${query}`),
      adminApi.get<{ total: number; rows: AdminReport[] }>(`/reports?${query}&page=${page}&pageSize=${PAGE_SIZE}`),
    ]).then(
      ([s, m, l]) => {
        if (!alive) return;
        setSummary(s);
        setPoints(m.points);
        setTruncated(m.truncated);
        setList(l);
        setError(null);
      },
      (e) => alive && setError(e instanceof Error ? e.message : "Error al cargar datos"),
    );
    return () => {
      alive = false;
    };
  }, [query, page, refreshKey]);

  const set = (patch: Partial<FilterState>) => {
    setPage(1);
    setFilters((f) => ({ ...f, ...patch }));
  };

  const k = summary?.kpis;
  const maxCat = Math.max(1, ...(summary?.byCategory.map((c) => c.total) ?? [1]));

  return (
    <div className="space-y-5">
      <Filters filters={filters} set={set} events={events} municipalities={municipalities} onReset={() => (setPage(1), setFilters(EMPTY_FILTERS))} />

      {error && (
        <p role="alert" className="rounded-xl bg-alert-100 p-3 font-semibold text-alert-700">
          {error}
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="Indicadores" data-testid="kpis">
        <Kpi label="Reportes totales" value={k?.total} testid="kpi-total" />
        <Kpi label="Reportes hoy" value={k?.today} testid="kpi-today" />
        <Kpi label="Pendientes (sin restablecer)" value={k?.pending} testid="kpi-pending" />
        <Kpi label="Servicios afectados" value={k?.servicesAffected} testid="kpi-services" />
        <Kpi label="Reportes restablecidos" value={k?.restored} testid="kpi-restored" />
      </section>
      {k && (
        <p className="text-xs opacity-70">
          {nf.format(k.withLocation)} con ubicación · {nf.format(k.offlineCaptured)} capturados sin conexión · actualizado {formatDateTime(summary!.generatedAt)}
        </p>
      )}

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black">Mapa de afectaciones</h2>
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex rounded-lg bg-surface p-1" role="group" aria-label="Tipo de mapa">
              {(["heat", "points"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={`min-h-10 rounded-md px-3 text-sm font-bold ${mode === m ? "bg-navy-900 text-white" : ""}`}
                  data-testid={`map-mode-${m}`}
                >
                  {m === "heat" ? "Mapa de calor" : "Puntos"}
                </button>
              ))}
            </div>
            {filters.bbox ? (
              <button type="button" onClick={() => set({ bbox: null })} className="min-h-10 rounded-lg border px-3 text-sm font-semibold">
                Quitar filtro de zona
              </button>
            ) : (
              <button
                type="button"
                onClick={() => viewBounds.current && set({ bbox: viewBounds.current })}
                className="min-h-10 rounded-lg border px-3 text-sm font-semibold"
              >
                Filtrar por zona visible
              </button>
            )}
          </div>
        </div>
        <div className="mt-3">
          <MonitorMap points={points} mode={mode} onBoundsChange={(b) => (viewBounds.current = b)} />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <MapLegend mode={mode} />
          <p className="text-xs opacity-70">
            {nf.format(points.length)} reportes con ubicación{truncated && " (se muestran los 5,000 más recientes)"}
          </p>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-black">Reportes por tipo</h2>
          {summary && summary.byCategory.length === 0 && <p className="mt-3 text-sm opacity-70">Sin reportes con los filtros actuales.</p>}
          <ul className="mt-3 space-y-2" data-testid="by-category">
            {summary?.byCategory.map((c) => {
              const cat = getCategory(c.category);
              return (
                <li key={c.category} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm" title={`${cat?.label}: ${nf.format(c.total)}`}>
                  <span className="truncate font-semibold">
                    <span aria-hidden="true">{cat?.icon}</span> {cat?.label ?? c.category}
                  </span>
                  <span className="h-3 rounded-r bg-surface">
                    <span className="block h-3 rounded-r bg-tech-600" style={{ width: `${(c.total / maxCat) * 100}%` }} />
                  </span>
                  <span className="tabular-nums font-bold">{nf.format(c.total)}</span>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-black">Estado actual</h2>
          <ul className="mt-3 space-y-2">
            {STATUSES.map((s) => {
              const total = summary?.byStatus.find((b) => b.status === s)?.total ?? 0;
              return (
                <li key={s} className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2">
                  <span className="font-semibold">
                    <span aria-hidden="true">{STATUS_META[s].dot}</span> {STATUS_META[s].service} / {STATUS_META[s].damage.toLowerCase()}
                  </span>
                  <span className="tabular-nums text-lg font-black">{nf.format(total)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black">Reportes</h2>
          {user.role === "ADMIN" && (
            <a href={`${API_BASE}/admin/export.csv?${query}`} className="inline-flex min-h-11 items-center rounded-lg bg-navy-900 px-4 text-sm font-bold text-white" data-testid="export-csv">
              Exportar CSV
            </a>
          )}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm" data-testid="reports-table">
            <thead>
              <tr className="border-b text-xs uppercase opacity-70">
                <th className="py-2 pr-3">Folio</th>
                <th className="py-2 pr-3">Tipo</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3">Nivel</th>
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 pr-3">Zona</th>
                <th className="py-2 pr-3">Ubicación</th>
              </tr>
            </thead>
            <tbody>
              {list?.rows.map((r) => {
                const cat = getCategory(r.category);
                return (
                  <tr key={r.id} className="cursor-pointer border-b last:border-0 hover:bg-surface" onClick={() => setSelected(r.id)}>
                    <td className="py-2 pr-3 font-mono font-semibold">
                      <button type="button" className="underline" onClick={() => setSelected(r.id)}>
                        {r.folio}
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      {cat?.icon} {cat?.label}
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={r.currentStatus} group={cat?.group} />
                    </td>
                    <td className="py-2 pr-3">{SEVERITY_LABEL[r.severity]}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(r.createdAtClient)}</td>
                    <td className="py-2 pr-3">{r.municipality ?? "—"}</td>
                    <td className="py-2 pr-3">{r.latitude !== null ? "📍 Sí" : "—"}</td>
                  </tr>
                );
              })}
              {list && list.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center opacity-70">
                    Sin reportes con los filtros actuales.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {list && list.total > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-between text-sm">
            <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">
              Anterior
            </button>
            <span>
              Página {page} de {Math.ceil(list.total / PAGE_SIZE)} · {nf.format(list.total)} reportes
            </span>
            <button
              type="button"
              disabled={page >= Math.ceil(list.total / PAGE_SIZE)}
              onClick={() => setPage((p) => p + 1)}
              className="min-h-10 rounded-lg border px-3 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        )}
      </section>

      {selected !== null && <ReportDrawer id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Kpi({ label, value, testid }: { label: string; value: number | undefined; testid: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-3xl font-black tabular-nums" data-testid={testid}>
        {value === undefined ? "—" : nf.format(value)}
      </p>
    </div>
  );
}

function Filters({
  filters,
  set,
  events,
  municipalities,
  onReset,
}: {
  filters: FilterState;
  set: (p: Partial<FilterState>) => void;
  events: AdminEvent[];
  municipalities: string[];
  onReset: () => void;
}) {
  const sel = "min-h-11 w-full min-w-0 rounded-lg border border-navy-800/20 bg-white px-2 text-sm";
  const categories = CATEGORIES.filter((c) => !filters.group || c.group === filters.group);
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm" aria-label="Filtros">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Field label="Evento">
          <select className={sel} value={filters.eventId} onChange={(e) => set({ eventId: e.target.value })} data-testid="filter-event">
            <option value="">Todos</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {EVENT_TYPE_LABEL[e.type as EventType] ?? e.type} · {e.name}
                {e.isActive ? "" : " (inactivo)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Categoría">
          <select className={sel} value={filters.group} onChange={(e) => set({ group: e.target.value, category: "" })}>
            <option value="">Todas</option>
            <option value="SERVICE">Servicios</option>
            <option value="DAMAGE">Daños</option>
          </select>
        </Field>
        <Field label="Servicio / daño">
          <select className={sel} value={filters.category} onChange={(e) => set({ category: e.target.value })} data-testid="filter-category">
            <option value="">Todos</option>
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Estado">
          <select className={sel} value={filters.status} onChange={(e) => set({ status: e.target.value })} data-testid="filter-status">
            <option value="">Todos</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s as ReportStatus, "SERVICE")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Periodo">
          <select className={sel} value={filters.period} onChange={(e) => set({ period: e.target.value })} data-testid="filter-period">
            <option value="1">Últimas 24 h</option>
            <option value="7">Últimos 7 días</option>
            <option value="30">Últimos 30 días</option>
            <option value="">Todo</option>
            <option value="custom">Personalizado</option>
          </select>
        </Field>
        {filters.period === "custom" && (
          <>
            <Field label="Fecha inicial">
              <input type="date" className={sel} value={filters.from} onChange={(e) => set({ from: e.target.value })} />
            </Field>
            <Field label="Fecha final">
              <input type="date" className={sel} value={filters.to} onChange={(e) => set({ to: e.target.value })} />
            </Field>
          </>
        )}
        <Field label="Municipio / zona">
          <select className={sel} value={filters.municipality} onChange={(e) => set({ municipality: e.target.value })}>
            <option value="">Todos</option>
            {municipalities.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Conectividad al reportar">
          <select className={sel} value={filters.connectivity} onChange={(e) => set({ connectivity: e.target.value })}>
            <option value="">Todas</option>
            <option value="ONLINE">Con conexión</option>
            <option value="OFFLINE">Sin conexión</option>
          </select>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {filters.bbox && <span className="rounded-full bg-tech-100 px-3 py-1 font-semibold">Zona del mapa aplicada</span>}
        <button type="button" onClick={onReset} className="min-h-10 font-semibold text-tech-600 underline">
          Limpiar filtros
        </button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-semibold opacity-70">{label}</span>
      {children}
    </label>
  );
}

interface Detail {
  report: AdminReport;
  history: { id: number; status: ReportStatus; comment: string | null; latitude: number | null; longitude: number | null; accuracyM: number | null; createdAtClient: string; connectivity: string; receivedAt: string }[];
}

function ReportDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  useEffect(() => {
    adminApi.get<Detail>(`/reports/${id}`).then(setDetail).catch(() => setDetail(null));
  }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const r = detail?.report;
  const cat = r ? getCategory(r.category) : undefined;
  return (
    <div className="fixed inset-0 z-[1000] flex justify-end bg-navy-950/40" onClick={onClose} role="dialog" aria-modal="true" aria-label="Detalle del reporte">
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()} data-testid="report-drawer">
        <button type="button" onClick={onClose} className="min-h-11 font-semibold text-tech-600">
          ✕ Cerrar
        </button>
        {!r ? (
          <p className="mt-4">Cargando…</p>
        ) : (
          <>
            <p className="mt-2 font-mono font-bold">{r.folio}</p>
            <h2 className="text-2xl font-black">
              {cat?.icon} {cat?.label}
            </h2>
            <p className="mt-2">
              <StatusBadge status={r.currentStatus} group={cat?.group} />
            </p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="font-semibold">Evento</dt>
              <dd>{r.eventName}</dd>
              <dt className="font-semibold">Nivel</dt>
              <dd>{SEVERITY_LABEL[r.severity]}</dd>
              <dt className="font-semibold">Capturado</dt>
              <dd>{formatDateTime(r.createdAtClient)}</dd>
              <dt className="font-semibold">Recibido</dt>
              <dd>{formatDateTime(r.receivedAt)}</dd>
              <dt className="font-semibold">Conectividad</dt>
              <dd>{r.connectivity === "OFFLINE" ? "Capturado sin conexión" : "Con conexión"}</dd>
              <dt className="font-semibold">Ubicación</dt>
              <dd className="break-words">
                {r.latitude !== null ? `${r.latitude}, ${r.longitude} (${formatAccuracy(r.accuracyM)})` : "No registrada"}
              </dd>
              <dt className="font-semibold">Zona</dt>
              <dd>{r.municipality ?? "—"}</dd>
            </dl>
            {r.comment && <p className="mt-3 rounded-lg bg-surface p-3 text-sm">“{r.comment}”</p>}
            <h3 className="mt-5 font-black">Historial</h3>
            <ol className="mt-2 space-y-2 text-sm" data-testid="drawer-history">
              <li className="rounded-lg bg-surface p-2">
                {formatDateTime(r.createdAtClient)} · {statusLabel(r.initialStatus, cat?.group)} <span className="opacity-60">(inicial)</span>
              </li>
              {detail.history.map((h) => (
                <li key={h.id} className="rounded-lg bg-surface p-2">
                  {formatDateTime(h.createdAtClient)} · {STATUS_META[h.status].dot} {cat?.group === "DAMAGE" ? statusLabel(h.status, cat.group) : STATUS_META[h.status].restore}
                  {h.comment && <span className="block opacity-80">“{h.comment}”</span>}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
