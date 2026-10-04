import { BackLink } from "../components/ui";
import { PoweredBy } from "../components/Brand";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <BackLink to="/" children="← Inicio" />
      <h1 className="mt-2 text-3xl font-black">Aviso de privacidad de SENSO</h1>
      <div className="mt-4 space-y-4 text-base leading-relaxed">
        <p>SENSO recopila únicamente la información necesaria para conocer y atender afectaciones durante emergencias.</p>
        <h2 className="text-xl font-black">Qué datos se recopilan</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Tipo de afectación, estado, nivel y comentario opcional.</li>
          <li>Ubicación GPS (latitud, longitud y precisión) del momento del reporte, si la autorizas.</li>
          <li>Fecha y hora del reporte y de sus actualizaciones.</li>
          <li>Un identificador anónimo generado en tu dispositivo y el tipo de sistema (por ejemplo, “Android”).</li>
        </ul>
        <h2 className="text-xl font-black">Qué NO se recopila</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Nombre, teléfono, correo ni datos de contacto.</li>
          <li>Tu dirección IP completa: solo se usa de forma temporal para protección contra abuso y, en registros administrativos, truncada.</li>
          <li>Fotografías (no disponibles en esta versión).</li>
        </ul>
        <h2 className="text-xl font-black">Para qué se usa</h2>
        <p>Para elaborar mapas y estadísticas de afectaciones que ayudan a coordinar la respuesta y el restablecimiento de servicios.</p>
        <h2 className="text-xl font-black">Almacenamiento en tu dispositivo</h2>
        <p>Los reportes se guardan en tu dispositivo hasta enviarse. Puedes borrarlos eliminando los datos del sitio en tu navegador.</p>
        <h2 className="text-xl font-black">Permiso de ubicación</h2>
        <p>Es opcional. Si lo niegas puedes reportar igualmente, aunque el reporte no aparecerá en el mapa.</p>
      </div>
      <PoweredBy className="mt-10" />
    </main>
  );
}
