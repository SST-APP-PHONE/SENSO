import { syncEngine } from "../sync/engine";
import { useSyncState } from "../sync/useSync";

function pendingText(n: number) {
  return n === 1 ? "1 reporte pendiente" : `${n} reportes pendientes`;
}

/** Barra global (siempre visible) con el estado de conexión y la cola pendiente. */
export function ConnectionStatus() {
  const s = useSyncState();
  const pending = s.counts.reports;
  const mode = !s.online || !s.reachable ? "offline" : s.syncing ? "syncing" : "online";
  const styles = {
    online: "bg-navy-900 text-white",
    offline: "bg-alert-700 text-white",
    syncing: "bg-amber-400 text-navy-950",
  }[mode];
  const label = { online: "🟢 En línea", offline: "🔴 Sin conexión", syncing: "🟡 Sincronizando" }[mode];

  return (
    <div className={`sticky top-0 z-40 ${styles}`} role="status" aria-live="polite" data-testid="connection-status" data-mode={mode}>
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-4 py-2 text-sm font-semibold">
        <span data-testid="connection-label">{label}</span>
        <span data-testid="pending-count" className={pending ? "" : "opacity-75"}>
          {pending ? pendingText(pending) : "Sin pendientes"}
          {s.counts.failed > 0 && <span className="ml-1">· {s.counts.failed} con error</span>}
        </span>
      </div>
      {mode === "offline" && (
        <p className="mx-auto max-w-3xl px-4 pb-2 text-sm font-medium" data-testid="offline-hint">
          Sin conexión: los reportes se guardarán en este dispositivo.
          {s.online && (
            <span className="mt-1 flex flex-wrap items-center gap-2 text-xs font-normal">
              El dispositivo tiene red, pero el servidor no responde. Se reintentará automáticamente.
              <button
                type="button"
                onClick={() => void syncEngine.sync({ force: true })}
                disabled={s.syncing}
                className="min-h-9 rounded-md bg-white px-2 font-bold text-alert-700 disabled:opacity-60"
              >
                Reintentar conexión
              </button>
            </span>
          )}
        </p>
      )}
      {s.justReconnected && mode !== "offline" && (
        <div className="bg-ok-700 text-white" data-testid="reconnected-banner">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-2">
            <p className="text-sm">
              <strong>Conexión restaurada.</strong>{" "}
              {pending ? `${pendingText(pending)} de sincronizar.` : "Todo está sincronizado."}
            </p>
            <div className="flex gap-2">
              {pending > 0 && (
                <button
                  type="button"
                  onClick={() => void syncEngine.sync({ force: true })}
                  disabled={s.syncing}
                  className="min-h-11 rounded-lg bg-white px-3 text-sm font-bold text-ok-700 disabled:opacity-60"
                >
                  SINCRONIZAR AHORA
                </button>
              )}
              <button type="button" onClick={() => syncEngine.dismissReconnected()} className="min-h-11 rounded-lg px-3 text-sm underline" aria-label="Cerrar aviso">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
