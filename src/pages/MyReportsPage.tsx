import { Link } from "react-router-dom";
import { getCategory } from "../../shared/catalogs";
import { BackLink, BigButton, BigLink, StatusBadge, SyncBadge } from "../components/ui";
import { useReports } from "../storage/useLocalData";
import { syncEngine } from "../sync/engine";
import { useSyncState } from "../sync/useSync";
import { formatDateTime } from "../utils/format";

export default function MyReportsPage() {
  const reports = useReports();
  const s = useSyncState();
  return (
    <div>
      <BackLink to="/app" />
      <h1 className="mt-2 text-3xl font-black">Mis reportes</h1>
      <p className="mt-1 text-sm opacity-75">Guardados en este dispositivo.</p>

      {s.counts.operations > 0 && (
        <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <p className="font-semibold">
            {s.counts.reports} {s.counts.reports === 1 ? "reporte pendiente" : "reportes pendientes"} de sincronizar
          </p>
          {s.lastError && <p className="mt-1 text-sm text-alert-700">Último intento: {s.lastError}</p>}
          <BigButton className="mt-3" onClick={() => void syncEngine.sync({ force: true })} disabled={!s.online || s.syncing} data-testid="sync-now">
            {s.syncing ? "Sincronizando…" : s.online ? "SINCRONIZAR AHORA" : "Sin conexión"}
          </BigButton>
        </div>
      )}

      {reports === null ? (
        <p className="mt-6">Cargando…</p>
      ) : reports.length === 0 ? (
        <div className="mt-6 rounded-2xl bg-white p-6 text-center">
          <p className="text-lg">Aún no tienes reportes en este dispositivo.</p>
          <BigLink to="/app/nuevo" variant="danger" className="mt-4">
            NUEVO REPORTE
          </BigLink>
        </div>
      ) : (
        <ul className="mt-5 space-y-3" data-testid="report-list">
          {reports.map(({ report, updates, syncStatus }) => {
            const cat = getCategory(report.category);
            return (
              <li key={report.id}>
                <Link
                  to={`/app/reportes/${report.id}`}
                  className="block rounded-2xl border-2 border-transparent bg-white p-4 shadow-sm hover:border-tech-500"
                  data-testid="report-card"
                >
                  <p className="font-mono text-sm font-bold text-navy-700">
                    {report.folio ?? report.localFolio}
                    {!report.folio && <span className="ml-1 font-sans font-normal opacity-70">(provisional)</span>}
                  </p>
                  <p className="mt-1 text-xl font-black">
                    <span aria-hidden="true">{cat?.icon}</span> {cat?.label}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge status={report.currentStatus} group={cat?.group} restore={updates.length > 0} />
                  </div>
                  <p className="mt-2 text-sm">{formatDateTime(report.createdAt)}</p>
                  <p className="text-sm">{report.location ? "📍 Ubicación registrada" : "📍 Sin ubicación"}</p>
                  <p className="mt-2">
                    <span className="text-sm">Estado: </span>
                    <SyncBadge status={syncStatus} />
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
