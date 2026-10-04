import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "senso.installDismissedAt";
let deferred: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    subscribers.forEach((s) => s());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    subscribers.forEach((s) => s());
  });
}

export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Estado de instalación compartido (evento beforeinstallprompt de Android/desktop). */
export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);
  return {
    canPrompt: !!deferred,
    installed: isStandalone(),
    ios: isIOS(),
    async prompt() {
      if (!deferred) return false;
      await deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      subscribers.forEach((s) => s());
      return choice.outcome === "accepted";
    },
  };
}

function readDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < 7 * 86_400_000;
  } catch {
    return false;
  }
}

/** Invitación discreta para instalar SENSO. */
export function InstallPrompt() {
  const install = useInstall();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (install.installed || dismissed || (!install.canPrompt && !install.ios)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* almacenamiento no disponible: solo se oculta en esta sesión */
    }
    setDismissed(true);
  };

  return (
    <aside className="mt-6 rounded-2xl border border-tech-100 bg-white p-4 text-sm shadow-sm" data-testid="install-prompt">
      <p className="font-semibold">Instala SENSO para estar preparado ante una emergencia.</p>
      {install.canPrompt ? (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => void install.prompt()} className="min-h-11 rounded-xl bg-tech-600 px-4 font-bold text-white">
            Instalar
          </button>
          <button type="button" onClick={dismiss} className="min-h-11 rounded-xl px-4 font-semibold text-navy-800">
            Ahora no
          </button>
        </div>
      ) : (
        <div className="mt-2 flex items-start justify-between gap-3">
          <p className="opacity-80">En iPhone: toca Compartir y luego “Agregar a inicio”.</p>
          <button type="button" onClick={dismiss} className="min-h-11 shrink-0 px-2 font-semibold text-navy-800" aria-label="Cerrar invitación">
            ✕
          </button>
        </div>
      )}
    </aside>
  );
}
