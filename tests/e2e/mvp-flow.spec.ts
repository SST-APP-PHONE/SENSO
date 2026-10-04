import { expect, test } from "@playwright/test";
import { ADMIN } from "./global-setup.js";
import { query } from "./db.js";
import { createReportUI, launchProfile, newProfileDir, waitForServiceWorker } from "./helpers.js";

/**
 * Flujo MVP completo (A–M):
 * abrir → nuevo reporte → servicio → estado → GPS → guardar SIN INTERNET → cerrar navegador →
 * reabrir sin internet → consultar → actualizar offline → volver con internet → sincronizar →
 * servidor recibe (sin duplicados) → admin ve reporte → mapa muestra ubicación.
 */
// eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar los fixtures
test("MVP offline-first de punta a punta", async ({}, info) => {
  test.setTimeout(150_000);
  const dir = newProfileDir();

  // A) Primera apertura con conexión: se instala el service worker y se descargan catálogos.
  let ctx = await launchProfile(info, dir);
  let page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("/senso/app");
  await waitForServiceWorker(page);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-mode", "online");
  await expect(page.getByText("Reporta desde donde estés")).toBeVisible();

  // B) Sin conexión
  await ctx.setOffline(true);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-mode", "offline");
  await expect(page.getByTestId("offline-hint")).toHaveText("Sin conexión: los reportes se guardarán en este dispositivo.");

  // C) Crear reporte sin conexión (con GPS)
  const folio = await createReportUI(page, "electricity", "No disponible");
  expect(folio).toMatch(/^SENSO-\d{4}-P-/);
  await expect(page.getByTestId("saved-offline-msg")).toHaveText("Se enviará cuando vuelva la conexión.");
  await expect(page.getByTestId("pending-count")).toHaveText(/1 reporte pendiente/);
  await expect(page.getByTestId("event-line").or(page.getByText("Polo 2026"))).toHaveCount(0); // ya no estamos en el paso de categoría
  const byFolio = () => query("SELECT id FROM reports WHERE local_folio = ?", [folio]);
  expect(await byFolio()).toHaveLength(0); // el servidor aún no tiene nada

  // D) Cerrar el navegador por completo
  await ctx.close();

  // E) Volver a abrir, todavía sin conexión: la app abre desde el service worker
  ctx = await launchProfile(info, dir);
  await ctx.setOffline(true);
  page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("/senso/app/reportes");
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-mode", "offline");

  // F) Ver el reporte almacenado
  const card = page.getByTestId("report-card").first();
  await expect(card).toContainText(folio);
  await expect(card).toContainText("Electricidad");
  await expect(card).toContainText("No disponible");
  await expect(card).toContainText("📍 Ubicación registrada");
  await expect(card.getByTestId("sync-badge")).toHaveAttribute("data-status", "PENDING");

  // L) Actualizar el reporte sin conexión: "Restablecido"
  await card.click();
  await page.getByTestId("open-restore").click();
  await page.getByRole("button", { name: "Restablecido", exact: true }).click();
  await page.getByRole("textbox").fill("Regresó la luz");
  await page.getByTestId("save-update").click();
  await expect(page.getByTestId("history-item")).toHaveCount(2);
  await expect(page.getByTestId("history")).toContainText("Restablecido");
  await expect(page.getByTestId("pending-count")).toHaveText(/1 reporte pendiente/);

  // I) Recuperar conexión pero el servidor falla → FAILED, sin marcar sincronizado
  await page.route("**/senso/api/sync", (route) => route.abort("failed"));
  await ctx.setOffline(false);
  // Detección automática (verificación periódica del servidor, cada 15 s cuando no responde)
  await expect(page.getByTestId("reconnected-banner")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("reconnected-banner")).toContainText("Conexión restaurada");
  await expect(page.getByTestId("sync-badge").first()).toHaveAttribute("data-status", "FAILED");
  expect(await byFolio()).toHaveLength(0);

  // G/H/J) Servidor disponible: "SINCRONIZAR AHORA" reintenta y sincroniza
  await page.unroute("**/senso/api/sync");
  await page.getByRole("button", { name: "SINCRONIZAR AHORA" }).first().click();
  await expect(page.getByTestId("sync-badge").first()).toHaveAttribute("data-status", "SYNCED");
  await expect(page.getByTestId("pending-count")).toHaveText("Sin pendientes");
  const official = (await page.getByTestId("detail-folio").textContent())!.trim();
  expect(official).toMatch(/^SENSO-\d{4}-\d{6}$/);

  // Servidor recibe: 1 reporte + 1 actualización (M), estado vigente "AVAILABLE"
  const rows = await query<{ folio: string; current_status: string; initial_status: string; connectivity: string; latitude: number; event_name: string }>(
    "SELECT r.id, r.folio, r.current_status, r.initial_status, r.connectivity, r.latitude, e.name AS event_name FROM reports r JOIN events e ON e.id = r.event_id WHERE r.local_folio = ?",
    [folio],
  );
  expect(rows).toEqual([expect.objectContaining({ folio: official, initial_status: "UNAVAILABLE", current_status: "AVAILABLE", connectivity: "OFFLINE", latitude: 23.0605, event_name: "Polo 2026" })]);
  const reportId = (rows[0] as unknown as { id: number }).id;
  expect(await query("SELECT id FROM report_updates WHERE report_id = ?", [reportId])).toHaveLength(1);

  // K) Recargar / volver a sincronizar no duplica nada
  await page.reload();
  await page.getByTestId("connection-status").waitFor();
  expect(await byFolio()).toHaveLength(1);
  expect(await query("SELECT id FROM report_updates WHERE report_id = ?", [reportId])).toHaveLength(1);

  // Admin ve el reporte y el mapa muestra la ubicación
  const admin = await ctx.newPage();
  await admin.goto("/senso/admin");
  await admin.getByLabel("Correo").fill(ADMIN.email);
  await admin.getByLabel("Contraseña").fill(ADMIN.password);
  await admin.getByRole("button", { name: "Entrar" }).click();
  await expect(admin.getByText("CENTRO DE MONITOREO SENSO")).toBeVisible();
  await expect(admin.getByTestId("kpi-total")).not.toHaveText("—");
  expect(Number((await admin.getByTestId("kpi-restored").textContent())!.replace(/\D/g, ""))).toBeGreaterThanOrEqual(1);
  await expect(admin.getByTestId("reports-table")).toContainText(official);
  // Filtrar por estado "Disponible" + electricidad: el mapa muestra este reporte
  await admin.getByTestId("filter-category").selectOption("electricity");
  await admin.getByTestId("filter-status").selectOption("AVAILABLE");
  await expect(admin.getByTestId("reports-table")).toContainText(official);
  // Puntos esperados según la BD con los mismos filtros (electricidad, disponible, con ubicación,
  // periodo por defecto de 7 días). No se lee de la UI: mientras recarga podría mostrar el valor previo.
  const [{ n }] = await query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM reports WHERE category = 'electricity' AND current_status = 'AVAILABLE' AND latitude IS NOT NULL AND created_at_client >= ?",
    [new Date(Date.now() - 7 * 86_400_000)],
  );
  const points = Number(n);
  expect(points).toBeGreaterThanOrEqual(1);
  await expect(admin.getByTestId("monitor-map")).toHaveAttribute("data-points", String(points));
  await admin.getByTestId("map-mode-points").click();
  await expect(admin.getByTestId("monitor-map")).toHaveAttribute("data-rendered", `points:${points}`);
  await admin.getByTestId("map-mode-heat").click();
  await expect(admin.getByTestId("monitor-map")).toHaveAttribute("data-rendered", `heat:${points}`);
  await expect(admin.locator("canvas.leaflet-heatmap-layer")).toHaveCount(1);
  await admin.getByRole("button", { name: official }).click();
  await expect(admin.getByTestId("drawer-history")).toContainText("Restablecido");
  await expect(admin.locator('meta[name="robots"][content="noindex, nofollow"]')).toHaveCount(1);

  await ctx.close();
});

// eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar los fixtures
test("K) dos reportes sin conexión y reconexión automática: sin duplicados", async ({}, info) => {
  const dir = newProfileDir();
  const ctx = await launchProfile(info, dir);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("/senso/app");
  await waitForServiceWorker(page);
  const before = (await query("SELECT COUNT(*) AS n FROM reports"))[0] as { n: number };
  await ctx.setOffline(true);
  await createReportUI(page, "water", "Intermitente");
  await createReportUI(page, "flood", "Activa / sin atender");
  await expect(page.getByTestId("pending-count")).toHaveText(/2 reportes pendientes/);
  await ctx.setOffline(false); // la sincronización es automática al volver la conexión
  await expect(page.getByTestId("pending-count")).toHaveText("Sin pendientes", { timeout: 20_000 });
  // reenvíos por visibilidad / intervalo no duplican
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.reload();
  const after = (await query("SELECT COUNT(*) AS n FROM reports"))[0] as { n: number };
  expect(Number(after.n) - Number(before.n)).toBe(2);
  await ctx.close();
});
