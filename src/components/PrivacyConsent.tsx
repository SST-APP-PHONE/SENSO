import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMeta, setMeta } from "../storage/reports";
import { BigButton } from "./ui";

/** Estado del consentimiento, guardado en IndexedDB del dispositivo. */
export function usePrivacyConsent() {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    getMeta("privacyAccepted")
      .then((v) => alive && setAccepted(!!v))
      .catch(() => alive && setAccepted(false));
    return () => {
      alive = false;
    };
  }, []);
  const accept = async () => {
    await setMeta("privacyAccepted", new Date().toISOString());
    setAccepted(true);
  };
  return { accepted, accept };
}

/** Aviso breve antes del primer reporte: qué se guarda y por qué se pide la ubicación. */
export function PrivacyConsentCard({ onAccept }: { onAccept: () => void }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm" aria-labelledby="privacy-title" data-testid="privacy-consent">
      <h1 id="privacy-title" className="text-2xl font-black">
        Antes de reportar
      </h1>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-base">
        <li>Guardamos el tipo de afectación, su estado, tu comentario y la fecha/hora.</li>
        <li>
          Pediremos tu <strong>ubicación</strong> para ubicar la afectación en el mapa. Solo se usa para la atención de la emergencia.
        </li>
        <li>No pedimos nombre, teléfono ni correo.</li>
        <li>Los reportes se guardan en este dispositivo y se envían al servidor cuando hay conexión.</li>
      </ul>
      <p className="mt-3 text-sm">
        <Link to="/privacidad" className="font-semibold text-tech-600 underline">
          Aviso de privacidad completo
        </Link>
      </p>
      <BigButton className="mt-5" onClick={onAccept}>
        ENTENDIDO, CONTINUAR
      </BigButton>
    </section>
  );
}
