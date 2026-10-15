import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type mysql from "mysql2/promise";
import type { Express } from "express";
import type { Db } from "../../server/db/client.js";
import { CELL_SIZES, autoCellSize } from "../../server/services/heatmap.js";
import { createAdmin, createOp, freshDb, testApp } from "./helpers.js";

/**
 * Mapa de calor (solo ADMIN): agregación geográfica en el servidor, filtros, privacidad y
 * reportes sincronizados desde el modo sin conexión.
 */
let db: Db;
let pool: mysql.Pool;
let app: Express;
const PASS = "Contraseña-Segura-2026";
const loc = (latitude: number, longitude: number) => ({ latitude, longitude, accuracy: 10, capturedAt: new Date().toISOString() });
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

beforeAll(async () => {
  ({ db, pool } = await freshDb());
  app = testApp(db);
  await createAdmin(db, "admin@senso.mx", PASS, "ADMIN");
  await createAdmin(db, "viewer@senso.mx", PASS, "VIEWER");
  // Reportes capturados sin conexión y recibidos después vía /sync (mismo camino que la cola offline).
  const ops = [
    createOp({}, { location: loc(23.0605, -109.6977), municipality: "Los Cabos", comment: "Llamar a Juan al 6241234567", connectivity: "OFFLINE", createdAt: daysAgo(1) }),
    createOp({}, { location: loc(23.0607, -109.6975), municipality: "Los Cabos", connectivity: "OFFLINE", createdAt: daysAgo(2) }),
    createOp({}, { category: "water", status: "INTERMITTENT", location: loc(24.1426, -110.3128), municipality: "La Paz", connectivity: "ONLINE" }),
    createOp({}, { category: "flood", location: null, municipality: "La Paz" }),
    createOp({}, { category: "roads", location: loc(0, 0) }),
    createOp({}, { category: "fire", location: loc(22.89, -109.91), createdAt: daysAgo(40) }),
  ];
  const res = await request(app).post("/senso/api/sync").send({ operations: ops });
  expect(res.body.results.every((r: { outcome: string }) => r.outcome === "APPLIED")).toBe(true);
});
afterAll(async () => pool.end());

async function login(email: string) {
  const agent = request.agent(app);
  await agent.post("/senso/api/admin/login").set("X-Senso-Request", "1").send({ email, password: PASS });
  return agent;
}

describe("Autorización del mapa de calor", () => {
  it("sin sesión → 401; VIEWER → 403 (llamada directa a la API); ADMIN → 200", async () => {
    expect((await request(app).get("/senso/api/admin/heatmap")).status).toBe(401);
    const viewer = await login("viewer@senso.mx");
    const denied = await viewer.get("/senso/api/admin/heatmap?days=30&includePoints=1");
    expect(denied.status).toBe(403);
    expect(denied.body).not.toHaveProperty("cells");
    const admin = await login("admin@senso.mx");
    expect((await admin.get("/senso/api/admin/heatmap?days=30")).status).toBe(200);
  });
});

describe("Agregación y ubicación", () => {
  it("totales: los reportes sin coordenadas o con (0,0) se cuentan pero no se dibujan", async () => {
    const admin = await login("admin@senso.mx");
    const r = (await admin.get("/senso/api/admin/heatmap?days=30")).body;
    expect(r.totals).toEqual({ reports: 5, withLocation: 3, withoutLocation: 2, cells: r.cells.length });
    expect(r.cells.reduce((s: number, c: { count: number }) => s + c.count, 0)).toBe(3);
    for (const c of r.cells) expect(Math.abs(c.lat) + Math.abs(c.lng)).toBeGreaterThan(1);
    expect(typeof r.generatedAt).toBe("string");
  });

  it("cada reporte cae en la celda que contiene su coordenada real", async () => {
    const admin = await login("admin@senso.mx");
    const r = (await admin.get("/senso/api/admin/heatmap?days=30&cell=0.001")).body;
    expect(r.cellSizeDeg).toBe(0.001);
    // 23.0605,-109.6977 y 23.0607,-109.6975 comparten la celda [23.060, 23.061) × [-109.698, -109.697).
    expect(r.cells).toEqual(
      expect.arrayContaining([
        { lat: 23.0605, lng: -109.6975, count: 2 },
        { lat: 24.1425, lng: -110.3125, count: 1 },
      ]),
    );
    expect(r.cells).toHaveLength(2);
    for (const c of r.cells) {
      // El centro de celda está a menos de media celda del punto real (no se publica la coordenada exacta).
      expect(c.lat * 1000 % 1).toBeCloseTo(0.5, 6);
    }
  });

  it("zonas de mayor concentración con el municipio declarado", async () => {
    const admin = await login("admin@senso.mx");
    const r = (await admin.get("/senso/api/admin/heatmap?days=30&cell=0.001")).body;
    expect(r.hotspots[0]).toEqual({ lat: 23.0605, lng: -109.6975, count: 2, municipality: "Los Cabos" });
    expect(r.hotspots[1]).toMatchObject({ count: 1, municipality: "La Paz" });
  });

  it("celda automática según la extensión de los datos y celda mínima de ~110 m", () => {
    expect(autoCellSize(null)).toBe(CELL_SIZES[0]);
    expect(autoCellSize({ latSpan: 0.01, lngSpan: 0.01 })).toBe(0.001);
    expect(autoCellSize({ latSpan: 1.1, lngSpan: 0.7 })).toBe(0.025);
    expect(autoCellSize({ latSpan: 200, lngSpan: 300 })).toBe(1);
  });
});

