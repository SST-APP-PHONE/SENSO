import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { STATUS_META, statusLabel, type CategoryGroup, type ReportStatus } from "../../shared/catalogs";
import type { SyncStatus } from "../types/models";

const toneClasses = {
  red: "bg-alert-100 text-alert-700 border-alert-600",
  orange: "bg-warn-100 text-warn-600 border-warn-500",
  green: "bg-ok-100 text-ok-700 border-ok-600",
};

/** `restore`: etiquetas de seguimiento (Restablecido / No restablecido) para actualizaciones de servicios. */
export function StatusBadge({ status, group, restore = false }: { status: ReportStatus; group?: CategoryGroup; restore?: boolean }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-bold ${toneClasses[m.tone]}`}>
      <span aria-hidden="true">{m.dot}</span>
      {restore && group !== "DAMAGE" ? m.restore : statusLabel(status, group)}
    </span>
  );
}

const syncText: Record<SyncStatus, { text: string; cls: string }> = {
  PENDING: { text: "Pendiente de sincronización", cls: "bg-amber-100 text-amber-900" },
  SYNCING: { text: "Sincronizando…", cls: "bg-amber-100 text-amber-900" },
  SYNCED: { text: "Sincronizado", cls: "bg-ok-100 text-ok-700" },
  FAILED: { text: "Error al sincronizar · se reintentará", cls: "bg-alert-100 text-alert-700" },
};

export function SyncBadge({ status }: { status: SyncStatus }) {
  const s = syncText[status];
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold ${s.cls}`} data-testid="sync-badge" data-status={status}>
      {s.text}
    </span>
  );
}

type Variant = "primary" | "danger" | "secondary" | "ghost";
const variantClasses: Record<Variant, string> = {
  primary: "bg-tech-600 text-white hover:bg-tech-500 shadow-md",
  danger: "bg-alert-600 text-white hover:bg-alert-700 shadow-md",
  secondary: "bg-white text-navy-900 border-2 border-navy-800/15 hover:border-tech-500",
  ghost: "text-navy-800 underline",
};

const base = "flex w-full min-h-14 items-center justify-center gap-2 rounded-2xl px-5 text-lg font-extrabold tracking-wide transition-colors disabled:opacity-50";

export function BigButton({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={`${base} ${variantClasses[variant]} ${className}`} {...props} />;
}

export function BigLink({ to, variant = "primary", children, className = "" }: { to: string; variant?: Variant; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={`${base} ${variantClasses[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function BackLink({ to, children = "← Volver" }: { to: string; children?: ReactNode }) {
  return (
    <Link to={to} className="inline-flex min-h-11 items-center font-semibold text-tech-600">
      {children}
    </Link>
  );
}
