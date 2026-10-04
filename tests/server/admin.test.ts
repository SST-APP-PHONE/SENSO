import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type mysql from "mysql2/promise";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "../../server/db/client.js";
import { adminUsers, auditLog } from "../../server/db/schema.js";
import { csvCell } from "../../server/services/monitoring.js";
import { createAdmin, createOp, freshDb, testApp, updateOp } from "./helpers.js";

let db: Db;
let pool: mysql.Pool;
let app: Express;
const PASS = "Contraseña-Segura-2026";

beforeAll(async () => {
  ({ db, pool } = await freshDb());
  app = testApp(db);
  await createAdmin(db, "admin@senso.mx", PASS, "ADMIN");
  await createAdmin(db, "viewer@senso.mx", PASS, "VIEWER");
  await createAdmin(db, "lock@senso.mx", PASS, "VIEWER");
  // Datos: 3 reportes (uno restablecido, uno sin ubicación, uno con comentario peligroso para CSV)
  const a = createOp();
  const b = createOp({}, { category: "water", status: "INTERMITTENT", location: null, municipality: "La Paz", connectivity: "ONLINE" });
  const c = createOp({}, { category: "flood", comment: "=HYPERLINK(\"http://x\")", location: { latitude: 23.1, longitude: -109.7, accuracy: 40, capturedAt: new Date().toISOString() } });
  await request(app).post("/api/sync").send({ operations: [a, b, c, updateOp(a.payload.reportId, "AVAILABLE", new Date(Date.now() + 1000))] });
});
afterAll(async () => pool.end());

async function login(email: string, password = PASS) {
  const agent = request.agent(app);
  const res = await agent.post("/senso/api/admin/login").set("X-Senso-Request", "1").send({ email, password });
  return { agent, res };
}

