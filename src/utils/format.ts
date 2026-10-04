const dateTime = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const shortDateTime = new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const formatDateTime = (iso: string | Date) => dateTime.format(new Date(iso)).replace(",", "");
export const formatShort = (iso: string | Date) => shortDateTime.format(new Date(iso)).replace(",", "");

export function formatAccuracy(m: number | null | undefined): string {
  if (m === null || m === undefined) return "precisión desconocida";
  return m < 1000 ? `±${Math.round(m)} m` : `±${(m / 1000).toFixed(1)} km`;
}

export function describePlatform(): string {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Otro";
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches ? " · app" : "";
  return `${os}${standalone}`;
}
