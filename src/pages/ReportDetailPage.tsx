import { useState } from "react";
import { useParams } from "react-router-dom";
import { LIMITS, SEVERITY_LABEL, STATUS_META, getCategory, type ReportStatus } from "../../shared/catalogs";
import { BackLink, BigButton, StatusBadge, SyncBadge } from "../components/ui";
import { useLocation } from "../gps/useLocation";
import { addReportUpdate } from "../storage/reports";
import { useEvents, useReport } from "../storage/useLocalData";
import { syncEngine } from "../sync/engine";
import { formatAccuracy, formatDateTime } from "../utils/format";

const RESTORE_OPTIONS: ReportStatus[] = ["AVAILABLE", "INTERMITTENT", "UNAVAILABLE"];

export default function ReportDetailPage() {
  const { id } = useParams();
  const { data, reload } = useReport(id);
  const [updating, setUpdating] = useState(false);
  const events = useEvents();

  if (data === undefined) return <p>Cargando…</p>;
  if (data === null)
    return (
      <div>
        <BackLink to="/app/reportes" />
        <p className="mt-4 text-lg">Este reporte no está en este dispositivo.</p>
      </div>
    );

  const { report, updates, syncStatus } = data;
  const cat = getCategory(report.category);
  const history = [
    { key: report.id, at: report.createdAt, status: report.status, comment: report.comment, sync: report.syncStatus, label: "Reporte inicial" },
    ...updates.map((u) => ({ key: u.id, at: u.createdAt, status: u.status, comment: u.comment, sync: u.syncStatus, label: "Actualización" })),
  ];

  return (
    <div>
      <BackLink to="/app/reportes" children="← Mis reportes" />
      <article className="mt-2 rounded-2xl bg-white p-5 shadow-sm">
        <p className="font-mono text-sm font-bold text-navy-700" data-testid="detail-folio">
          {report.folio ?? report.localFolio}
        </p>
        {!report.folio && <p className="text-xs opacity-70">Folio provisional hasta sincronizar</p>}
        <h1 className="mt-1 text-2xl font-black">
          <span aria-hidden="true">{cat?.icon}</span> {cat?.label}
        </h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <StatusBadge status={report.currentStatus} group={cat?.group} restore={updates.length > 0} />
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="font-semibold">Fecha</dt>
          <dd>{formatDateTime(report.createdAt)}</dd>
          <dt className="font-semibold">Nivel</dt>
          <dd>{SEVERITY_LABEL[report.severity]}</dd>
          <dt className="font-semibold">Evento</dt>
          <dd>{report.eventName ?? events.events.find((e) => e.id === report.eventId)?.name ?? (report.eventId ? `#${report.eventId}` : "Se asigna al sincronizar")}</dd>
          <dt className="font-semibold">Ubicación</dt>
          <dd className="min-w-0 break-words">
            {report.location
              ? `${report.location.latitude.toFixed(5)}, ${report.location.longitude.toFixed(5)} (${formatAccuracy(report.location.accuracy)})`
              : "No registrada"}
          </dd>
          {report.municipality && (
            <>
              <dt className="font-semibold">Zona</dt>
              <dd>{report.municipality}</dd>
            </>
          )}
          <dt className="font-semibold">Envío</dt>
          <dd>
            <SyncBadge status={syncStatus} />
          </dd>
        </dl>
        {report.lastError && syncStatus === "FAILED" && <p className="mt-2 text-sm text-alert-700">{report.lastError}</p>}
      </article>

      <section className="mt-5">
        <h2 className="text-xl font-black">Historial</h2>
        <ol className="mt-3 space-y-2 border-l-4 border-tech-100 pl-4" data-testid="history">
          {history.map((h) => (
            <li key={h.key} className="relative rounded-xl bg-white p-3 shadow-sm" data-testid="history-item">
              <span className="absolute top-4 -left-[1.6rem] size-3 rounded-full bg-tech-500" aria-hidden="true" />
              <p className="text-sm font-semibold">{formatDateTime(h.at)} · <span className="opacity-70">{h.label}</span></p>
              <p className="mt-1">
                <StatusBadge status={h.status} group={cat?.group} restore={h.key !== report.id} />
              </p>
              {h.comment && <p className="mt-1 text-sm">“{h.comment}”</p>}
              {h.sync !== "SYNCED" && (
                <p className="mt-1">
                  <SyncBadge status={h.sync} />
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>

      {updating ? (
        <RestoreForm
          reportId={report.id}
          damage={cat?.group === "DAMAGE"}
          onDone={() => {
            setUpdating(false);
            reload();
          }}
          onCancel={() => setUpdating(false)}
        />
      ) : (
        <BigButton className="mt-6" onClick={() => setUpdating(true)} data-testid="open-restore">
          {cat?.group === "DAMAGE" ? "ACTUALIZAR SITUACIÓN" : "¿YA SE RESTABLECIÓ?"}
        </BigButton>
      )}
    </div>
  );
}

function RestoreForm({ reportId, damage, onDone, onCancel }: { reportId: string; damage: boolean; onDone: () => void; onCancel: () => void }) {
  const [status, setStatus] = useState<ReportStatus | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ubicación actual "si está disponible": búsqueda corta que nunca bloquea.
  const { state: loc } = useLocation(true, 10_000);
  const location = loc.phase === "ready" ? loc.location : loc.phase === "locating" ? loc.best : null;

  async function save() {
    if (!status) return;
    setSaving(true);
    setError(null);
    try {
      await addReportUpdate({ reportId, status, comment, location, online: syncEngine.isEffectivelyOnline() });
      await syncEngine.refreshCounts();
      void syncEngine.sync();
      onDone();
    } catch (e) {
      setError(`No se pudo guardar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const tone: Record<ReportStatus, string> = {
    AVAILABLE: "border-ok-600 bg-ok-100 text-ok-700",
    INTERMITTENT: "border-warn-500 bg-warn-100 text-warn-600",
    UNAVAILABLE: "border-alert-600 bg-alert-100 text-alert-700",
  };

  return (
    <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm" data-testid="restore-form">
      <h2 className="text-2xl font-black">{damage ? "¿Cómo está ahora la situación?" : "¿Ya se restableció el servicio?"}</h2>
      <div className="mt-3 grid gap-3">
        {RESTORE_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={`flex min-h-16 items-center gap-3 rounded-2xl border-2 px-4 text-xl font-extrabold ${status === s ? tone[s] + " ring-4 ring-tech-400/40" : "border-navy-800/15"}`}
          >
            <span aria-hidden="true">{STATUS_META[s].dot}</span>
            {damage ? STATUS_META[s].damage : STATUS_META[s].restore}
          </button>
        ))}
      </div>
      <label className="mt-4 block">
        <span className="font-bold">Comentario (opcional)</span>
        <textarea
          value={comment}
          maxLength={LIMITS.commentMax}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          className="mt-1 block w-full rounded-xl border-2 border-navy-800/15 p-3 text-base"
        />
      </label>
      <p className="mt-3 text-sm" data-testid="update-location">
        {location ? `📍 Ubicación actual ${formatAccuracy(location.accuracy)}` : loc.phase === "locating" ? "📍 Buscando ubicación (opcional)…" : "📍 Sin ubicación actual (opcional)"}
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-alert-100 p-3 font-semibold text-alert-700">
          {error}
        </p>
      )}
      <div className="mt-4 grid gap-3">
        <BigButton onClick={() => void save()} disabled={!status || saving} data-testid="save-update">
          {saving ? "Guardando…" : "GUARDAR ACTUALIZACIÓN"}
        </BigButton>
        <BigButton variant="ghost" onClick={onCancel}>
          Cancelar
        </BigButton>
      </div>
    </section>
  );
}