describe("Centro de monitoreo (API admin)", () => {
  it("rechaza acceso sin sesión", async () => {
    for (const p of ["/me", "/summary", "/reports", "/map", "/export.csv", "/events"]) {
      expect((await request(app).get(`/senso/api/admin${p}`)).status).toBe(401);
    }
  });

  it("rechaza sesiones falsificadas", async () => {
    const res = await request(app).get("/senso/api/admin/summary").set("Cookie", "senso_admin=eyJzdWIiOjEsInJvbGUiOiJBRE1JTiIsInZlciI6MSwiZXhwIjo5OTk5OTk5OTk5fQ.firmafalsa");
    expect(res.status).toBe(401);
  });

  it("exige cabecera anti-CSRF en peticiones que modifican", async () => {
    const res = await request(app).post("/senso/api/admin/login").send({ email: "admin@senso.mx", password: PASS });
    expect(res.status).toBe(403);
  });

  it("login correcto: cookie httpOnly SameSite=Strict, sin exponer el hash", async () => {
    const { res } = await login("admin@senso.mx");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: expect.any(Number), email: "admin@senso.mx", name: "admin@senso.mx", role: "ADMIN" });
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });

  it("login incorrecto y bloqueo tras 5 intentos fallidos", async () => {
    expect((await login("nadie@senso.mx", "x")).res.status).toBe(401);
    for (let i = 0; i < 5; i++) expect((await login("lock@senso.mx", "mal")).res.status).toBe(401);
    expect((await login("lock@senso.mx")).res.status).toBe(429); // incluso con la contraseña correcta
    const [u] = await db.select().from(adminUsers).where(eq(adminUsers.email, "lock@senso.mx"));
    expect(u.lockedUntil).not.toBeNull();
  });

  it("KPIs y estadísticas calculados desde la BD", async () => {
    const { agent } = await login("viewer@senso.mx");
    const res = await agent.get("/senso/api/admin/summary");
    expect(res.status).toBe(200);
    expect(res.body.kpis).toMatchObject({ total: 3, today: 3, pending: 2, servicesAffected: 1, restored: 1, withLocation: 2, offlineCaptured: 2 });
    expect(res.body.byCategory).toHaveLength(3);
  });

  it("filtros: categoría, estado, municipio, conectividad, zona (bbox) y fechas", async () => {
    const { agent } = await login("viewer@senso.mx");
    const q = async (qs: string) => (await agent.get(`/senso/api/admin/reports?${qs}`)).body.total;
    expect(await q("category=water")).toBe(1);
    expect(await q("status=AVAILABLE")).toBe(1);
    expect(await q("municipality=Paz")).toBe(1);
    expect(await q("connectivity=ONLINE")).toBe(1);
    expect(await q("group=DAMAGE")).toBe(1);
    expect(await q("minLat=23.05&maxLat=23.07&minLng=-109.70&maxLng=-109.69")).toBe(1);
    expect(await q("days=7")).toBe(3);
    expect(await q("from=2000-01-01&to=2000-01-02")).toBe(0);
    expect((await agent.get("/senso/api/admin/reports?category=';DROP TABLE reports;--")).status).toBe(400);
    expect((await agent.get("/senso/api/admin/reports?municipality=%25")).body.total).toBe(0); // % literal, no comodín
  });

  it("mapa: solo reportes con ubicación, con folio/servicio/estado/fecha", async () => {
    const { agent } = await login("viewer@senso.mx");
    const res = await agent.get("/senso/api/admin/map");
    expect(res.body.points).toHaveLength(2);
    expect(res.body.points[0]).toEqual(
      expect.objectContaining({ folio: expect.stringMatching(/^SENSO-\d{4}-\d{6}$/), category: expect.any(String), status: expect.any(String), latitude: expect.any(Number), createdAtClient: expect.any(String) }),
    );
  });

  it("detalle con historial", async () => {
    const { agent } = await login("viewer@senso.mx");
    const list = await agent.get("/senso/api/admin/reports?status=AVAILABLE");
    const detail = await agent.get(`/senso/api/admin/reports/${list.body.rows[0].id}`);
    expect(detail.body.report.initialStatus).toBe("UNAVAILABLE");
    expect(detail.body.history.map((h: { status: string }) => h.status)).toEqual(["AVAILABLE"]);
    expect((await agent.get("/senso/api/admin/reports/abc")).status).toBe(400);
    expect((await agent.get("/senso/api/admin/reports/99999")).status).toBe(404);
  });

  it("exportación CSV (solo ADMIN), con protección contra inyección de fórmulas", async () => {
    const viewer = await login("viewer@senso.mx");
    expect((await viewer.agent.get("/senso/api/admin/export.csv")).status).toBe(403);
    const { agent } = await login("admin@senso.mx");
    const res = await agent.get("/senso/api/admin/export.csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const lines = res.text.trim().split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("folio,evento");
    expect(res.text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("a,b")).toBe('"a,b"');
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "EXPORT_CSV"));
    expect(audits.length).toBeGreaterThan(0);
  });

  it("eventos: ADMIN crea/desactiva; VIEWER no puede; validación", async () => {
    const viewer = await login("viewer@senso.mx");
    expect((await viewer.agent.post("/senso/api/admin/events").set("X-Senso-Request", "1").send({ type: "HURRICANE", name: "X" })).status).toBe(403);
    const { agent } = await login("admin@senso.mx");
    const bad = await agent.post("/senso/api/admin/events").set("X-Senso-Request", "1").send({ type: "ZOMBIES", name: "X" });
    expect(bad.status).toBe(400);
    const created = await agent.post("/senso/api/admin/events").set("X-Senso-Request", "1").send({ type: "HURRICANE", name: "Polo 2026" });
    expect(created.status).toBe(201);
    let catalog = await request(app).get("/api/catalog");
    expect(catalog.body.events.map((e: { name: string }) => e.name)).toContain("Polo 2026");
    await agent.patch(`/senso/api/admin/events/${created.body.id}`).set("X-Senso-Request", "1").send({ isActive: false });
    catalog = await request(app).get("/api/catalog");
    expect(catalog.body.events.map((e: { name: string }) => e.name)).not.toContain("Polo 2026");
  });

  it("auditoría guarda solo la IP truncada, nunca la completa", async () => {
    const rows = await db.select().from(auditLog);
    for (const r of rows) if (r.ipPrefix) expect(r.ipPrefix).toMatch(/(\.0\/24|::\/48)$/);
  });

  it("logout invalida la cookie del navegador", async () => {
    const { agent } = await login("admin@senso.mx");
    await agent.post("/senso/api/admin/logout").set("X-Senso-Request", "1");
    expect((await agent.get("/senso/api/admin/me")).status).toBe(401);
  });

  it("no expone detalles internos en errores ni cabeceras", async () => {
    const res = await request(app).get("/senso/api/no-existe");
    expect(res.status).toBe(404);
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-robots-tag"]).toBe("noindex");
  });
});

describe("Rate limiting", () => {
  it("limita /sync a 60 solicitudes por minuto por IP", async () => {
    const limited = testApp(db, { rateLimit: true });
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await request(limited).post("/api/sync").send({ operations: [] })).status;
    expect(last).toBe(429);
  });
});
