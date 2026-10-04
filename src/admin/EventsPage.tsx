import { useCallback, useEffect, useState, type FormEvent } from "react";
import { EVENT_TYPES, EVENT_TYPE_LABEL, type EventType } from "../../shared/catalogs";
import { adminApi } from "../api/client";
import { formatDateTime } from "../utils/format";
import type { AdminEvent, AdminUser } from "./types";

export default function EventsPage({ user }: { user: AdminUser }) {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [type, setType] = useState<EventType>("HURRICANE");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isAdmin = user.role === "ADMIN";

  const load = useCallback(() => adminApi.get<{ events: AdminEvent[] }>("/events").then((r) => setEvents(r.events)), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await adminApi.post("/events", { type, name });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear");
    }
  }

  async function toggle(ev: AdminEvent) {
    setError(null);
    try {
      await adminApi.patch(`/events/${ev.id}`, { isActive: !ev.isActive });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar");
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-black">Eventos / emergencias</h1>
      <p className="text-sm opacity-75">Los eventos activos se descargan a los dispositivos para que los reportes se asocien aunque no haya conexión.</p>
      {isAdmin && (
        <form onSubmit={(e) => void create(e)} className="grid gap-3 rounded-2xl bg-white p-4 shadow-sm md:grid-cols-[12rem_1fr_auto]">
          <label className="block">
            <span className="text-xs font-semibold opacity-70">Tipo</span>
            <select value={type} onChange={(e) => setType(e.target.value as EventType)} className="min-h-11 w-full rounded-lg border px-2" data-testid="event-type">
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold opacity-70">Nombre</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={120}
              placeholder="Ej. Polo 2026"
              className="min-h-11 w-full rounded-lg border px-3"
              data-testid="event-name"
            />
          </label>
          <button type="submit" className="min-h-11 self-end rounded-lg bg-tech-600 px-5 font-bold text-white" data-testid="event-create">
            Crear y activar
          </button>
        </form>
      )}
      {error && <p className="rounded-xl bg-alert-100 p-3 font-semibold text-alert-700">{error}</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {events.map((ev) => (
          <li key={ev.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase opacity-70">{EVENT_TYPE_LABEL[ev.type as EventType] ?? ev.type}</p>
            <p className="text-xl font-black">{ev.name}</p>
            <p className="mt-1 text-sm">
              {ev.isActive ? "🟢 Activo" : "⚪ Inactivo"} · {ev.reports} reportes · desde {formatDateTime(ev.startedAt)}
            </p>
            {ev.isDefault && <p className="mt-1 text-xs opacity-70">Evento por defecto para reportes sin evento asignado.</p>}
            {isAdmin && !ev.isDefault && (
              <button type="button" onClick={() => void toggle(ev)} className="mt-3 min-h-11 rounded-lg border px-4 text-sm font-bold">
                {ev.isActive ? "Desactivar" : "Activar"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
