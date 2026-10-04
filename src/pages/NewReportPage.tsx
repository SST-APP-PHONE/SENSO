import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CATEGORIES,
  EVENT_TYPE_LABEL,
  LIMITS,
  SEVERITIES,
  SEVERITY_LABEL,
  STATUSES,
  STATUS_META,
  getCategory,
  statusLabel,
  type CategoryCode,
  type EventType,
  type ReportStatus,
  type Severity,
} from "../../shared/catalogs";
import { PrivacyConsentCard, usePrivacyConsent } from "../components/PrivacyConsent";
import { BackLink, BigButton, BigLink, SyncBadge } from "../components/ui";
import { LOCATION_ERROR_TEXT, type LocationState } from "../gps/geolocation";
import { useLocation } from "../gps/useLocation";
import { createReport, setMeta } from "../storage/reports";
import { useEvents, useReport } from "../storage/useLocalData";
import { syncEngine } from "../sync/engine";
import { useSyncState } from "../sync/useSync";
import { formatAccuracy } from "../utils/format";

type Step = "category" | "details" | "saved";

const statusTone: Record<ReportStatus, string> = {
  UNAVAILABLE: "border-alert-600 bg-alert-100 text-alert-700",
  INTERMITTENT: "border-warn-500 bg-warn-100 text-warn-600",
  AVAILABLE: "border-ok-600 bg-ok-100 text-ok-700",
};

