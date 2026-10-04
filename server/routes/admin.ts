import { Router, type Request } from "express";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { EVENT_TYPES } from "../../shared/catalogs.js";
import { cleanText } from "../../shared/schemas.js";
import type { Db } from "../db/client.js";
import { adminUsers, auditLog, events, reports } from "../db/schema.js";
import type { ServerConfig } from "../lib/config.js";
import { DUMMY_HASH, verifyPassword } from "../lib/password.js";
import { ipPrefix } from "../lib/privacy.js";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, issueSession } from "../lib/session.js";
import { requireAdmin } from "../middleware/auth.js";
import { exportCsv, filtersSchema, getMapPoints, getReportDetail, getSummary, listMunicipalities, listReports } from "../services/monitoring.js";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(190),
  password: z.string().min(1).max(200),
});

const createEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  name: cleanText(120).pipe(z.string().min(2)),
  description: cleanText(1000).nullable().optional(),
  startedAt: z.string().datetime({ offset: true }).optional(),
  isActive: z.boolean().optional(),
});

const patchEventSchema = z.object({
  name: cleanText(120).pipe(z.string().min(2)).optional(),
  description: cleanText(1000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export function adminRouter(db: Db, config: ServerConfig, loginLimiter: import("express").RequestHandler): Router {
  const r = Router();
  const viewer = requireAdmin(db, config.adminSecret, "VIEWER");
  const admin = requireAdmin(db, config.adminSecret, "ADMIN");

  const audit = (req: Request, action: string, entity?: string, entityId?: string | number, details?: unknown) =>
    db.insert(auditLog).values({
      adminUserId: req.admin?.id ?? null,
      action,
      entity: entity ?? null,
      entityId: entityId !== undefined ? String(entityId) : null,
      details: details ?? null,
      ipPrefix: ipPrefix(req.ip),
      createdAt: new Date(),
    });

  const cookieOpts = {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "strict" as const,
    path: "/",
  };

  r.post("/login", loginLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Credenciales inválidas" });
    const { email, password } = parsed.data;
    const now = new Date();
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
    if (user?.lockedUntil && user.lockedUntil > now) {
      return res.status(429).json({ error: "Cuenta bloqueada temporalmente. Intenta más tarde." });
    }
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.isActive) {
      if (user) {
        const attempts = user.failedAttempts + 1;
        await db
          .update(adminUsers)
          .set({
            failedAttempts: attempts >= MAX_FAILED_ATTEMPTS ? 0 : attempts,
            lockedUntil: attempts >= MAX_FAILED_ATTEMPTS ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : user.lockedUntil,
          })
          .where(eq(adminUsers.id, user.id));
      }
      await db.insert(auditLog).values({ action: "LOGIN_FAILED", details: { email }, ipPrefix: ipPrefix(req.ip), createdAt: now });
      return res.status(401).json({ error: "Correo o contraseña incorrectos" });
    }
    await db.update(adminUsers).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: now }).where(eq(adminUsers.id, user.id));
    const role = user.role === "ADMIN" ? "ADMIN" : "VIEWER";
    const token = issueSession({ sub: user.id, role, ver: user.sessionVersion }, config.adminSecret);
    res.cookie(SESSION_COOKIE, token, { ...cookieOpts, maxAge: SESSION_TTL_SECONDS * 1000 });
    await db.insert(auditLog).values({ adminUserId: user.id, action: "LOGIN", ipPrefix: ipPrefix(req.ip), createdAt: now });
    res.json({ id: user.id, email: user.email, name: user.name, role });
  });

  r.post("/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, cookieOpts);
    res.json({ ok: true });
  });

  r.get("/me", viewer, (req, res) => res.json(req.admin));

  const parseFilters = (req: Request) => filtersSchema.safeParse(req.query);

  r.get("/summary", viewer, async (req, res) => {
    const f = parseFilters(req);
    if (!f.success) return res.status(400).json({ error: "Filtros inválidos" });
    res.json(await getSummary(db, f.data, config.timezone));
  });

  r.get("/reports", viewer, async (req, res) => {
    const f = parseFilters(req);
    const paging = z
      .object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) })
      .safeParse(req.query);
    if (!f.success || !paging.success) return res.status(400).json({ error: "Filtros inválidos" });
    res.json(await listReports(db, f.data, paging.data.page, paging.data.pageSize));
  });

  r.get("/reports/:id", viewer, async (req, res) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Identificador inválido" });
    const detail = await getReportDetail(db, id.data);
    if (!detail) return res.status(404).json({ error: "No encontrado" });
    res.json(detail);
  });

  r.get("/map", viewer, async (req, res) => {
    const f = parseFilters(req);
    if (!f.success) return res.status(400).json({ error: "Filtros inválidos" });
    res.json(await getMapPoints(db, f.data));
  });

  r.get("/municipalities", viewer, async (_req, res) => res.json({ municipalities: await listMunicipalities(db) }));

  r.get("/export.csv", admin, async (req, res) => {
    const f = parseFilters(req);
    if (!f.success) return res.status(400).json({ error: "Filtros inválidos" });
    await audit(req, "EXPORT_CSV", "reports", undefined, f.data);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="senso-reportes-${stamp}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    for await (const chunk of exportCsv(db, f.data)) res.write(chunk);
    res.end();
  });

  r.get("/events", viewer, async (_req, res) => {
    const rows = await db
      .select({
        id: events.id,
        type: events.type,
        name: events.name,
        description: events.description,
        isActive: events.isActive,
        isDefault: events.isDefault,
        startedAt: events.startedAt,
        endedAt: events.endedAt,
        reports: sql<number>`(SELECT COUNT(*) FROM ${reports} WHERE ${reports.eventId} = ${events.id})`,
      })
      .from(events)
      .orderBy(desc(events.isActive), asc(events.isDefault), desc(events.startedAt));
    res.json({ events: rows.map((e) => ({ ...e, reports: Number(e.reports) })) });
  });

  r.post("/events", admin, async (req, res) => {
    const parsed = createEventSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Datos del evento inválidos" });
    const now = new Date();
    const d = parsed.data;
    const [created] = await db
      .insert(events)
      .values({
        type: d.type,
        name: d.name,
        description: d.description ?? null,
        isActive: d.isActive ?? true,
        isDefault: false,
        startedAt: d.startedAt ? new Date(d.startedAt) : now,
        createdByAdminId: req.admin!.id,
        createdAt: now,
        updatedAt: now,
      })
      .$returningId();
    await audit(req, "EVENT_CREATE", "event", created.id, { type: d.type, name: d.name });
    res.status(201).json({ id: created.id });
  });

  r.patch("/events/:id", admin, async (req, res) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    const parsed = patchEventSchema.safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ error: "Datos inválidos" });
    const [ev] = await db.select().from(events).where(eq(events.id, id.data)).limit(1);
    if (!ev) return res.status(404).json({ error: "No encontrado" });
    const now = new Date();
    const d = parsed.data;
    await db
      .update(events)
      .set({
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive, endedAt: d.isActive ? null : now } : {}),
        updatedAt: now,
      })
      .where(eq(events.id, ev.id));
    await audit(req, "EVENT_UPDATE", "event", ev.id, d);
    res.json({ ok: true });
  });

  return r;
}
