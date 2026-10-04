import { useCallback, useEffect, useState } from "react";
import type { PublicEvent } from "../../shared/schemas";
import { useSyncState } from "../sync/useSync";
import { getCachedCatalog, getMeta, getReport, listReports, type ReportWithHistory } from "./reports";

/** Recarga datos locales cuando cambia el estado de sincronización. */
function useReloadKey() {
  const s = useSyncState();
  return `${s.syncing}-${s.lastSyncAt}-${s.counts.operations}-${s.counts.failed}`;
}

export function useReports() {
  const key = useReloadKey();
  const [data, setData] = useState<ReportWithHistory[] | null>(null);
  useEffect(() => {
    let alive = true;
    listReports().then((r) => alive && setData(r));
    return () => {
      alive = false;
    };
  }, [key]);
  return data;
}

export function useReport(id: string | undefined) {
  const key = useReloadKey();
  const [data, setData] = useState<ReportWithHistory | null | undefined>(undefined);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    if (id) getReport(id).then((r) => alive && setData(r));
    return () => {
      alive = false;
    };
  }, [id, key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, reload };
}

export interface EventChoice {
  events: PublicEvent[];
  selected: PublicEvent | null;
  loaded: boolean;
}

/** Eventos activos desde la caché local (actualizada por el motor de sincronización). */
export function useEvents(): EventChoice {
  const key = useReloadKey();
  const [state, setState] = useState<EventChoice>({ events: [], selected: null, loaded: false });
  useEffect(() => {
    let alive = true;
    Promise.all([getCachedCatalog(), getMeta("selectedEventId")]).then(([catalog, selectedId]) => {
      if (!alive) return;
      const events = catalog?.events ?? [];
      const specific = events.filter((e) => e.type !== "GENERAL");
      const selected = events.find((e) => e.id === selectedId) ?? (specific.length === 1 ? specific[0] : null) ?? events[0] ?? null;
      setState({ events, selected, loaded: true });
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return state;
}
