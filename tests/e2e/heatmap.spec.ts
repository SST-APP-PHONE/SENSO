import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, VIEWER } from "./global-setup.js";

/**
 * Mapa de calor del administrador, con reportes reales enviados por el mismo endpoint que usa la
 * cola sin conexión. Se aíslan con un municipio propio para no depender del resto de pruebas.
 */
const ZONE = `Zona E2E Calor ${Date.now()}`;
const COMMENT = "Dato personal de prueba: Juan 6241234567";

function op(category: string, status: string, location: { latitude: number; longitude: number } | null) {
  return {
    type: "CREATE_REPORT",
    clientOperationId: randomUUID(),
    payload: {
      reportId: randomUUID(),
      localFolio: "SENSO-2026-P-E2EHMP",
      eventId: null,
      category,
      status,
      severity: "HIGH",
      comment: COMMENT,
      municipality: ZONE,
      location: location ? { ...location, accuracy: 8, capturedAt: new Date().toISOString() } : null,
      createdAt: new Date().toISOString(),
      timezoneOffsetMinutes: -420,
      connectivity: "OFFLINE",
      device: { deviceId: randomUUID(), platform: "Android" },
    },
  };
}

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto("/senso/admin");
  await page.getByLabel("Correo").fill(who.email);
  await page.getByLabel("Contraseña").fill(who.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("CENTRO DE MONITOREO SENSO")).toBeVisible();
}

test.beforeAll(async ({ request }) => {
  // 3 reportes ubicados (2 en la misma zona) + 1 sin ubicación, sincronizados desde "modo sin conexión".
  const res = await request.post("/senso/api/sync", {
    data: {
      operations: [
        op("electricity", "UNAVAILABLE", { latitude: 31.8601, longitude: -116.6201 }),
        op("electricity", "UNAVAILABLE", { latitude: 31.8602, longitude: -116.6202 }),
        op("water", "INTERMITTENT", { latitude: 31.9001, longitude: -116.7001 }),
        op("flood", "UNAVAILABLE", null),
      ],
    },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.results.every((r: { outcome: string }) => r.outcome === "APPLIED")).toBe(true);
});

test("el administrador abre el mapa de calor; filtros, indicadores, marcadores y privacidad", async ({ page }) => {
  await login(page, ADMIN);
  await page.getByTestId("nav-heatmap").click();
  await expect(page).toHaveURL(/\/senso\/admin\/mapa-calor$/);
  await expect(page.getByTestId("heatmap-page")).toBeVisible();

  // Capturar las respuestas del módulo para verificar que no contienen datos personales.
  const bodies: string[] = [];
  page.on("response", async (r) => {
    if (r.url().includes("/api/admin/heatmap")) bodies.push(await r.text().catch(() => ""));
  });

  await page.getByRole("combobox", { name: "Periodo", exact: true }).selectOption("");
  await page.getByRole("combobox", { name: "Municipio / zona", exact: true }).selectOption(ZONE);
  await expect(page.getByTestId("heat-kpi-total")).toHaveText("4");
  await expect(page.getByTestId("heat-kpi-located")).toHaveText("3");
  await expect(page.getByTestId("heat-kpi-unlocated")).toHaveText("1");
  await expect(page.getByTestId("heatmap-map")).toHaveAttribute("data-rendered", /^cells:[12];points:0$/);
  await expect(page.getByTestId("heat-legend")).toBeVisible();
  await expect(page.getByTestId("heatmap-hotspots")).toContainText(ZONE);
  await expect(page.getByTestId("heatmap-by-category")).toContainText("Electricidad");
  await expect(page.getByTestId("heatmap-updated")).toContainText("Datos actualizados");

  // Marcadores individuales opcionales.
  await page.getByTestId("heatmap-toggle-points").check();
  await expect(page.getByTestId("heatmap-map")).toHaveAttribute("data-rendered", /points:3$/);

  // Filtro de estado: mapa e indicadores se actualizan juntos.
  await page.getByRole("combobox", { name: "Estado", exact: true }).selectOption("INTERMITTENT");
  await expect(page.getByTestId("heat-kpi-total")).toHaveText("1");
  await expect(page.getByTestId("heat-kpi-located")).toHaveText("1");
  await expect(page.getByTestId("heatmap-map")).toHaveAttribute("data-rendered", "cells:1;points:1");

  // Sin reportes (rango personalizado vacío): mensaje de ausencia, no de error.
  await page.getByRole("combobox", { name: "Periodo", exact: true }).selectOption("custom");
  await page.getByLabel("Fecha inicial").fill("2001-01-01");
  await page.getByLabel("Fecha final").fill("2001-01-02");
  await expect(page.getByTestId("heatmap-empty")).toHaveText("No hay reportes para los filtros seleccionados.");
  await expect(page.getByTestId("heatmap-error")).toHaveCount(0);
  await expect(page.getByTestId("heatmap-map")).toHaveAttribute("data-rendered", "cells:0;points:0");

  expect(bodies.length).toBeGreaterThan(0);
  for (const b of bodies) expect(b).not.toMatch(/Juan|6241234567|deviceId|comment/);
});

test("errores de consulta: sin conexión y error del servidor se distinguen de la ausencia de datos", async ({ page }) => {
  await login(page, ADMIN);
  await page.route("**/api/admin/heatmap**", (r) => r.abort("internetdisconnected"));
  await page.getByTestId("nav-heatmap").click();
  await expect(page.getByTestId("heatmap-error")).toHaveAttribute("data-kind", "offline");
  await expect(page.getByTestId("heatmap-empty")).toHaveCount(0);

  await page.unroute("**/api/admin/heatmap**");
  await page.route("**/api/admin/heatmap**", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Error interno"}' }));
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByTestId("heatmap-error")).toHaveAttribute("data-kind", "server");

  await page.unroute("**/api/admin/heatmap**");
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByTestId("heatmap-error")).toHaveCount(0);
  await expect(page.getByTestId("heat-kpi-total")).not.toHaveText("—");
});

test("un usuario sin permisos no ve el módulo ni puede consultar la API directamente", async ({ page }) => {
  await login(page, VIEWER);
  await expect(page.getByTestId("nav-heatmap")).toHaveCount(0);
  await page.goto("/senso/admin/mapa-calor");
  await expect(page.getByTestId("heatmap-forbidden")).toBeVisible();
  // Llamada directa con la sesión del VIEWER.
  const direct = await page.request.get("/senso/api/admin/heatmap?includePoints=1");
  expect(direct.status()).toBe(403);
  expect(await direct.text()).not.toContain("cells");
  // Sin sesión.
  const anon = await page.request.get("/senso/api/admin/heatmap", { headers: { cookie: "" } });
  expect([401, 403]).toContain(anon.status());
});

test("diseño adaptable: celular, tableta y escritorio sin scroll horizontal", async ({ page }) => {
  await login(page, ADMIN);
  for (const width of [390, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/senso/admin/mapa-calor");
    await expect(page.getByTestId("heat-kpi-total")).not.toHaveText("—");
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollWidth, `scroll horizontal a ${width}px`).toBeLessThanOrEqual(clientWidth);
    await expect(page.getByTestId("heatmap-map")).toBeVisible();
  }
});
