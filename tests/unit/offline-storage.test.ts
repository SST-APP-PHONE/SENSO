import { describe, expect, it } from "vitest";
import { closeDBForTests, getDB } from "../../src/offline/db";
import { addReportUpdate, countOutbox, createReport, getDeviceId, getReport, listOutbox, listReports } from "../../src/storage/reports";
import { setOnline } from "./setup";

const loc = { latitude: 23.0605, longitude: -109.6977, accuracy: 12, capturedAt: new Date().toISOString() };

describe("Almacenamiento offline (IndexedDB)", () => {
  it("C) crea un reporte sin conexión: queda en IndexedDB y en la cola como PENDING", async () => {
    setOnline(false);
    const r = await createReport({ category: "electricity", status: "UNAVAILABLE", severity: "HIGH", comment: "  Sin luz en la colonia  ", location: loc, event: null, online: navigator.onLine });

    expect(r.syncStatus).toBe("PENDING");
    expect(r.connectivity).toBe("OFFLINE");
    expect(r.comment).toBe("Sin luz en la colonia");
    expect(r.localFolio).toMatch(/^SENSO-\d{4}-P-[2-9A-HJ-NP-Z]{6}$/);
    expect(r.folio).toBeNull();
    expect(r.clientOperationId).not.toBe(r.id);

    const outbox = await listOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ type: "CREATE_REPORT", status: "PENDING", clientOperationId: r.clientOperationId, reportId: r.id });
    expect(outbox[0].payload).toMatchObject({ reportId: r.id, category: "electricity", location: loc });
    expect(await countOutbox()).toEqual({ operations: 1, reports: 1, failed: 0 });
  });

  it("D/E/F) los datos sobreviven a cerrar y volver a abrir la app", async () => {
    setOnline(false);
    const r = await createReport({ category: "water", status: "INTERMITTENT", severity: "MEDIUM", location: null, event: null, online: false });
    const deviceId = await getDeviceId();

    await closeDBForTests(); // simula cerrar el navegador (se pierde la conexión en memoria)

    const reopened = await listReports();
    expect(reopened).toHaveLength(1);
    expect(reopened[0].report.id).toBe(r.id);
    expect(reopened[0].syncStatus).toBe("PENDING");
    expect(await getDeviceId()).toBe(deviceId);
    expect((await listOutbox())[0].clientOperationId).toBe(r.clientOperationId);
  });

  it("guardar reporte y operación de cola es atómico", async () => {
    const db = await getDB();
    // Forzar fallo: ocupar el id del outbox con antelación no es posible desde fuera,
    // así que se verifica que un reporte y su operación siempre aparecen juntos.
    for (let i = 0; i < 5; i++) await createReport({ category: "gas", status: "UNAVAILABLE", severity: "LOW", location: null, event: null, online: true });
    const reports = await db.getAll("reports");
    const outbox = await db.getAll("outbox");
    expect(reports).toHaveLength(5);
    expect(new Set(outbox.map((o) => o.reportId))).toEqual(new Set(reports.map((r) => r.id)));
    // Orden FIFO estrictamente creciente
    const seqs = (await listOutbox()).map((o) => o.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(5);
  });

  it("nunca pierde el reporte por falta de GPS (ubicación nula)", async () => {
    const r = await createReport({ category: "flood", status: "UNAVAILABLE", severity: "HIGH", location: null, event: null, online: false });
    expect((await getReport(r.id))?.report.location).toBeNull();
  });

  it("L) actualiza un reporte sin conexión: historial y nueva operación en cola", async () => {
    setOnline(false);
    const r = await createReport({ category: "electricity", status: "UNAVAILABLE", severity: "HIGH", location: loc, event: null, online: false });
    const t1 = new Date(Date.now() + 60_000);
    const t2 = new Date(Date.now() + 120_000);
    await addReportUpdate({ reportId: r.id, status: "INTERMITTENT", comment: "Regresó a ratos", location: null, online: false, now: t1 });
    await addReportUpdate({ reportId: r.id, status: "AVAILABLE", location: loc, online: false, now: t2 });

    const detail = await getReport(r.id);
    expect(detail?.report.currentStatus).toBe("AVAILABLE");
    expect(detail?.report.status).toBe("UNAVAILABLE"); // el estado original se conserva
    expect(detail?.updates.map((u) => u.status)).toEqual(["INTERMITTENT", "AVAILABLE"]);
    expect(detail?.syncStatus).toBe("PENDING");
    const outbox = await listOutbox();
    expect(outbox.map((o) => o.type)).toEqual(["CREATE_REPORT", "ADD_UPDATE", "ADD_UPDATE"]);
    expect(await countOutbox()).toEqual({ operations: 3, reports: 1, failed: 0 });
  });

  it("una actualización con hora anterior no reemplaza el estado vigente", async () => {
    const r = await createReport({ category: "water", status: "UNAVAILABLE", severity: "HIGH", location: null, event: null, online: false });
    await addReportUpdate({ reportId: r.id, status: "AVAILABLE", location: null, online: false, now: new Date(Date.now() + 120_000) });
    await addReportUpdate({ reportId: r.id, status: "INTERMITTENT", location: null, online: false, now: new Date(Date.now() + 60_000) });
    expect((await getReport(r.id))?.report.currentStatus).toBe("AVAILABLE");
  });

  it("rechaza actualizar un reporte inexistente sin dejar operaciones huérfanas", async () => {
    await expect(addReportUpdate({ reportId: "00000000-0000-4000-8000-000000000000", status: "AVAILABLE", location: null, online: false })).rejects.toThrow();
    expect(await listOutbox()).toHaveLength(0);
  });
});
