import type { ReportStatus } from "../../shared/catalogs";

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: "ADMIN" | "VIEWER";
}

export interface Summary {
  kpis: { total: number; today: number; pending: number; servicesAffected: number; restored: number; withLocation: number; offlineCaptured: number };
  byCategory: { category: string; total: number }[];
  byStatus: { status: ReportStatus; total: number }[];
  generatedAt: string;
}

export interface AdminReport {
  id: number;
  folio: string;
  eventId: number;
  eventName: string;
  categoryGroup: string;
  category: string;
  initialStatus: ReportStatus;
  currentStatus: ReportStatus;
  severity: "LOW" | "MEDIUM" | "HIGH";
  comment: string | null;
  municipality: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  createdAtClient: string;
  connectivity: "ONLINE" | "OFFLINE";
  receivedAt: string;
  lastStatusAt: string;
}

export interface AdminEvent {
  id: number;
  type: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isDefault: boolean;
  startedAt: string;
  endedAt: string | null;
  reports: number;
}

export interface FilterState {
  eventId: string;
  group: string;
  category: string;
  status: string;
  period: string;
  from: string;
  to: string;
  municipality: string;
  connectivity: string;
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
}

export const EMPTY_FILTERS: FilterState = {
  eventId: "",
  group: "",
  category: "",
  status: "",
  period: "7",
  from: "",
  to: "",
  municipality: "",
  connectivity: "",
  bbox: null,
};

export function filtersToQuery(f: FilterState): string {
  const q = new URLSearchParams();
  if (f.eventId) q.set("eventId", f.eventId);
  if (f.group) q.set("group", f.group);
  if (f.category) q.set("category", f.category);
  if (f.status) q.set("status", f.status);
  if (f.period === "custom") {
    if (f.from) q.set("from", f.from);
    if (f.to) q.set("to", f.to);
  } else if (f.period) {
    q.set("days", f.period);
  }
  if (f.municipality) q.set("municipality", f.municipality);
  if (f.connectivity) q.set("connectivity", f.connectivity);
  if (f.bbox) {
    q.set("minLat", f.bbox.minLat.toFixed(5));
    q.set("maxLat", f.bbox.maxLat.toFixed(5));
    q.set("minLng", f.bbox.minLng.toFixed(5));
    q.set("maxLng", f.bbox.maxLng.toFixed(5));
  }
  return q.toString();
}
