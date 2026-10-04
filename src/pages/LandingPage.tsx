import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Brand, BrandMark, PoweredBy } from "../components/Brand";
import { useInstall } from "../components/InstallPrompt";

const features = [
  ["📴", "Funciona sin internet", "Captura reportes aunque no haya datos ni señal telefónica."],
  ["📍", "Registra la ubicación", "Usa el GPS del teléfono, que no necesita internet."],
  ["💾", "Guarda en tu dispositivo", "Nada se pierde si cierras la app o se reinicia el teléfono."],
  ["🔄", "Sincroniza al volver la conexión", "Envío automático, sin duplicados."],
  ["🗺️", "Genera mapas de calor", "El centro de monitoreo ve dónde se concentran las afectaciones."],
  ["✅", "Seguimiento del restablecimiento", "Cada reporte guarda su historial hasta que se resuelve."],
];

export default function LandingPage() {
  const install = useInstall();
  useEffect(() => {
    document.title = "SENSO — Reporta. Aún sin conexión.";
  }, []);
  return (
    <div className="min-h-dvh bg-navy-950 text-white">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Brand />
      </header>
      <main>
        <section className="mx-auto max-w-5xl px-4 pt-8 pb-12 md:pt-16">
          <div className="grid items-center gap-10 md:grid-cols-[1.4fr_1fr]">
            <div>
              <p className="text-sm font-bold tracking-[0.3em] text-tech-400">SENSO</p>
              <h1 className="mt-3 text-4xl font-black leading-tight sm:text-5xl md:text-6xl">
                Reporta.
                <br />
                <span className="text-tech-400">Aún sin conexión.</span>
              </h1>
              <p className="mt-4 text-xl opacity-90">Información que ayuda a tomar decisiones.</p>
              <p className="mt-3 max-w-xl text-base opacity-75">
                Reporta afectaciones en huracanes, sismos, inundaciones, incendios, derrumbes y fallas de servicios. Tus reportes llegan al centro de
                monitoreo en cuanto vuelve la conexión.
              </p>
              <div className="mt-8 grid gap-3 sm:flex">
                <Link to="/app" className="flex min-h-14 items-center justify-center rounded-2xl bg-alert-600 px-7 text-lg font-extrabold shadow-lg hover:bg-alert-700">
                  Entrar a SENSO
                </Link>
                {!install.installed && (
                  <button
                    type="button"
                    onClick={() => (install.canPrompt ? void install.prompt() : document.getElementById("instalar")?.scrollIntoView())}
                    className="min-h-14 rounded-2xl border-2 border-white/30 px-7 text-lg font-extrabold hover:border-tech-400"
                  >
                    Instalar SENSO
                  </button>
                )}
              </div>
            </div>
            <div className="hidden justify-center md:flex" aria-hidden="true">
              <div className="relative flex size-72 items-center justify-center rounded-full border border-tech-400/30">
                <div className="absolute size-52 rounded-full border border-tech-400/40" />
                <div className="absolute size-32 rounded-full border border-tech-400/60" />
                <BrandMark size={96} />
              </div>
            </div>
          </div>
        </section>

        <section className="bg-surface py-12 text-navy-950">
          <div className="mx-auto max-w-5xl px-4">
            <h2 className="text-3xl font-black">Hecho para emergencias</h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map(([icon, title, text]) => (
                <li key={title} className="rounded-2xl bg-white p-5 shadow-sm">
                  <p className="text-3xl" aria-hidden="true">
                    {icon}
                  </p>
                  <h3 className="mt-2 text-lg font-black">{title}</h3>
                  <p className="mt-1 opacity-80">{text}</p>
                </li>
              ))}
            </ul>

            <div id="instalar" className="mt-10 rounded-2xl bg-navy-900 p-6 text-white">
              <h2 className="text-2xl font-black">Instala SENSO antes de la emergencia</h2>
              <ul className="mt-3 list-disc space-y-1 pl-5 opacity-90">
                <li>Android / computadora: botón “Instalar SENSO” o menú del navegador → “Instalar aplicación”.</li>
                <li>iPhone: en Safari toca Compartir → “Agregar a inicio”.</li>
                <li>Ábrela una vez con internet: después funcionará sin conexión.</li>
              </ul>
            </div>
          </div>
        </section>
      </main>
      <footer className="bg-surface pb-8 text-navy-950">
        <p className="text-center text-sm">
          <Link to="/privacidad" className="underline">
            Aviso de privacidad
          </Link>
        </p>
        <PoweredBy className="mt-2" />
      </footer>
    </div>
  );
}