describe("Filtros e indicadores", () => {
  it("tipo, estado, conectividad (offline sincronizado) y periodo actualizan mapa e indicadores", async () => {
    const admin = await login("admin@senso.mx");
    const q = async (qs: string) => (await admin.get(`/senso/api/admin/heatmap?${qs}`)).body;

    const water = await q("days=30&category=water");
    expect(water.totals).toMatchObject({ reports: 1, withLocation: 1 });
    expect(water.byCategory).toEqual([{ category: "water", total: 1 }]);

    const intermittent = await q("days=30&status=INTERMITTENT");
    expect(intermittent.byStatus).toEqual([{ status: "INTERMITTENT", total: 1 }]);

    // Capturados sin conexión (createOp usa OFFLINE por defecto): 4 en el periodo, 2 con coordenadas válidas.
    const offline = await q("days=30&connectivity=OFFLINE");
    expect(offline.totals).toMatchObject({ reports: 4, withLocation: 2, withoutLocation: 2 });
    expect(offline.cells.reduce((s: number, c: { count: number }) => s + c.count, 0)).toBe(2);

    const lastDay = await q("days=1");
    expect(lastDay.totals.reports).toBeLessThan(5);

    // Rango personalizado que solo incluye el reporte de hace 40 días.
    const from = daysAgo(45).slice(0, 10);
    const to = daysAgo(35).slice(0, 10);
    const old = await q(`from=${from}&to=${to}`);
    expect(old.totals).toMatchObject({ reports: 1, withLocation: 1 });
    expect(old.byCategory).toEqual([{ category: "fire", total: 1 }]);

    const zone = await q("days=30&municipality=La%20Paz");
    expect(zone.totals).toMatchObject({ reports: 2, withLocation: 1, withoutLocation: 1 });
  });

  it("sin reportes: respuesta vacía válida (no es un error)", async () => {
    const admin = await login("admin@senso.mx");
    const r = await admin.get("/senso/api/admin/heatmap?from=2001-01-01&to=2001-01-02&includePoints=1");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ totals: { reports: 0, withLocation: 0, withoutLocation: 0, cells: 0 }, cells: [], hotspots: [], byCategory: [], byStatus: [] });
  });

  it("parámetros inválidos → 400", async () => {
    const admin = await login("admin@senso.mx");
    expect((await admin.get("/senso/api/admin/heatmap?cell=0.0001")).status).toBe(400);
    expect((await admin.get("/senso/api/admin/heatmap?status=ATENDIDO")).status).toBe(400);
    expect((await admin.get("/senso/api/admin/heatmap?includePoints=quizas")).status).toBe(400);
  });
});

describe("Privacidad", () => {
  it("la vista general no expone comentarios, dispositivos ni coordenadas exactas", async () => {
    const admin = await login("admin@senso.mx");
    const r = (await admin.get("/senso/api/admin/heatmap?days=30")).body;
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/Juan|6241234567|deviceId|userId|comment/);
    expect(r).not.toHaveProperty("points");
    expect(text).not.toContain("23.0607");
  });

  it("marcadores individuales opcionales: ubicación real, sin comentario ni datos del dispositivo", async () => {
    const admin = await login("admin@senso.mx");
    const r = (await admin.get("/senso/api/admin/heatmap?days=30&includePoints=1")).body;
    expect(r.points).toHaveLength(3);
    expect(r.pointsTruncated).toBe(false);
    const water = r.points.find((p: { category: string }) => p.category === "water");
    expect(water).toMatchObject({ latitude: 24.1426, longitude: -110.3128, status: "INTERMITTENT" });
    expect(Object.keys(water).sort()).toEqual(["category", "categoryGroup", "createdAtClient", "folio", "id", "latitude", "longitude", "severity", "status"]);
    expect(JSON.stringify(r.points)).not.toMatch(/Juan|6241234567/);
  });
});
