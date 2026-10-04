import { InstallPrompt } from "../components/InstallPrompt";
import { BigLink } from "../components/ui";
import { useSyncState } from "../sync/useSync";

export default function HomePage() {
  const s = useSyncState();
  return (
    <div>
      <section className="rounded-3xl bg-navy-900 px-5 py-6 text-white">
        <p className="text-sm font-bold tracking-[0.25em] text-tech-400">SENSO</p>
        <h1 className="mt-1 text-3xl font-black leading-tight">Reporta desde donde estés</h1>
        <p className="mt-2 text-lg opacity-90">Funciona incluso sin conexión.</p>
        <p className="mt-4 text-base font-semibold" data-testid="home-pending">
          Reportes pendientes: {s.counts.reports}
        </p>
      </section>

      <nav className="mt-6 grid gap-4" aria-label="Acciones principales">
        <BigLink to="/app/nuevo" variant="danger" className="min-h-20 text-xl">
          <span aria-hidden="true">＋</span> NUEVO REPORTE
        </BigLink>
        <BigLink to="/app/reportes" variant="secondary" className="min-h-16">
          MIS REPORTES
        </BigLink>
        <BigLink to="/app/como-funciona" variant="secondary" className="min-h-16">
          ¿CÓMO FUNCIONA?
        </BigLink>
      </nav>

      <InstallPrompt />
    </div>
  );
}