export default function NewReportPage() {
  const consent = usePrivacyConsent();
  const [step, setStep] = useState<Step>("category");
  const [category, setCategory] = useState<CategoryCode | null>(null);
  const [status, setStatus] = useState<ReportStatus | null>(null);
  const [severity, setSeverity] = useState<Severity>("MEDIUM");
  const [comment, setComment] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const events = useEvents();
  const sync = useSyncState();
  // La ubicación se busca desde que se abre el flujo, mientras la persona elige.
  const { state: loc, retry } = useLocation(consent.accepted === true && step !== "saved");

  if (consent.accepted === null) return null;
  if (!consent.accepted) return <PrivacyConsentCard onAccept={() => void consent.accept()} />;
  if (step === "saved" && savedId) return <SavedScreen reportId={savedId} onAnother={() => resetFlow()} />;

  function resetFlow() {
    setStep("category");
    setCategory(null);
    setStatus(null);
    setSeverity("MEDIUM");
    setComment("");
    setMunicipality("");
    setSavedId(null);
    setSaveError(null);
  }

  const group = category ? getCategory(category)?.group : undefined;
  const location = loc.phase === "ready" ? loc.location : loc.phase === "locating" ? loc.best : null;

  async function save(withoutLocation = false) {
    if (!category || !status || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const report = await createReport({
        category,
        status,
        severity,
        comment,
        municipality,
        location: withoutLocation ? null : location,
        event: events.selected ? { id: events.selected.id, name: events.selected.name } : null,
        online: syncEngine.isEffectivelyOnline(),
      });
      setSavedId(report.id);
      setStep("saved");
      await syncEngine.refreshCounts();
      void syncEngine.sync();
    } catch (e) {
      // Fallo real de almacenamiento local: se informa, no se oculta.
      setSaveError(`No se pudo guardar en este dispositivo: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  if (step === "category") {
    return (
      <div>
        <BackLink to="/app" />
        <EventLine events={events} />
        <h1 className="mt-2 text-3xl font-black">¿Qué estás reportando?</h1>
        <CategoryGrid title="Servicios afectados" group="SERVICE" onPick={(c) => (setCategory(c), setStep("details"))} />
        <CategoryGrid title="Daños / afectaciones" group="DAMAGE" onPick={(c) => (setCategory(c), setStep("details"))} />
        <LocationPanel state={loc} onRetry={retry} compact />
      </div>
    );
  }

  const cat = getCategory(category!)!;
  const noFixYet = loc.phase === "locating" && !loc.best;
  return (
    <div>
      <button type="button" onClick={() => setStep("category")} className="inline-flex min-h-11 items-center font-semibold text-tech-600">
        ← Cambiar categoría
      </button>
      <p className="mt-1 text-xl font-black" data-testid="selected-category">
        <span aria-hidden="true">{cat.icon}</span> {cat.label}
      </p>

      <fieldset className="mt-5">
        <legend className="text-2xl font-black">{group === "DAMAGE" ? "Estado de la afectación" : "Estado del servicio"}</legend>
        <div className="mt-3 grid gap-3">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={`flex min-h-16 items-center gap-3 rounded-2xl border-2 px-4 text-left text-xl font-extrabold ${
                status === s ? statusTone[s] + " ring-4 ring-tech-400/40" : "border-navy-800/15 bg-white"
              }`}
            >
              <span aria-hidden="true">{STATUS_META[s].dot}</span>
              {statusLabel(s, group)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="text-lg font-black">Nivel de afectación</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={severity === s}
              onClick={() => setSeverity(s)}
              className={`min-h-14 rounded-xl border-2 text-lg font-bold ${severity === s ? "border-navy-900 bg-navy-900 text-white" : "border-navy-800/15 bg-white"}`}
            >
              {SEVERITY_LABEL[s]}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="mt-6 block">
        <span className="text-lg font-black">Comentario (opcional)</span>
        <textarea
          value={comment}
          maxLength={LIMITS.commentMax}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          className="mt-2 block w-full rounded-xl border-2 border-navy-800/15 bg-white p-3 text-base"
          placeholder="Ej. Poste caído en la esquina"
        />
      </label>

      <details className="mt-3 rounded-xl bg-white p-3">
        <summary className="min-h-8 cursor-pointer font-semibold">Más datos (opcional)</summary>
        <label className="mt-2 block">
          <span className="text-sm font-semibold">Municipio o zona</span>
          <input
            value={municipality}
            maxLength={LIMITS.municipalityMax}
            onChange={(e) => setMunicipality(e.target.value)}
            className="mt-1 block w-full rounded-xl border-2 border-navy-800/15 p-3 text-base"
            placeholder="Ej. Los Cabos"
            autoComplete="address-level2"
          />
        </label>
      </details>

      <LocationPanel state={loc} onRetry={retry} />

      {saveError && (
        <p role="alert" className="mt-4 rounded-xl bg-alert-100 p-3 font-semibold text-alert-700">
          {saveError}
        </p>
      )}

      <div className="mt-5 grid gap-3">
        <BigButton variant="danger" onClick={() => void save()} disabled={!status || saving || noFixYet} data-testid="save-report">
          {saving ? "Guardando…" : noFixYet ? "Obteniendo ubicación…" : "GUARDAR REPORTE"}
        </BigButton>
        {loc.phase === "error" && (
          <BigButton variant="secondary" onClick={() => void save(true)} disabled={!status || saving} data-testid="save-without-location">
            Guardar sin ubicación
          </BigButton>
        )}
        {!status && <p className="text-center text-sm opacity-70">Selecciona el estado para guardar.</p>}
        {(!sync.online || !sync.reachable) && <p className="text-center text-sm font-semibold">Sin conexión: se guardará en este dispositivo.</p>}
      </div>
    </div>
  );
}

function EventLine({ events }: { events: ReturnType<typeof useEvents> }) {
  if (!events.loaded) return null;
  if (!events.events.length) {
    return <p className="mt-2 rounded-xl bg-white px-3 py-2 text-sm">Evento: se asignará al sincronizar.</p>;
  }
  if (events.events.length === 1) {
    const e = events.events[0];
    return (
      <p className="mt-2 rounded-xl bg-white px-3 py-2 text-sm" data-testid="event-line">
        Evento: <strong>{EVENT_TYPE_LABEL[e.type as EventType] ?? e.type} · {e.name}</strong>
      </p>
    );
  }
  return (
    <label className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm">
      Evento:
      <select
        className="min-h-11 min-w-0 flex-1 rounded-lg border border-navy-800/20 bg-white px-2 font-semibold"
        value={events.selected?.id ?? ""}
        onChange={(e) => void setMeta("selectedEventId", Number(e.target.value)).then(() => syncEngine.refreshCounts())}
      >
        {events.events.map((e) => (
          <option key={e.id} value={e.id}>
            {EVENT_TYPE_LABEL[e.type as EventType] ?? e.type} · {e.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function CategoryGrid({ title, group, onPick }: { title: string; group: "SERVICE" | "DAMAGE"; onPick: (c: CategoryCode) => void }) {
  return (
    <section className="mt-5">
      <h2 className="text-sm font-bold uppercase tracking-wider opacity-70">{title}</h2>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CATEGORIES.filter((c) => c.group === group).map((c) => (
          <button
            key={c.code}
            type="button"
            onClick={() => onPick(c.code)}
            className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-navy-800/10 bg-white p-2 text-center text-base font-bold shadow-sm hover:border-tech-500 active:bg-tech-100"
            data-testid={`category-${c.code}`}
          >
            <span className="text-3xl" aria-hidden="true">
              {c.icon}
            </span>
            {c.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function LocationPanel({ state, onRetry, compact = false }: { state: LocationState; onRetry: () => void; compact?: boolean }) {
  const box = "mt-5 rounded-2xl p-4 text-base";
  if (state.phase === "idle") return null;
  if (state.phase === "locating") {
    return (
      <div className={`${box} bg-tech-100`} data-testid="location-panel" data-phase="locating">
        📍 Obteniendo ubicación…{state.best && <span className="ml-1 opacity-80">({formatAccuracy(state.best.accuracy)})</span>}
        {!compact && <p className="mt-1 text-sm opacity-75">Funciona sin internet. Si estás bajo techo, acércate a una ventana.</p>}
      </div>
    );
  }
  if (state.phase === "ready") {
    return (
      <div className={`${box} ${state.lowAccuracy ? "bg-warn-100" : "bg-ok-100"}`} data-testid="location-panel" data-phase="ready">
        <p className="font-bold">{state.lowAccuracy ? "⚠️ Ubicación aproximada" : "📍 Ubicación registrada"}</p>
        <p className="text-sm">
          {state.location.latitude.toFixed(5)}, {state.location.longitude.toFixed(5)} · {formatAccuracy(state.location.accuracy)}
        </p>
        {state.lowAccuracy && (
          <button type="button" onClick={onRetry} className="mt-2 min-h-11 rounded-lg bg-white px-3 font-bold">
            Mejorar ubicación
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={`${box} bg-alert-100 text-alert-700`} role="alert" data-testid="location-panel" data-phase="error">
      <p className="font-bold">No fue posible obtener la ubicación.</p>
      <p className="text-sm">{LOCATION_ERROR_TEXT[state.error]}</p>
      <button type="button" onClick={onRetry} className="mt-2 min-h-11 rounded-lg bg-white px-3 font-bold" data-testid="location-retry">
        Reintentar ubicación
      </button>
    </div>
  );
}

function SavedScreen({ reportId, onAnother }: { reportId: string; onAnother: () => void }) {
  const { data } = useReport(reportId);
  const s = useSyncState();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  if (!data) return null;
  const { report, syncStatus } = data;
  return (
    <div className="text-center" data-testid="report-saved">
      <div className="rounded-3xl bg-ok-700 px-5 py-8 text-white">
        <p className="text-5xl" aria-hidden="true">
          ✅
        </p>
        <h1 className="mt-2 text-3xl font-black">Reporte guardado</h1>
        {syncStatus === "SYNCED" ? (
          <p className="mt-2 text-lg">Recibido por el centro de monitoreo.</p>
        ) : !s.online || !s.reachable ? (
          <p className="mt-2 text-lg" data-testid="saved-offline-msg">
            Se enviará cuando vuelva la conexión.
          </p>
        ) : syncStatus === "FAILED" ? (
          <p className="mt-2 text-lg">No se pudo enviar ahora. Se reintentará automáticamente.</p>
        ) : (
          <p className="mt-2 text-lg">Enviando…</p>
        )}
        <p className="mt-4 font-mono text-lg font-bold" data-testid="saved-folio">
          {report.folio ?? report.localFolio}
        </p>
        {!report.folio && <p className="text-sm opacity-80">Folio provisional · el folio oficial se asigna al sincronizar</p>}
      </div>
      <div className="mt-3">
        <SyncBadge status={syncStatus} />
      </div>
      <div className="mt-6 grid gap-3">
        <BigButton variant="danger" onClick={onAnother}>
          OTRO REPORTE
        </BigButton>
        <BigLink to={`/app/reportes/${report.id}`} variant="secondary">
          VER REPORTE
        </BigLink>
        <Link to="/app" className="min-h-11 py-2 font-semibold text-tech-600">
          Ir al inicio
        </Link>
      </div>
    </div>
  );
}
