import { describe, expect, it, vi } from "vitest";
import { getDB } from "../../src/offline/db";
import { addReportUpdate, countOutbox, createReport, getReport, listOutbox } from "../../src/storage/reports";
import { SyncEngine, backoffMs, recoverInterrupted } from "../../src/sync/engine";
import { FakeServer } from "./fakeServer";
import { setOnline } from "./setup";

const loc = { latitude: 19.4326, longitude: -99.1332, accuracy: 15, capturedAt: new Date().toISOString() };

function makeEngine(server: FakeServer, clock = { t: Date.now() }) {
  return new SyncEngine({
    sendBatch: server.sendBatch,
    fetchCatalog: async () => undefined,
    isOnline: () => navigator.onLine,
    now: () => clock.t,
  });
}

const newReport = (online = navigator.onLine) =>
  createReport({ category: "electricity", status: "UNAVAILABLE", severity: "HIGH", location: loc, event: null, online });

describe("Motor de sincronización", () => {
  it("A) con conexión: envía, recibe confirmación y marca SYNCED con folio oficial", async () => {
    const server = new FakeServer();
    const engine = makeEngine(server);
    const r = await newReport(true);

    const res = await engine.sync();
    expect(res).toMatchObject({ sent: 1, synced: 1, failed: 0 });
    const saved = await getReport(r.id);
    expect(saved?.report.syncStatus).toBe("SYNCED");
    expect(saved?.report.folio).toBe("SENSO-2026-000001");
    expect(saved?.report.serverId).toBe(1);
    expect(await listOutbox()).toHaveLength(0);
    expect(engine.state.counts.reports).toBe(0);
  });

  it("B) sin conexión: no intenta enviar y el reporte sigue PENDING", async () => {
    setOnline(false);
    const server = new FakeServer();
    const engine = makeEngine(server);
    const r = await newReport();
    const res = await engine.sync();
    expect(res.skipped).toBe("offline");
    expect(server.requests).toHaveLength(0);
    expect((await getReport(r.id))?.report.syncStatus).toBe("PENDING");
  });

  it("G/H) al recuperar la conexión sincroniza automáticamente (evento online)", async () => {
    setOnline(false);
    const server = new FakeServer();
    const engine = makeEngine(server);
    await engine.start();
    const a = await newReport();
    const b = await newReport();
    await engine.refreshCounts();
    expect(engine.state.counts.reports).toBe(2);
    expect(engine.state.online).toBe(false);

    setOnline(true); // dispara "online"
    expect(engine.state.justReconnected).toBe(true);
    await vi.waitFor(async () => expect((await getReport(b.id))?.report.syncStatus).toBe("SYNCED"));
    expect((await getReport(a.id))?.report.syncStatus).toBe("SYNCED");
    // FIFO: el primero creado recibe el primer folio
    expect((await getReport(a.id))?.report.folio).toBe("SENSO-2026-000001");
    expect(engine.state.counts.reports).toBe(0);
    engine.stop();
  });

  it("I) si falla la red: FAILED con error y reintento programado; nunca SYNCED", async () => {
    const server = new FakeServer();
    server.failNext = 1;
    const clock = { t: 1_000_000 };
    const engine = makeEngine(server, clock);
    const r = await newReport(true);

    const res = await engine.sync();
    expect(res).toMatchObject({ sent: 1, synced: 0, failed: 1 });
    const saved = await getReport(r.id);
    expect(saved?.report.syncStatus).toBe("FAILED");
    expect(saved?.report.folio).toBeNull();
    expect(saved?.report.lastError).toMatch(/No se pudo enviar/);
    const [item] = await listOutbox();
    expect(item).toMatchObject({ status: "FAILED", attempts: 1, retriable: true, nextAttemptAt: clock.t + backoffMs(1) });
    expect(engine.state.counts.failed).toBe(1);
  });

  it("J) reintento: respeta la espera automática y el botón fuerza el reintento", async () => {
    const server = new FakeServer();
    server.failNext = 1;
    const clock = { t: 1_000_000 };
    const engine = makeEngine(server, clock);
    const r = await newReport(true);
    await engine.sync();

    // Antes de la espera: no se reintenta automáticamente
    expect((await engine.sync()).sent).toBe(0);
    // Tras la espera, el reintento automático funciona
    clock.t += backoffMs(1) + 1;
    expect(await engine.sync()).toMatchObject({ sent: 1, synced: 1 });
    expect((await getReport(r.id))?.report.syncStatus).toBe("SYNCED");

    // Reintento manual inmediato ("Sincronizar ahora")
    server.failNext = 1;
    const r2 = await newReport(true);
    await engine.sync();
    expect((await getReport(r2.id))?.report.syncStatus).toBe("FAILED");
    expect(await engine.sync({ force: true })).toMatchObject({ synced: 1 });
    expect((await getReport(r2.id))?.report.syncStatus).toBe("SYNCED");
  });

  it("red aparente sin servidor alcanzable: se detecta como sin conexión y la cola queda intacta", async () => {
    const server = new FakeServer();
    let reachable = false;
    const engine = new SyncEngine({
      sendBatch: server.sendBatch,
      fetchCatalog: async () => {
        if (!reachable) throw new TypeError("Failed to fetch");
      },
      isOnline: () => true, // navigator.onLine dice "en línea"…
      now: () => Date.now(),
    });
    const r = await newReport(true);
    expect(await engine.sync()).toMatchObject({ skipped: "unreachable", sent: 0 });
    expect(engine.state.reachable).toBe(false);
    expect(server.requests).toHaveLength(0);
    expect((await getReport(r.id))?.report.syncStatus).toBe("PENDING"); // ni FAILED ni SYNCED
    expect((await listOutbox())[0].attempts).toBe(0);

    reachable = true; // vuelve la conexión real
    expect(await engine.sync()).toMatchObject({ synced: 1 });
    expect(engine.state).toMatchObject({ reachable: true, justReconnected: true });
    expect((await getReport(r.id))?.report.syncStatus).toBe("SYNCED");
  });

  it("backoff exponencial con tope de 10 minutos", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([5000, 10000, 20000, 40000]);
    expect(backoffMs(30)).toBe(600000);
  });

  it("K) evita duplicados: si se pierde la respuesta, el reenvío no crea otro registro", async () => {
    const server = new FakeServer();
    server.loseResponseNext = 1; // el servidor guarda pero el cliente no recibe respuesta
    const engine = makeEngine(server);
    const r = await newReport(true);

    await engine.sync();
    expect((await getReport(r.id))?.report.syncStatus).toBe("FAILED"); // no confirmado → no SYNCED
    expect(server.reports.size).toBe(1);

    const res = await engine.sync({ force: true });
    expect(res.synced).toBe(1);
    expect(server.reports.size).toBe(1); // sigue habiendo UN solo reporte
    // Mismo clientOperationId y payload idéntico en ambos envíos
    expect(server.requests[0][0]).toEqual(server.requests[1][0]);
    expect((await getReport(r.id))?.report.folio).toBe("SENSO-2026-000001");
  });

  it("recupera operaciones que quedaron en SYNCING al cerrar la app a medio envío", async () => {
    const r = await newReport(true);
    const db = await getDB();
    const [item] = await db.getAll("outbox");
    await db.put("outbox", { ...item, status: "SYNCING" });
    await db.put("reports", { ...(await db.get("reports", r.id))!, syncStatus: "SYNCING" });

    expect(await recoverInterrupted()).toBe(1);
    expect((await listOutbox())[0].status).toBe("PENDING");
    expect((await getReport(r.id))?.report.syncStatus).toBe("PENDING");

    const server = new FakeServer();
    await makeEngine(server).sync();
    expect((await getReport(r.id))?.report.syncStatus).toBe("SYNCED");
  });

  it("M) actualización offline de un reporte no sincronizado: se envía después de su reporte", async () => {
    setOnline(false);
    const server = new FakeServer();
    const engine = makeEngine(server);
    const r = await newReport();
    await addReportUpdate({ reportId: r.id, status: "AVAILABLE", comment: "Ya hay luz", location: null, online: false, now: new Date(Date.now() + 1000) });
    expect(await countOutbox()).toMatchObject({ operations: 2, reports: 1 });

    setOnline(true);
    await engine.sync();
    expect(server.requests[0].map((o) => o.type)).toEqual(["CREATE_REPORT", "ADD_UPDATE"]);
    const saved = await getReport(r.id);
    expect(saved?.syncStatus).toBe("SYNCED");
    expect(saved?.updates[0].syncStatus).toBe("SYNCED");
    expect(server.reports.get(r.id)?.status).toBe("AVAILABLE");
  });

  it("M) una actualización no se envía mientras su reporte falla; luego se sincroniza", async () => {
    const server = new FakeServer();
    const engine = makeEngine(server);
    const r = await newReport(true);
    await addReportUpdate({ reportId: r.id, status: "INTERMITTENT", location: null, online: false, now: new Date(Date.now() + 1000) });
    server.rejectOps.add(r.clientOperationId); // el reporte es rechazado

    await engine.sync();
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].map((o) => o.type)).toEqual(["CREATE_REPORT", "ADD_UPDATE"]);
    // La actualización viajó en el mismo lote pero su reporte fue rechazado
    const saved = await getReport(r.id);
    expect(saved?.report.syncStatus).toBe("FAILED");
    expect(saved?.updates[0].syncStatus).toBe("FAILED");

    // Error permanente: no se reintenta automáticamente…
    expect((await engine.sync()).sent).toBe(0);
    // …pero el usuario puede forzar el reintento cuando se corrija la causa
    server.rejectOps.clear();
    await engine.sync({ force: true });
    expect((await getReport(r.id))?.syncStatus).toBe("SYNCED");
  });

  it("si el servidor no confirma una operación, queda FAILED (no se asume éxito)", async () => {
    const engine = new SyncEngine({
      sendBatch: async () => ({ results: [], serverTime: new Date().toISOString() }),
      fetchCatalog: async () => undefined,
      isOnline: () => true,
      now: () => Date.now(),
    });
    const r = await newReport(true);
    await engine.sync();
    expect((await getReport(r.id))?.report.syncStatus).toBe("FAILED");
    expect(await listOutbox()).toHaveLength(1);
  });

  it("respuesta malformada del servidor → FAILED", async () => {
    const engine = new SyncEngine({
      sendBatch: async () => ({ nope: true }) as never,
      fetchCatalog: async () => undefined,
      isOnline: () => true,
      now: () => Date.now(),
    });
    const r = await newReport(true);
    await engine.sync();
    expect((await getReport(r.id))?.report.syncStatus).toBe("FAILED");
  });

  it("no ejecuta dos sincronizaciones simultáneas", async () => {
    const server = new FakeServer();
    const engine = makeEngine(server);
    await newReport(true);
    const [a, b] = await Promise.all([engine.sync(), engine.sync()]);
    expect(a).toBe(b);
    expect(server.requests).toHaveLength(1);
  });

  it("procesa colas grandes en lotes de 50", async () => {
    const server = new FakeServer();
    const engine = makeEngine(server);
    for (let i = 0; i < 120; i++) await newReport(false);
    const res = await engine.sync();
    expect(res.synced).toBe(120);
    expect(server.requests.map((r) => r.length)).toEqual([50, 50, 20]);
  });
});
