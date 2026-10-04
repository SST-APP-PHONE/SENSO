/**
 * Catálogos de SENSO compartidos entre cliente y servidor.
 * Son definiciones del producto (no datos operativos): el cliente los trae
 * empaquetados para funcionar sin conexión y el servidor los usa para validar.
 */

export const CATEGORY_GROUPS = ["SERVICE", "DAMAGE"] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

export interface CategoryDef {
  code: string;
  group: CategoryGroup;
  label: string;
  icon: string;
}

export const CATEGORIES = [
  { code: "electricity", group: "SERVICE", label: "Electricidad", icon: "⚡" },
  { code: "water", group: "SERVICE", label: "Agua", icon: "💧" },
  { code: "phone", group: "SERVICE", label: "Telefonía", icon: "📡" },
  { code: "internet", group: "SERVICE", label: "Internet", icon: "🌐" },
  { code: "gas", group: "SERVICE", label: "Gas", icon: "⛽" },
  { code: "drainage", group: "SERVICE", label: "Drenaje", icon: "🚰" },
  { code: "communication", group: "SERVICE", label: "Comunicación", icon: "📻" },
  { code: "other_service", group: "SERVICE", label: "Otro servicio", icon: "➕" },
  { code: "structural", group: "DAMAGE", label: "Daño estructural", icon: "🏠" },
  { code: "roads", group: "DAMAGE", label: "Vialidad", icon: "🚧" },
  { code: "flood", group: "DAMAGE", label: "Inundación", icon: "🌊" },
  { code: "fire", group: "DAMAGE", label: "Incendio", icon: "🔥" },
  { code: "landslide", group: "DAMAGE", label: "Derrumbe", icon: "⛰️" },
  { code: "trees", group: "DAMAGE", label: "Árboles / obstrucciones", icon: "🌳" },
  { code: "other_damage", group: "DAMAGE", label: "Otro daño", icon: "❗" },
] as const satisfies readonly CategoryDef[];

export type CategoryCode = (typeof CATEGORIES)[number]["code"];
export const CATEGORY_CODES = CATEGORIES.map((c) => c.code) as [CategoryCode, ...CategoryCode[]];

export function getCategory(code: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.code === code);
}

/** Estado de un servicio o afectación. Se usa tanto al reportar como al restablecer. */
export const STATUSES = ["UNAVAILABLE", "INTERMITTENT", "AVAILABLE"] as const;
export type ReportStatus = (typeof STATUSES)[number];

export const STATUS_META: Record<ReportStatus, { dot: string; service: string; damage: string; restore: string; tone: "red" | "orange" | "green" }> = {
  UNAVAILABLE: { dot: "🔴", service: "No disponible", damage: "Activa / sin atender", restore: "No restablecido", tone: "red" },
  INTERMITTENT: { dot: "🟠", service: "Intermitente", damage: "Parcial / controlada", restore: "Intermitente", tone: "orange" },
  AVAILABLE: { dot: "🟢", service: "Disponible", damage: "Resuelta", restore: "Restablecido", tone: "green" },
};

export function statusLabel(status: ReportStatus, group: CategoryGroup | undefined): string {
  const m = STATUS_META[status];
  return group === "DAMAGE" ? m.damage : m.service;
}

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABEL: Record<Severity, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto" };

export const EVENT_TYPES = ["HURRICANE", "EARTHQUAKE", "FLOOD", "FIRE", "LANDSLIDE", "GENERAL"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  HURRICANE: "Huracán",
  EARTHQUAKE: "Sismo",
  FLOOD: "Inundación",
  FIRE: "Incendio",
  LANDSLIDE: "Derrumbe",
  GENERAL: "Emergencia general",
};

export const CONNECTIVITY = ["ONLINE", "OFFLINE"] as const;
export type Connectivity = (typeof CONNECTIVITY)[number];

/** Límites de validación compartidos. */
export const LIMITS = {
  commentMax: 500,
  municipalityMax: 120,
  syncBatchMax: 50,
  /** Precisión GPS (m) a partir de la cual se considera "baja precisión". */
  lowAccuracyMeters: 100,
} as const;
