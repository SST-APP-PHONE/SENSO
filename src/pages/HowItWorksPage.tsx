import { BackLink, BigLink } from "../components/ui";

const steps = [
  ["1", "Elige qué reportas", "Un servicio (luz, agua, teléfono…) o un daño (inundación, derrumbe…)."],
  ["2", "Indica el estado", "No disponible, intermitente o disponible, y qué tan grave es."],
  ["3", "Se registra tu ubicación", "Con el GPS del teléfono. No necesita internet."],
  ["4", "Se guarda en tu dispositivo", "Aunque no tengas internet ni señal. No se pierde si cierras la app."],
  ["5", "Se envía solo", "Cuando vuelve la conexión, SENSO sincroniza tus reportes sin duplicarlos."],
  ["6", "Actualiza cuando cambie", "Marca cuando el servicio se restablezca. Queda el historial."],
];

export default function HowItWorksPage() {
  return (
    <div>
      <BackLink to="/app" />
      <h1 className="mt-2 text-3xl font-black">¿Cómo funciona?</h1>
      <ol className="mt-5 space-y-3">
        {steps.map(([n, title, text]) => (
          <li key={n} className="flex gap-4 rounded-2xl bg-white p-4 shadow-sm">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tech-600 text-lg font-black text-white">{n}</span>
            <span>
              <strong className="block text-lg">{title}</strong>
              <span className="text-base opacity-80">{text}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-5 rounded-2xl bg-tech-100 p-4 text-base">
        <strong>Consejo:</strong> instala SENSO en tu pantalla de inicio y ábrela una vez con internet. Así funcionará aunque después no haya señal.
      </p>
      <BigLink to="/app/nuevo" variant="danger" className="mt-6">
        NUEVO REPORTE
      </BigLink>
    </div>
  );
}
